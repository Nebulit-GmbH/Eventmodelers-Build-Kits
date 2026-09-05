package io.umadb.quickstart.eventstore;

/**
 * Thrown when a {@link DecisionModelLoader#append} call is rejected because an event
 * matching the decision's own query was appended by someone else between the decision's
 * read and its append - i.e. UmaDB's {@code AppendCondition} failed
 * ({@code UmaDbException.IntegrityException}). Callers may retry the whole command from
 * scratch (re-read, re-decide, re-append) or surface this as a conflict to the caller.
 */
public class OptimisticConcurrencyException extends RuntimeException {
    public OptimisticConcurrencyException(String message, Throwable cause) {
        super(message, cause);
    }
}
