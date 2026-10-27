package io.myapp.orders;

import io.axoniq.framework.workflow.annotation.Workflow;
import io.axoniq.framework.workflow.dsl.api.StepFailedException;
import io.axoniq.framework.workflow.dsl.api.StepTimedOutException;
import io.axoniq.framework.workflow.dsl.simple.SimpleWorkflowContext;
import org.axonframework.messaging.commandhandling.gateway.CommandGateway;

import java.time.Duration;

/**
 * Example contract: request payment without observing command failure, await confirmation, then publish completion.
 * A payment timeout cancels the request; a failed cancellation step fails the workflow.
 * Adapt this contract, event/command types, namespace, and timeouts to the actual saga inventory.
 */
public class OrderWorkflow {
    private final CommandGateway commands;
    private final Duration paymentTimeout;
    private final Duration commandTimeout;

    public OrderWorkflow(CommandGateway commands, Duration paymentTimeout, Duration commandTimeout) {
        this.commands = commands;
        this.paymentTimeout = paymentTimeout;
        this.commandTimeout = commandTimeout;
    }

    @Workflow(workflowName = "OrderPayment", workflowNamespace = "io.myapp.orders",
              idProperty = "orderId", startOnEventClass = OrderPlaced.class)
    public void execute(SimpleWorkflowContext context) {
        String orderId = (String) context.workflowPayload().get("orderId");
        long amountCents = ((Number) context.workflowPayload().get("amountCents")).longValue();
        var paymentConfirmed = context.waitForEvent("paymentConfirmed", PaymentConfirmed.class,
                Steps.sameId("orderId", orderId), step -> step.timeout(paymentTimeout));
        try {
            Steps.send(context, "requestPayment", commands, new RequestPayment(orderId, amountCents),
                       step -> step.timeout(commandTimeout));
        } catch (StepFailedException exception) {
            context.fail(exception);
            return;
        }
        try {
            Steps.awaitSuccess(paymentConfirmed, PaymentConfirmed.class);
        } catch (StepTimedOutException exception) {
            cancelOrder(context, orderId);
            return;
        } catch (StepFailedException exception) {
            context.fail(exception);
            return;
        }
        // Payment is the point of no return in this example. A later failure does not cancel it.
        try {
            context.awaitPublish("orderCompleted", new OrderCompleted(orderId));
        } catch (StepFailedException exception) {
            context.fail(exception);
        }
    }

    private void cancelOrder(SimpleWorkflowContext context, String orderId) {
        try {
            Steps.sendAndWait(context, "cancelPayment", commands, new CancelPayment(orderId),
                              step -> step.timeout(commandTimeout));
            context.awaitPublish("orderCancelled", new OrderCancelled(orderId, "Payment timeout"));
        } catch (StepFailedException exception) {
            context.fail(exception);
        }
    }
}
