package io.umadb.quickstart.eventstore;

import io.umadb.client.SubscribeRequest;
import io.umadb.client.UmaDbClient;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * Fans out every event UmaDB has ever recorded (and every one appended from now on) to every
 * {@link SliceEventListener} bean in the application - read-model projectors and automation
 * processors alike. UmaDB has no built-in event-processor/subscription-group concept the way
 * a framework like Axon does; this class is this project's one shared implementation of that
 * plumbing, so no individual slice re-implements subscribe-and-fan-out itself.
 * <p>
 * Uses its own dedicated {@link UmaDbClient} connection (built directly from
 * {@code umadb.host}/{@code umadb.port}, not the shared command-handling bean from
 * {@link io.umadb.quickstart.config.UmaDbConfig}) because {@link UmaDbClient#subscribe} never
 * returns until {@link UmaDbClient#shutdown()} is called - sharing a client would mean
 * shutting down the dispatcher also kills every command handler's connection, and vice versa.
 * <p>
 * <b>Quickstart-level checkpointing only:</b> resubscribes from the very beginning of the
 * stream on every application start (not from a persisted position). Every listener must
 * therefore be idempotent under full replay - {@code AllCustomersProjector}'s JPA
 * {@code save(...)} is (upsert by primary key), and {@code AutoSubscribeToDefaultCourseProcessor}
 * relies on {@code SubscribeToCourseCommandHandler}'s own decision model to no-op a repeat
 * dispatch. A production project should persist {@code getHeadPosition()} (or a per-listener
 * cursor) and resume from there instead of always starting at 0 - UmaDB's {@code TrackingInfo}
 * is the right tool for that (see {@code build-automation}'s translation-slice guidance for a
 * worked example), but only fits naturally where the listener itself also appends an event;
 * a pure projection has nothing to attach it to.
 */
@Component
public class EventDispatcher {

    private static final Logger log = LoggerFactory.getLogger(EventDispatcher.class);

    private final String host;
    private final int port;
    private final List<SliceEventListener> listeners;

    private volatile UmaDbClient subscriptionClient;
    private volatile boolean shuttingDown;

    public EventDispatcher(
            @Value("${umadb.host}") String host,
            @Value("${umadb.port}") int port,
            List<SliceEventListener> listeners
    ) {
        this.host = host;
        this.port = port;
        this.listeners = List.copyOf(listeners);
    }

    @EventListener(ApplicationReadyEvent.class)
    public void start() {
        subscriptionClient = UmaDbClient.builder().withHost(host).withPort(port).build();
        subscriptionClient.connect();
        Thread.ofVirtual().name("umadb-event-dispatcher").start(this::runLoop);
    }

    private void runLoop() {
        try {
            var subscription = subscriptionClient.subscribe(SubscribeRequest.all());
            while (subscription.hasNext()) {
                for (var sequencedEvent : subscription.next().events()) {
                    var event = sequencedEvent.event();
                    for (SliceEventListener listener : listeners) {
                        if (listener.supports(event.type())) {
                            try {
                                listener.onEvent(event);
                            } catch (Exception e) {
                                log.error("Listener {} failed handling event type {} at position {}",
                                        listener.getClass().getSimpleName(), event.type(), sequencedEvent.position(), e);
                            }
                        }
                    }
                }
            }
        } catch (Exception e) {
            if (!shuttingDown) {
                log.error("Event dispatcher subscription terminated unexpectedly", e);
            }
        }
    }

    @PreDestroy
    void shutdown() {
        shuttingDown = true;
        if (subscriptionClient != null) {
            subscriptionClient.shutdown();
        }
    }
}
