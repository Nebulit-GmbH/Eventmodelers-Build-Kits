package com.example.quickstart.config;

import io.kurrent.dbclient.ConnectionStringParsingException;
import io.kurrent.dbclient.KurrentDBClient;
import io.kurrent.dbclient.KurrentDBClientSettings;
import io.kurrent.dbclient.KurrentDBConnectionString;
import io.kurrent.dbclient.KurrentDBPersistentSubscriptionsClient;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * The KurrentDB Java client ({@code kurrentdb-client}) ships no Spring Boot auto-configuration of its
 * own (unlike OpenCQRS's {@code framework-spring-boot-starter}) — it is a plain SDK. These beans are
 * this project's own wiring, not a vendor-provided starter.
 */
@Configuration
public class KurrentConfiguration {

    @Value("${kurrentdb.connection-string}")
    private String connectionString;

    /**
     * A single client instance is safe to share as a singleton across the whole application — it does
     * not need to be opened/closed per request (see the client's own getting-started guide).
     */
    @Bean(destroyMethod = "shutdown")
    public KurrentDBClient kurrentDBClient() throws ConnectionStringParsingException {
        KurrentDBClientSettings settings = KurrentDBConnectionString.parseOrThrow(connectionString);
        return KurrentDBClient.create(settings);
    }

    /**
     * Separate client for managing/consuming persistent subscriptions — used by build-state-view and
     * build-automation slices, not by build-state-change (which only appends/reads streams directly).
     */
    @Bean(destroyMethod = "shutdown")
    public KurrentDBPersistentSubscriptionsClient kurrentDBPersistentSubscriptionsClient() throws ConnectionStringParsingException {
        KurrentDBClientSettings settings = KurrentDBConnectionString.parseOrThrow(connectionString);
        return KurrentDBPersistentSubscriptionsClient.create(settings);
    }
}
