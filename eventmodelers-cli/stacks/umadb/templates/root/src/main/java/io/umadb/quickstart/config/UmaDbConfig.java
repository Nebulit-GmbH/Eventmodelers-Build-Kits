package io.umadb.quickstart.config;

import io.umadb.client.UmaDbClient;
import jakarta.annotation.PreDestroy;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Wires the shared {@link UmaDbClient} used by every command handler's read/append calls.
 * UmaDB has no Spring Boot starter of its own (unlike Axon Framework) - the client is a
 * plain library, so this project connects and shuts it down by hand, the same way the Axon
 * quickstart wires its {@code TokenStore} bean manually.
 * <p>
 * {@link io.umadb.quickstart.eventstore.EventDispatcher} does NOT use this bean - it opens
 * its own separate connection for the long-lived subscription. See that class's Javadoc.
 */
@Configuration
public class UmaDbConfig {

    private UmaDbClient client;

    @Bean
    public UmaDbClient umaDbClient(
            @Value("${umadb.host}") String host,
            @Value("${umadb.port}") int port
    ) {
        client = UmaDbClient.builder().withHost(host).withPort(port).build();
        client.connect();
        return client;
    }

    @PreDestroy
    void shutdown() {
        if (client != null) {
            client.shutdown();
        }
    }
}
