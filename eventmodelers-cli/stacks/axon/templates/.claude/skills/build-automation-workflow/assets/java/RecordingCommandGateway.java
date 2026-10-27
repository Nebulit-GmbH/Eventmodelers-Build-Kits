package io.myapp.orders;

import org.axonframework.common.infra.ComponentDescriptor;
import org.axonframework.messaging.commandhandling.GenericCommandResultMessage;
import org.axonframework.messaging.commandhandling.gateway.CommandGateway;
import org.axonframework.messaging.commandhandling.gateway.CommandResult;
import org.axonframework.messaging.commandhandling.gateway.FutureCommandResult;
import org.axonframework.messaging.core.Message;
import org.axonframework.messaging.core.MessageType;
import org.axonframework.messaging.core.Metadata;
import org.axonframework.messaging.core.unitofwork.ProcessingContext;
import org.jspecify.annotations.Nullable;

import java.util.List;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;

/** Test double; does not prove command-handler behavior or external-effect idempotency. */
class RecordingCommandGateway implements CommandGateway {
    final List<Object> sent = new CopyOnWriteArrayList<>();
    final List<@Nullable ProcessingContext> contexts = new CopyOnWriteArrayList<>();
    private final Set<Class<?>> failing = ConcurrentHashMap.newKeySet();

    RecordingCommandGateway failOn(Class<?> type) {
        failing.add(type);
        return this;
    }

    @Override
    public CommandResult send(Object command, Metadata metadata, @Nullable ProcessingContext context) {
        sent.add(command);
        contexts.add(context);
        CompletableFuture<Message> result = failing.contains(command.getClass())
                ? CompletableFuture.failedFuture(new IllegalStateException(command.getClass().getSimpleName() + " rejected"))
                : CompletableFuture.completedFuture(new GenericCommandResultMessage(new MessageType("done"), null));
        return new FutureCommandResult(result);
    }

    @Override
    public void describeTo(ComponentDescriptor descriptor) {
        descriptor.describeProperty("recorded", sent.size());
    }
}
