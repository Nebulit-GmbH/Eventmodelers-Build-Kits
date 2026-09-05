# Feature Flag Patterns

House convention (not an OpenCQRS requirement), identical to `build-state-change`'s.

```java
@Component
@ConditionalOnProperty(prefix = "slices.{context}.automation", name = "{slicename}.enabled")
public class {AutomationName}Processor {
    // ...
}
```

Add to all config files when using `@ConditionalOnProperty`:

- `src/main/resources/application.properties` — `slices.{context}.automation.{slicename}.enabled=true`
- `src/test/resources/application.properties` — `slices.{context}.automation.{slicename}.enabled=false`

**Enable BOTH the automation and its target command's write slice** in any test exercising the
automation end-to-end — the target command handler won't run if its own slice's flag is off.
