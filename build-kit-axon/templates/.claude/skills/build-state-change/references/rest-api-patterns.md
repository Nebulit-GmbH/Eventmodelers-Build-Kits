# REST API Patterns

Ground truth: `RegisterCustomerRestController`
(`src/main/java/.../foo/register/RegisterCustomerRestController.java`), this project's only REST
controller for a write slice. This project uses WebFlux (`spring-boot-starter-webflux`), not
`spring-boot-starter-web` — controller methods return `Mono<ResponseEntity<...>>`, not `ResponseEntity`
directly, and tests use `WebTestClient`, not `MockMvc`.

## Controller

```java
package io.axoniq.quickstart.slices.{context}.{slicename};

import org.axonframework.messaging.commandhandling.gateway.CommandGateway;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Mono;

@RestController
@ConditionalOnProperty(prefix = "slices.{context}.write", name = "{slicename}.enabled")
public class {SliceName}RestController {

    private final CommandGateway commandGateway;

    public {SliceName}RestController(CommandGateway commandGateway) {
        this.commandGateway = commandGateway;
    }

    @PostMapping("/api/{context}/{resource}")
    public Mono<ResponseEntity<Void>> handle(@RequestBody {SliceName}RequestBody body) {
        var command = new {SliceName}Command(body.field1(), body.idField());
        return Mono.fromFuture(commandGateway.send(command).getResultMessage())
            .map(ignored -> ResponseEntity.ok().<Void>build())
            .onErrorResume(e -> Mono.just(ResponseEntity.badRequest().<Void>build()));
    }

    public record {SliceName}RequestBody(String field1, String idField) {}
}
```

Notes, all taken directly from the real controller:
- `CommandGateway.send(command)` returns a `CommandResult`; `.getResultMessage()` on it returns a
  `CompletableFuture<? extends Message>` — wrap with `Mono.fromFuture(...)`, don't call `.get()`/`.join()`.
- Success → `200` with an empty body (`ResponseEntity.ok().<Void>build()`); any exception from the
  command handler (e.g. the `IllegalStateException` a business-rule violation throws) → `400` via
  `onErrorResume`. There's no per-exception-type branching here — every failure maps to `400`.
- The request body record (`{SliceName}RequestBody`) is a plain nested record matching the command's
  fields — it is not the Command itself; the controller maps one to the other explicitly.
- `@ConditionalOnProperty` uses the exact same `prefix`/`name` pair as the command handler (see
  Step 6 in `SKILL.md`) — both gate on the same flag.

## Test — `WebTestClient` (not `MockMvc`)

No REST test exists yet in this repo for `RegisterCustomerRestController` — this is the recommended
shape for the first one, matching the project's WebFlux stack and the `@ConditionalOnProperty`
feature-flag convention (tests disable all slices by default; opt in per test class):

```java
package io.axoniq.quickstart.slices.{context}.{slicename};

import org.axonframework.messaging.commandhandling.gateway.CommandGateway;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.reactive.WebFluxTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Bean;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.reactive.server.WebTestClient;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.verify;

@WebFluxTest({SliceName}RestController.class)
@TestPropertySource(properties = "slices.{context}.write.{slicename}.enabled=true")
class {SliceName}RestControllerTest {

    @Autowired
    private WebTestClient webTestClient;

    @MockBean
    private CommandGateway commandGateway;

    @Test
    void acceptsValidRequest() {
        var resultMessage = /* stub a CompletableFuture<CommandResultMessage<?>> completing normally */;
        doReturn(resultMessage).when(commandGateway).send(any()).getResultMessage();

        webTestClient.post().uri("/api/{context}/{resource}")
            .bodyValue(new {SliceName}RestController.{SliceName}RequestBody("value1", "id-1"))
            .exchange()
            .expectStatus().isOk();

        verify(commandGateway).send(new {SliceName}Command("value1", "id-1"));
    }

    @Test
    void mapsHandlerFailureTo400() {
        var resultMessage = /* stub a CompletableFuture failing with IllegalStateException */;
        doReturn(resultMessage).when(commandGateway).send(any()).getResultMessage();

        webTestClient.post().uri("/api/{context}/{resource}")
            .bodyValue(new {SliceName}RestController.{SliceName}RequestBody("value1", "id-1"))
            .exchange()
            .expectStatus().isBadRequest();
    }
}
```

`CommandGateway.send(cmd)` returns `CommandResult`; stub with `doReturn(...).when(mock).getResultMessage()`
— `when(mock.send(...)).thenReturn(...)` hits a wildcard-capture generics compile error on this API.