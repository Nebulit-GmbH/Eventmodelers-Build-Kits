# Kurrent Quickstart

A minimal event-sourced application backed by [KurrentDB](https://kurrent.io) (formerly EventStoreDB)
for events and PostgreSQL for read models. Plain Java (no Kotlin), Spring Boot, Maven.

Unlike the OpenCQRS or Axon kits, there is no CQRS framework layer here — KurrentDB is just the event
store, and this project's own `decide`/`evolve` convention (see `.build-kit/CLAUDE.md`) implements
command handling directly against the [KurrentDB Java client](https://docs.kurrent.io/clients/java/).

## Prerequisites

- Java 21 or higher
- Maven 3.9+ (or use the bundled `./mvnw`)
- Docker (for running KurrentDB and PostgreSQL)

## Getting Started

Start KurrentDB and PostgreSQL:

```bash
docker-compose up -d
```

Then run the application:

```bash
./mvnw spring-boot:run
```

Alternatively, run the `QuickstartApplication` class from your IDE.

## Using the Application

The app listens on [http://localhost:8080](http://localhost:8080). KurrentDB's Admin UI is at
[http://localhost:2113](http://localhost:2113) (insecure/no-auth local dev mode).

## Project Structure

Slices live under `src/main/java/{basePackage}/slices/{context}/{slicename}/` — see `.build-kit/CLAUDE.md`
for the conventions this project follows and how new slices get built from the event model board.

## Useful resources

- [KurrentDB Documentation](https://docs.kurrent.io)
- [KurrentDB Java Client](https://docs.kurrent.io/clients/java/)
- [KurrentDB Java Client — Persistent Subscriptions](https://docs.kurrent.io/clients/java/persistent-subscriptions.html)
