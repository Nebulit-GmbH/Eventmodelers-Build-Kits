# REST API Patterns (WebMVC)

This project uses plain Spring **WebMVC** — blocking `ResponseEntity`, not WebFlux/`Mono`.
`spring-boot-starter-webmvc` (not `-web`, not `-webflux`) is on the classpath.

## Controller

```java
package {basePackage}.slices.{context}.{slicename};

import com.opencqrs.framework.command.CommandRouter;
import jakarta.servlet.http.HttpServletRequest;
import java.net.URI;
import java.util.Map;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/{context}")
public class {SliceName}RestController {

    @Autowired
    private CommandRouter commandRouter;

    @PostMapping("/{resource}")
    public ResponseEntity<Void> handle(@RequestBody @Validated {SliceName}RequestBody body, HttpServletRequest request) {
        var command = new {SliceName}Command(body.field1(), body.idField());
        String id = commandRouter.send(command, Map.of("request-uri", request.getRequestURI()));
        return ResponseEntity.created(URI.create("/api/{context}/" + id)).build();
    }

    public record {SliceName}RequestBody(String field1, String idField) {}
}
```

For a command with no useful return value, drop the `String id = ...` capture and just call
`commandRouter.send(command, ...)`, returning `ResponseEntity.ok().build()`.

## Exception mapping

Check first whether the project already has a shared `@ControllerAdvice` (e.g.
`{basePackage}.rest.ExceptionControllerAdvice`) before adding a new one — most projects need exactly
one, covering the framework's own exceptions project-wide:

```java
package {basePackage}.rest;

import com.opencqrs.framework.CqrsFrameworkException;
import com.opencqrs.framework.command.CommandSubjectAlreadyExistsException;
import com.opencqrs.framework.command.CommandSubjectDoesNotExistException;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@ControllerAdvice
public class ExceptionControllerAdvice {

    private Map<String, Object> jsonError(Exception e) {
        return Map.of("message", e.getMessage());
    }

    @ExceptionHandler(CommandSubjectDoesNotExistException.class)
    @ResponseStatus(HttpStatus.NOT_FOUND)
    @ResponseBody
    public Map<String, Object> subjectNotFound(CommandSubjectDoesNotExistException e) {
        return jsonError(e);
    }

    @ExceptionHandler(CommandSubjectAlreadyExistsException.class)
    @ResponseStatus(HttpStatus.CONFLICT)
    @ResponseBody
    public Map<String, Object> subjectAlreadyExists(CommandSubjectAlreadyExistsException e) {
        return jsonError(e);
    }

    @ExceptionHandler(CqrsFrameworkException.TransientException.class)
    @ResponseStatus(HttpStatus.CONFLICT)
    @ResponseBody
    public Map<String, Object> transientErrors(CqrsFrameworkException.TransientException e) {
        return jsonError(e);
    }

    @ExceptionHandler(CqrsFrameworkException.NonTransientException.class)
    @ResponseStatus(HttpStatus.INTERNAL_SERVER_ERROR)
    @ResponseBody
    public Map<String, Object> nonTransientErrors(CqrsFrameworkException.NonTransientException e) {
        return jsonError(e);
    }
}
```

A slice's own business-rule exception (e.g. `BookAlreadyLentException`) maps to its own status with a
plain `@ResponseStatus` on the exception class itself — no `@ExceptionHandler` needed for those:

```java
@ResponseStatus(HttpStatus.CONFLICT)
public class {SliceName}RuleViolationException extends RuntimeException {}
```

## Controller test (`@WebMvcTest` + `MockMvc`)

Standard Spring Boot Test — not OpenCQRS-specific. Mock the `CommandRouter` bean itself; this is a thin
HTTP-mapping test, not a business-rule test (that's Step 7's `CommandHandlingTestFixture` test).

**This project is on Spring Boot 4** — `@WebMvcTest` moved to the `spring-boot-webmvc-test` artifact
under package `org.springframework.boot.webmvc.test.autoconfigure` (not the Boot 3
`org.springframework.boot.test.autoconfigure.web.servlet` package). Verified by compiling and running
against the real dependency.

```java
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest({SliceName}RestController.class)
class {SliceName}RestControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private CommandRouter commandRouter;

    @Test
    void postsCommandAndReturnsCreated() throws Exception {
        given(commandRouter.send(any(), any())).willReturn("id-1");

        mockMvc.perform(post("/api/{context}/{resource}")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                            {"field1": "value1", "idField": "id-1"}
                            """))
                .andExpect(status().isCreated());
    }
}
```
