package io.axoniq.quickstart;

import io.axoniq.quickstart.giftcard.domain.GiftCard;
import org.axonframework.messaging.eventhandling.processing.streaming.token.store.TokenStore;
import org.axonframework.messaging.eventhandling.processing.streaming.token.store.inmemory.InMemoryTokenStore;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * Main entry point for the Axoniq Platform Quickstart application.
 *
 * <p>This Spring Boot application demonstrates a complete CQRS/Event Sourcing implementation
 * using Axon Framework and Axon Server, showcasing best practices for building reactive,
 * scalable applications with event-driven architecture.</p>
 *
 * <p><strong>Architecture Overview:</strong></p>
 * <ul>
 *   <li><strong>CQRS Implementation</strong>: Separates command and query responsibilities</li>
 *   <li><strong>Event Sourcing</strong>: Stores state changes as immutable events</li>
 *   <li><strong>Reactive Web Stack</strong>: Uses Spring WebFlux for non-blocking I/O</li>
 *   <li><strong>Real-time Updates</strong>: Implements Server-Sent Events for live UI updates</li>
 *   <li><strong>In-Memory Projections</strong>: Fast query performance with eventual consistency</li>
 * </ul>
 *
 * <p><strong>Key Components Enabled:</strong></p>
 * <ul>
 *   <li><strong>{@code @SpringBootApplication}</strong>: Enables auto-configuration, component scanning, and configuration properties</li>
 *   <li><strong>{@code @EnableScheduling}</strong>: Activates scheduled task execution for the {@link io.axoniq.quickstart.giftcard.scheduler.GiftCardScheduler}</li>
 * </ul>
 *
 * <p><strong>Domain Model:</strong></p>
 * <p>The application centers around a Gift Card domain implementing:</p>
 * <ul>
 *   <li><strong>EventSourced DCB Model</strong>: {@link GiftCard} - Core business logic and state</li>
 *   <li><strong>Commands</strong>: Issue and redeem operations with business validation</li>
 *   <li><strong>Events</strong>: Immutable facts about gift card lifecycle changes</li>
 *   <li><strong>Queries</strong>: Read operations with subscription query support</li>
 *   <li><strong>Projections</strong>: Denormalized read models for efficient querying</li>
 * </ul>
 *
 * <p><strong>Technical Stack:</strong></p>
 * <ul>
 *   <li><strong>Axon Framework</strong>: CQRS/Event Sourcing framework</li>
 *   <li><strong>Axon Server</strong>: Event store and message routing infrastructure</li>
 *   <li><strong>Spring WebFlux</strong>: Reactive web framework with non-blocking I/O</li>
 *   <li><strong>Vue.js 3</strong>: Frontend framework with Vuetify UI components</li>
 *   <li><strong>Server-Sent Events</strong>: Real-time updates without WebSocket complexity</li>
 * </ul>
 *
 * <p><strong>Educational Value:</strong></p>
 * <p>This quickstart serves as a practical learning resource demonstrating:</p>
 * <ul>
 *   <li>Event Sourcing patterns and practices</li>
 *   <li>CQRS implementation with separate read/write models</li>
 *   <li>Real-time web applications with reactive streams</li>
 *   <li>Integration between Axon Framework and Spring Boot</li>
 *   <li>Modern UI development with real-time data updates</li>
 * </ul>
 *
 * <p><strong>Production Readiness Notes:</strong></p>
 * <p>While this quickstart demonstrates core patterns, production deployments should consider:</p>
 * <ul>
 *   <li>Persistent event store configuration (vs. in-memory)</li>
 *   <li>Distributed deployment strategies</li>
 *   <li>Monitoring and observability integration</li>
 *   <li>Security implementation (authentication, authorization)</li>
 *   <li>Error handling and retry mechanisms</li>
 *   <li>Performance tuning and resource optimization</li>
 * </ul>
 *
 * <p><strong>Getting Started:</strong></p>
 * <ol>
 *   <li>Ensure Axon Server is running on localhost:8124</li>
 *   <li>Run this application using Spring Boot</li>
 *   <li>Access the web interface at http://localhost:8080</li>
 *   <li>Observe real-time gift card operations via the scheduler</li>
 *   <li>Interact with the API endpoints at /api/giftcards</li>
 * </ol>
 *
 * @see GiftCard
 * @see io.axoniq.quickstart.giftcard.web.GiftCardController
 * @see io.axoniq.quickstart.giftcard.query.GiftCardProjection
 * @see io.axoniq.quickstart.giftcard.scheduler.GiftCardScheduler
 * @see <a href="https://docs.axoniq.io/reference-guide/">Axon Framework Reference Guide</a>
 *
 * @author AxonIQ Quickstart
 * @version 1.0
 * @since 1.0
 */
@SpringBootApplication
@EnableScheduling
public class QuickstartApplication {

    /**
     * Application entry point that starts the Spring Boot application.
     *
     * <p>This method bootstraps the entire application context, including:</p>
     * <ul>
     *   <li>Axon Framework auto-configuration</li>
     *   <li>Spring WebFlux reactive web server</li>
     *   <li>Component scanning and dependency injection</li>
     *   <li>Scheduled task initialization</li>
     *   <li>Static resource serving configuration</li>
     * </ul>
     *
     * <p><strong>Startup sequence:</strong></p>
     * <ol>
     *   <li>Spring Boot application context initialization</li>
     *   <li>Axon Server connection establishment</li>
     *   <li>Event store and command/query bus configuration</li>
     *   <li>EventSourced DCB model and projection registration</li>
     *   <li>Web server startup on port 8080</li>
     *   <li>Scheduler activation for demo operations</li>
     * </ol>
     *
     * @param args command line arguments passed to the application
     */
    public static void main(String[] args) {
        SpringApplication.run(QuickstartApplication.class, args);
    }

    @Bean
    public TokenStore tokenStore() {
        return new InMemoryTokenStore();
    }
}
