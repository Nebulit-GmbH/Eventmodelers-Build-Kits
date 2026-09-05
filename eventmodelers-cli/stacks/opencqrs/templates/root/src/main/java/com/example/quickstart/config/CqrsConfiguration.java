package com.example.quickstart.config;

import com.opencqrs.framework.eventhandler.progress.JdbcProgressTracker;
import com.opencqrs.framework.persistence.EventSource;
import com.opencqrs.framework.types.PreconfiguredAssignableClassEventTypeResolver;
import java.util.Map;
import javax.sql.DataSource;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.integration.jdbc.lock.DefaultLockRepository;
import org.springframework.integration.jdbc.lock.JdbcLockRegistry;
import org.springframework.integration.jdbc.lock.LockRepository;
import org.springframework.transaction.PlatformTransactionManager;

@Configuration
public class CqrsConfiguration {

    /**
     * Identifies this service as the publisher of every event it appends (the CloudEvents {@code source}
     * field). One fixed value for the whole service — not per-slice.
     */
    @Bean
    public EventSource eventSource() {
        return new EventSource("tag://quickstart");
    }

    /**
     * Maps every event's stored {@code type} string to its Java class explicitly. Required for production —
     * the default {@code ClassNameEventTypeResolver} fallback uses the fully-qualified Java classname as the
     * stored type, which breaks the moment a class is renamed or moved package, and can't interoperate with
     * non-Java event producers.
     *
     * <p><strong>Every event type used by any slice must be registered here.</strong> build-state-change and
     * build-automation both add a line when they introduce a new event — see their SKILL.md for the exact
     * step. Naming convention: {@code "quickstart.{context}.{event-name}.v1"}, lowercase, dot-separated.
     */
    @Bean
    public PreconfiguredAssignableClassEventTypeResolver eventTypeResolver() {
        return new PreconfiguredAssignableClassEventTypeResolver(Map.ofEntries(
                // "quickstart.{context}.{eventname}.v1", {EventClass}.class
                ));
    }

    /**
     * Distributed-lock leader election, backed by the {@code EVENTHANDLER_LOCK} table (see schema.sql) —
     * ensures exactly one running instance processes events for a given processing group + partition at a
     * time when this service is scaled to multiple instances.
     */
    @Bean
    public DefaultLockRepository defaultLockRepository(DataSource dataSource) {
        var result = new DefaultLockRepository(dataSource);
        result.setPrefix("EVENTHANDLER_");
        return result;
    }

    @Bean
    public JdbcLockRegistry jdbcLockRegistry(LockRepository lockRepository) {
        return new JdbcLockRegistry(lockRepository);
    }

    /**
     * Durable checkpoint per processing group + partition (see {@code EVENTHANDLER_PROGRESS} in schema.sql),
     * so a restart or fail-over resumes exactly where the previous instance left off instead of re-processing
     * or skipping events. {@code setProceedTransactionally(true)} lets an {@code @EventHandling} method
     * participate in the same transaction as the checkpoint update, making that handler's side effect and its
     * checkpoint advance atomic together.
     */
    @Bean
    public JdbcProgressTracker jdbcProgressTracker(DataSource dataSource, PlatformTransactionManager transactionManager) {
        var result = new JdbcProgressTracker(dataSource, transactionManager);
        result.setProceedTransactionally(true);
        return result;
    }
}
