package io.umadb.quickstart.eventstore;

import io.umadb.client.*;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.function.BiConsumer;
import java.util.function.Supplier;

/**
 * Shared read-decide-append loop every write slice's command handler uses - this project's
 * hand-rolled equivalent of what an event-sourcing framework's aggregate repository would
 * normally do, since the raw UmaDB client has no such layer of its own.
 * <p>
 * A command handler: (1) builds a {@link Query} scoped to the command's id tag(s) - see
 * each slice's own {@code Decision.relevantEvents(...)} - (2) calls {@link #load} to replay
 * matching prior events into a fresh decision-model instance, (3) checks the decision's
 * flags/fields and throws if a business rule is violated, (4) calls {@link #append} with the
 * SAME query and the position {@link #load} observed, so a conflicting event appended
 * concurrently (by another instance of this same command, racing) fails the append instead
 * of silently corrupting the decision - UmaDB's {@code AppendCondition.failIfExistsAfter}
 * is what makes this a real consistency boundary, not just a convention.
 */
@Component
public class DecisionModelLoader {

    private final UmaDbClient client;

    public DecisionModelLoader(UmaDbClient client) {
        this.client = client;
    }

    /** The decision instance folded from prior matching events, plus the position observed while reading it. */
    public record Loaded<D>(D decision, long lastPosition) {
    }

    /**
     * Reads every event matching {@code query}, applying each to a fresh decision instance in
     * store order. {@code apply} receives the raw {@link Event} - most decisions only need to
     * know a matching event of a given {@code type()} existed (a boolean flag); only decode the
     * payload via {@link EventCodec#fromEvent} when a scenario actually needs a field's value.
     */
    public <D> Loaded<D> load(Query query, Supplier<D> newDecision, BiConsumer<D, Event> apply) {
        long lastPosition = client.getHeadPosition();
        D decision = newDecision.get();
        var batches = client.handle(ReadRequest.of(query));
        while (batches.hasNext()) {
            for (SequencedEvent sequencedEvent : batches.next().events()) {
                apply.accept(decision, sequencedEvent.event());
            }
        }
        return new Loaded<>(decision, lastPosition);
    }

    /**
     * Appends the given domain event, guarded by an {@code AppendCondition} that fails if any
     * event matching {@code consistencyBoundary} was appended after {@code lastPosition} - i.e.
     * since this command's {@link #load} call read the state it decided against.
     *
     * @param consistencyBoundary same query {@link #load} used to read the decision this append follows from
     * @param lastPosition        the position {@link #load} returned alongside that decision
     * @throws OptimisticConcurrencyException if a conflicting event was appended concurrently
     */
    public void append(Object domainEvent, String type, List<String> tags, Query consistencyBoundary, long lastPosition) {
        Event event = EventCodec.toEvent(domainEvent, type, tags);
        try {
            client.handle(new AppendRequest(
                    List.of(event),
                    AppendCondition.failIfExistsAfter(consistencyBoundary, lastPosition)
            ));
        } catch (UmaDbException.IntegrityException e) {
            throw new OptimisticConcurrencyException(
                    "Conflicting event(s) matching the consistency boundary were appended concurrently for event type " + type, e);
        }
    }
}
