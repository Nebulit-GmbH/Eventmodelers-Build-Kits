# Feature Flag Patterns

House convention (not a KurrentDB requirement) for letting a slice's components be toggled on/off
independently — useful for merging a slice's code before it's ready to go live on the board.

## Handling component + REST controller

```java
@Component
@ConditionalOnProperty(prefix = "slices.{context}.write", name = "{slicename}.enabled")
public class {SliceName}Handling {
    // ...
}

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

`src/test/resources/application.properties` (only relevant to a `@SpringBootTest` that boots the whole
context — irrelevant to the plain JUnit tests from Step 7 of the main skill, which never boot Spring at
all):

```properties
slices.{context}.write.{slicename}.enabled=false
```

## Automations that depend on this slice's command

If another slice's automation dispatches this slice's command, **enable both** the automation and this
write slice in any test that exercises the automation end-to-end.
