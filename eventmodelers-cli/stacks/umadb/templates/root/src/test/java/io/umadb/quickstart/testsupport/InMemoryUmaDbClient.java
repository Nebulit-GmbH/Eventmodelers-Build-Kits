package io.umadb.quickstart.testsupport;

import io.umadb.client.*;

import java.util.*;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * Fast, in-process fake of {@link UmaDbClient} for command-handler unit tests - this project's
 * hand-rolled stand-in for what {@code AxonTestFixture} gives Axon Framework projects, since
 * UmaDB ships no test-fixture library of its own (only a Testcontainers-based integration test
 * setup - see {@code UmaDbContainerTest} for that style instead).
 * <p>
 * Reimplements the real server's documented matching rules ({@link Query}/{@link QueryItem}) and
 * conflict/idempotency semantics ({@link AppendCondition}, id-based dedup) closely enough for
 * command-handler tests, but is NOT a certified reproduction of the real server - anything
 * subtle should still be verified against a real instance via Testcontainers
 * ({@code UmaDbContainerTest}). {@link #subscribe} is intentionally unsupported: no test in this
 * project needs it, since projectors are tested via a direct {@code on(event)} call instead (see
 * build-state-view) and the one thing that genuinely needs a live subscription
 * ({@link io.umadb.quickstart.eventstore.EventDispatcher}) is covered by the Testcontainers test.
 */
public class InMemoryUmaDbClient implements UmaDbClient {

    private final List<SequencedEvent> store = new CopyOnWriteArrayList<>();

    @Override
    public void connect() {
        // no-op: nothing to connect to
    }

    @Override
    public synchronized AppendResponse handle(AppendRequest appendRequest) {
        // Idempotency: if every event in this request already exists by id, no-op and return
        // the position of the last of those - mirrors the real server's documented behaviour
        // (verified against UmaDbClientTest#testIdempotentAppendReturnsSamePosition upstream).
        boolean allAlreadyExist = appendRequest.events().stream().allMatch(this::existsById);
        if (allAlreadyExist && !appendRequest.events().isEmpty()) {
            long position = appendRequest.events().stream()
                    .mapToLong(e -> positionOf(e).orElseThrow())
                    .max().orElseThrow();
            return new AppendResponse(position);
        }

        if (appendRequest.condition() != null) {
            AppendCondition condition = appendRequest.condition();
            long after = condition.after() == null ? 0L : condition.after();
            boolean conflict = store.stream()
                    .anyMatch(se -> se.position() > after && matches(condition.failIfEventsMatch(), se.event()));
            if (conflict) {
                throw new UmaDbException.IntegrityException(
                        "Event(s) matching the append condition already exist after position " + after);
            }
        }

        long position = store.size();
        for (Event event : appendRequest.events()) {
            position++;
            store.add(new SequencedEvent(position, event, appendRequest.trackingInfo()));
        }
        return new AppendResponse(position);
    }

    @Override
    public synchronized Iterator<ReadResponse> handle(ReadRequest readRequest) {
        long start = readRequest.start() == null ? 0L : readRequest.start();
        boolean backwards = readRequest.backwards() != null && readRequest.backwards();

        List<SequencedEvent> matched = store.stream()
                .filter(se -> se.position() > start)
                .filter(se -> matches(readRequest.query(), se.event()))
                .sorted(backwards
                        ? Comparator.comparingLong(SequencedEvent::position).reversed()
                        : Comparator.comparingLong(SequencedEvent::position))
                .toList();

        if (readRequest.limit() != null && matched.size() > readRequest.limit()) {
            matched = matched.subList(0, readRequest.limit());
        }

        long head = store.isEmpty() ? 0L : store.get(store.size() - 1).position();
        return List.of(new ReadResponse(matched, head)).iterator();
    }

    @Override
    public Iterator<SubscribeResponse> subscribe(SubscribeRequest subscribeRequest) {
        throw new UnsupportedOperationException(
                "InMemoryUmaDbClient does not support subscribe() - test projectors via a direct "
                        + "on(event) call instead, and test EventDispatcher itself against a real "
                        + "instance via Testcontainers (see UmaDbContainerTest).");
    }

    @Override
    public synchronized Optional<Long> getTrackingInfo(String source) {
        return store.stream()
                .filter(se -> se.trackingInfo() != null && se.trackingInfo().source().equals(source))
                .max(Comparator.comparingLong(SequencedEvent::position))
                .map(se -> se.trackingInfo().position());
    }

    @Override
    public synchronized long getHeadPosition() {
        return store.isEmpty() ? 0L : store.get(store.size() - 1).position();
    }

    @Override
    public void shutdown() {
        // no-op
    }

    private boolean existsById(Event event) {
        return store.stream().anyMatch(se -> se.event().id().equals(event.id()));
    }

    private Optional<Long> positionOf(Event event) {
        return store.stream()
                .filter(se -> se.event().id().equals(event.id()))
                .map(SequencedEvent::position)
                .max(Long::compareTo);
    }

    /** {@code Query}/{@code QueryItem} matching rules, replicated from their own javadoc. */
    private static boolean matches(Query query, Event event) {
        if (query == null || query.items().isEmpty()) {
            return true;
        }
        return query.items().stream().anyMatch(item -> matches(item, event));
    }

    private static boolean matches(QueryItem item, Event event) {
        boolean typeMatches = item.types().isEmpty() || item.types().contains(event.type());
        boolean tagsMatch = item.tags().isEmpty() || event.tags().containsAll(item.tags());
        return typeMatches && tagsMatch;
    }
}
