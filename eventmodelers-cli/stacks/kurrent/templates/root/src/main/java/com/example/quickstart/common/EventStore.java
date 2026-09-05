package com.example.quickstart.common;

import io.kurrent.dbclient.*;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.concurrent.ExecutionException;

/**
 * Thin wrapper around {@link KurrentDBClient} shared by every write slice — reads a stream into a
 * plain list (or empty, if the stream doesn't exist yet) and appends events, translating the client's
 * checked/wrapped exceptions into unchecked ones so slice code doesn't repeat this boilerplate.
 *
 * <p>This project has no CQRS framework layer (unlike the OpenCQRS/Axon kits) — this class, plus each
 * slice's own {@code decide}/{@code evolve} functions, is the entire "framework". See
 * {@code .build-kit/CLAUDE.md} for the full convention.
 */
@Component
public class EventStore {

    private final KurrentDBClient client;

    public EventStore(KurrentDBClient client) {
        this.client = client;
    }

    /**
     * Reads every event in {@code streamId}, forwards from the start. Returns
     * {@link StreamEvents#empty()} if the stream doesn't exist yet — this is the normal, expected case
     * for a creation command, not an error.
     */
    public StreamEvents read(String streamId) {
        try {
            ReadResult result = client.readStream(streamId, ReadStreamOptions.get().forwards().fromStart()).get();
            return new StreamEvents(result.getEvents(), result.getLastStreamPosition());
        } catch (ExecutionException e) {
            if (e.getCause() instanceof StreamNotFoundException) {
                return StreamEvents.empty();
            }
            throw new EventStoreException(e.getCause());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new EventStoreException(e);
        }
    }

    /**
     * Appends {@code events} to {@code streamId} under the given {@code expectedState} (see
     * {@link StreamState#noStream()}/{@link StreamState#streamRevision(long)}/etc). Throws
     * {@link WrongExpectedVersionException} directly (unwrapped) on an optimistic-concurrency
     * conflict — callers decide for themselves whether that's a real conflict (map it to HTTP 409) or
     * an expected redelivery to swallow (see build-automation's SKILL.md).
     */
    public WriteResult append(String streamId, StreamState expectedState, List<EventData> events) {
        try {
            AppendToStreamOptions options = AppendToStreamOptions.get().streamState(expectedState);
            return client.appendToStream(streamId, options, events.toArray(new EventData[0])).get();
        } catch (ExecutionException e) {
            if (e.getCause() instanceof WrongExpectedVersionException wrongExpectedVersion) {
                throw wrongExpectedVersion;
            }
            throw new EventStoreException(e.getCause());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new EventStoreException(e);
        }
    }

    public record StreamEvents(List<ResolvedEvent> events, long lastStreamPosition) {
        private static final long NO_STREAM_POSITION = -1;

        public static StreamEvents empty() {
            return new StreamEvents(List.of(), NO_STREAM_POSITION);
        }

        public boolean isEmpty() {
            return events.isEmpty();
        }

        /** The {@link StreamState} to append under, given this stream's current position. */
        public StreamState expectedState() {
            return isEmpty() ? StreamState.noStream() : StreamState.streamRevision(lastStreamPosition);
        }
    }

    public static class EventStoreException extends RuntimeException {
        public EventStoreException(Throwable cause) {
            super(cause);
        }
    }
}
