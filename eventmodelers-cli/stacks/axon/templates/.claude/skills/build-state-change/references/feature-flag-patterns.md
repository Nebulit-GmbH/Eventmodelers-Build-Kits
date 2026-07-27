# Feature Flag Patterns

This project's one supported approach: `@ConditionalOnProperty` on the handler and REST controller
(**not** on the entity — verified against the `RegisterCustomer`, `AllCustomers`, and `NotifyCustomer`
slices, none of which put the annotation on their entity/projector-internals class). Examples use a
generic `Ordering` bounded context.

## Annotation on slice components

```java
// Handler
@ConditionalOnProperty(prefix = "slices.ordering.write", name = "placeorder.enabled")
@Component
public class PlaceOrderCommandHandler { ... }

// REST controller (if applicable)
@ConditionalOnProperty(prefix = "slices.ordering.write", name = "placeorder.enabled")
@RestController
public class PlaceOrderRestController { ... }
```

## `application.properties` (main — enable by default)

```properties
slices.ordering.write.placeorder.enabled=true
slices.ordering.read.getorders.enabled=true
slices.ordering.automation.notifycustomeronorder.enabled=true
```

## `application.properties` (test — disable by default)

```properties
slices.ordering.write.placeorder.enabled=false
slices.ordering.read.getorders.enabled=false
slices.ordering.automation.notifycustomeronorder.enabled=false
```

This only matters for tests that boot a Spring context (`@SpringBootTest`). The `AxonTestFixture`
unit-test pattern in [axon-test-fixture-patterns.md](axon-test-fixture-patterns.md) never boots Spring,
so these properties don't affect it either way.

## `META-INF/additional-spring-configuration-metadata.json`

Register each property so IDEs auto-complete and validate it:

```json
{
  "properties": [
    {
      "name": "slices.ordering.write.placeorder.enabled",
      "type": "java.lang.Boolean",
      "description": "Enable/disable the PlaceOrder write slice in the Ordering bounded context."
    }
  ]
}
```