# Feature Flag Patterns

House convention (not an OpenCQRS requirement) for letting a slice's components be toggled on/off
independently — useful for merging a slice's code before it's ready to go live on the board.

## Command handler + REST controller

```java
@CommandHandlerConfiguration
@ConditionalOnProperty(prefix = "slices.{context}.write", name = "{slicename}.enabled")
public class {SliceName}Handling {
    // ...
}
```

`@ConditionalOnProperty` works the same way on a `@CommandHandlerConfiguration`-annotated class as on any
other Spring `@Configuration` — the whole class (and every `@CommandHandling`/`@StateRebuilding` method
in it) is skipped when the flag is off.

```java
@RestController
@ConditionalOnProperty(prefix = "slices.{context}.write", name = "{slicename}.enabled")
public class {SliceName}RestController {
    // ...
}
```

## Configuration files

`src/main/resources/application.properties`:

```properties
slices.{context}.write.{slicename}.enabled=true
```

`src/test/resources/application.properties` (default off in plain `@SpringBootTest`s that boot the
whole context — irrelevant to `@CommandHandlingTest`, which never boots the full context):

```properties
slices.{context}.write.{slicename}.enabled=false
```

## Automations that depend on this slice's command

If another slice's automation dispatches this slice's command, **enable both** the automation and this
write slice in any test that exercises the automation end-to-end.
