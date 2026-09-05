# Integration Test Patterns (Real KurrentDB via Testcontainers)

The pure `evolve`/`decide` unit test (Step 7 of the main skill) is the primary and default test for a
write slice — it's the one to write for every slice. Reach for this pattern only when you specifically
need to verify the `EventStore`/`*Handling` wiring itself (the read-replay-decide-append round trip,
optimistic concurrency) rather than a business rule, which the pure test already covers.

There is no official Testcontainers module for KurrentDB — use the generic container support directly.

## Container setup

```java
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.wait.strategy.Wait;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

import java.time.Duration;

@Testcontainers
class {SliceName}HandlingIntegrationTest {

    static GenericContainer<?> kurrentdb = new GenericContainer<>(
            DockerImageName.parse("docker.kurrent.io/kurrent-latest/kurrentdb:latest"))
            .withExposedPorts(2113)
            .withCommand("--insecure", "--run-projections=All", "--enable-atom-pub-over-http")
            .waitingFor(Wait.forHttp("/health/live").forPort(2113).forStatusCode(204)
                    .withStartupTimeout(Duration.ofSeconds(90)));

    static {SliceName}Handling handling;

    @BeforeAll
    static void setUp() {
        kurrentdb.start();
        var settings = KurrentDBConnectionString.parseOrThrow(
                "kurrentdb://" + kurrentdb.getHost() + ":" + kurrentdb.getMappedPort(2113) + "?tls=false");
        var client = KurrentDBClient.create(settings);
        handling = new {SliceName}Handling(new EventStore(client));
    }

    @AfterAll
    static void tearDown() {
        kurrentdb.stop();
    }

    // ... @Test methods calling handling.handle(...) directly, no Spring context needed —
    // {SliceName}Handling's only dependency is EventStore/KurrentDBClient, both wired by hand above.
}
```

## Key points

- **No Spring context needed** — construct `KurrentDBClient` and the slice's `*Handling` class
  directly. A `@SpringBootTest` here would also try to build the JPA/Postgres datasource (since the
  full application context wires that up too), which this test has no need of and no container for.
- **No Postgres needed either** — that's the read-model side's concern (`build-state-view`), not this
  one's.
- A 90-second startup timeout is intentionally generous: under ARM/amd64 emulation (Apple Silicon
  Docker Desktop), this image's startup is slow and occasionally needs a retry — this is a known
  characteristic of running an amd64-only image under emulation, not a bug in the client or this
  pattern. If a run fails with a container-startup timeout or an early connection error, retry once
  before investigating further.
- Use a fresh, unique id (e.g. `"id-" + System.nanoTime()`) per test method so tests don't collide on
  the same stream when run in the same container instance.
