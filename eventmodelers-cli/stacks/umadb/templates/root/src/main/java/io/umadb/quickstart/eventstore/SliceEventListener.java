package io.umadb.quickstart.eventstore;

import io.umadb.client.Event;

/**
 * Implemented by every read-model projector and automation processor that reacts to events
 * off the live {@link EventDispatcher} subscription - this project's equivalent of an
 * {@code @EventHandler}, since UmaDB has no annotation-driven dispatch of its own.
 * Implementations decode the payload themselves (via {@link EventCodec#fromEvent}) once
 * {@link #supports} confirms the type.
 * <p>
 * Named {@code Slice}EventListener, not {@code EventListener} - Spring's own
 * {@code org.springframework.context.event.EventListener} annotation has that exact simple
 * name, and {@link EventDispatcher} needs both in the same file.
 */
public interface SliceEventListener {

    /** Whether this listener reacts to events of the given UmaDB {@code Event.type()}. */
    boolean supports(String eventType);

    /** Handle one matching event. Called on the dispatcher's subscription thread - keep it fast and idempotent. */
    void onEvent(Event event);
}
