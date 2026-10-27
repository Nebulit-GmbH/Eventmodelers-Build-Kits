package io.myapp.orders;

import io.axoniq.framework.workflow.dsl.api.ExecuteStepDefinition;
import io.axoniq.framework.workflow.dsl.api.StepFailedException;
import io.axoniq.framework.workflow.dsl.api.StepTimedOutException;
import io.axoniq.framework.workflow.dsl.api.WorkflowStepResult;
import io.axoniq.framework.workflow.dsl.simple.SimpleWorkflowContext;
import io.axoniq.framework.workflow.runtime.association.Associations;
import org.axonframework.common.FutureUtils;
import org.axonframework.messaging.commandhandling.gateway.CommandGateway;

import java.util.Map;
import java.util.function.UnaryOperator;

import static io.axoniq.framework.workflow.dsl.api.EventAssociationsUtils.equalsTo;
import static io.axoniq.framework.workflow.dsl.api.EventAssociationsUtils.payloadProperty;
import static io.axoniq.framework.workflow.runtime.association.Associations.associate;

/** Optional upgrade helpers. Copy only the methods used by the application's workflow. */
public final class Steps {
    private Steps() {
    }

    /** Dispatch-only, matching a saga that did not observe the command result. */
    public static void send(SimpleWorkflowContext context, String name, CommandGateway gateway, Object command,
                            UnaryOperator<ExecuteStepDefinition> options) {
        context.awaitExecute(name, Map.of(), (processingContext, input) -> {
            gateway.send(command, processingContext);
            return Map.of();
        }, options);
    }

    /** Result-aware, matching a saga callback or synchronous send that handled failure. */
    public static void sendAndWait(SimpleWorkflowContext context, String name, CommandGateway gateway, Object command,
                                   UnaryOperator<ExecuteStepDefinition> options) {
        context.awaitExecute(name, Map.of(), (processingContext, input) -> {
            FutureUtils.joinAndUnwrap(gateway.send(command, processingContext).getResultMessage());
            return Map.of();
        }, options);
    }

    /** Starts a result-aware step without waiting, for parallel work. */
    public static WorkflowStepResult sendAsync(SimpleWorkflowContext context, String name, CommandGateway gateway,
                                                Object command, UnaryOperator<ExecuteStepDefinition> options) {
        return context.execute(name, Map.of(), (processingContext, input) -> {
            FutureUtils.joinAndUnwrap(gateway.send(command, processingContext).getResultMessage());
            return Map.of();
        }, options);
    }

    public static <T> T awaitSuccess(WorkflowStepResult step, Class<T> type) {
        if (step.success()) {
            return step.resultAs(type).orElseThrow(
                    () -> new StepFailedException("Step '" + step.getStepName() + "' has no payload"));
        }
        if (step.timeout()) {
            throw new StepTimedOutException("Step '" + step.getStepName() + "' timed out");
        }
        throw step.error().orElseGet(
                () -> new StepFailedException("Step '" + step.getStepName() + "' did not succeed"));
    }

    public static Associations sameId(String property, String value) {
        return associate(payloadProperty(property), equalsTo(value));
    }
}
