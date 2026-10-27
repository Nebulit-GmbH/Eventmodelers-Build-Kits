package io.myapp.orders;

import io.axoniq.framework.axonserver.connector.configuration.AxonServerConfigurationEnhancer;
import io.axoniq.framework.workflow.configuration.WorkflowModule;
import io.axoniq.framework.workflow.dsl.api.WorkflowStatus;
import io.axoniq.framework.workflow.dsl.simple.SimpleWorkflowContext;
import io.axoniq.framework.workflow.runtime.test.fixture.WorkflowTestFixture;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;

class OrderWorkflowTest {
    private static final Duration PAYMENT_TIMEOUT = Duration.ofSeconds(10);
    private static final Duration COMMAND_TIMEOUT = Duration.ofMinutes(1);
    private WorkflowTestFixture<?, ?> fixture;
    private RecordingCommandGateway gateway;

    @BeforeEach
    void setUp() {
        gateway = new RecordingCommandGateway();
        var module = WorkflowModule.defaults("OrderPayment", SimpleWorkflowContext.class)
                .definition(definition -> definition.autodetected(configuration ->
                        new OrderWorkflow(gateway, PAYMENT_TIMEOUT, COMMAND_TIMEOUT)));
        // Prevent this fixture from connecting to a real server when the connector is present.
        fixture = WorkflowTestFixture.of(module, configuration -> configuration.componentRegistry(
                registry -> registry.disableEnhancer(AxonServerConfigurationEnhancer.class)));
    }

    @AfterEach
    void tearDown() {
        fixture.then().stop();
    }

    @Test
    void completesAfterPayment() {
        fixture.when().publishEvent(new OrderPlaced("o-1", 1999)).execute("requestPayment")
                .publishEvent(new PaymentConfirmed("o-1"));
        fixture.then().stepsPassed("orderCompleted").workflowFinished(WorkflowStatus.COMPLETED);
        assertThat(gateway.sent).containsExactly(new RequestPayment("o-1", 1999));
        assertThat(gateway.contexts).hasSize(1).doesNotContainNull();
    }

    @Test
    void ignoresDispatchOnlyCommandFailureAndStillAcceptsConfirmation() {
        gateway.failOn(RequestPayment.class);
        fixture.when().publishEvent(new OrderPlaced("o-1", 1999)).execute("requestPayment")
                .publishEvent(new PaymentConfirmed("o-1"));
        fixture.then().stepsPassed("orderCompleted").workflowFinished(WorkflowStatus.COMPLETED);
    }

    @Test
    void paymentTimeoutCancelsTheOrder() {
        startWaitingForPayment();
        fixture.when().timePasses(PAYMENT_TIMEOUT.plusSeconds(5)).execute("cancelPayment");
        fixture.then().stepsPassed("orderCancelled").noStep("orderCompleted")
                .workflowFinished(WorkflowStatus.COMPLETED);
        assertThat(gateway.sent).containsExactly(new RequestPayment("o-1", 1999), new CancelPayment("o-1"));
        assertThat(gateway.contexts).hasSize(2).doesNotContainNull();
    }

    @Test
    void failedCancellationFailsTheWorkflow() {
        gateway.failOn(CancelPayment.class);
        startWaitingForPayment();
        fixture.when().timePasses(PAYMENT_TIMEOUT.plusSeconds(5)).execute("cancelPayment");
        fixture.then().noStep("orderCancelled").workflowFinished(WorkflowStatus.FAILED);
    }

    private void startWaitingForPayment() {
        fixture.when().publishEvent(new OrderPlaced("o-1", 1999)).execute("requestPayment");
        fixture.then().executionExists().waitingIn("paymentConfirmed");
    }
}
