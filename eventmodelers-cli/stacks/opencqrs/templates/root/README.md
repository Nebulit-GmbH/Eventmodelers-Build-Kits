# OpenCQRS Quickstart

A minimal [OpenCQRS](https://docs.opencqrs.com) application, backed by [EventSourcingDB](https://www.eventsourcingdb.io)
for events and PostgreSQL for read models. Built using OpenCQRS, Spring Boot, and Maven, in plain Java (no Kotlin).

## Prerequisites

- Java 21 or higher
- Maven 3.9+ (or use the bundled `./mvnw`)
- Docker (for running EventSourcingDB and PostgreSQL)

## Getting Started

Start EventSourcingDB and PostgreSQL:

```bash
docker-compose up -d
```

Then run the application:

```bash
./mvnw spring-boot:run
```

Alternatively, run the `QuickstartApplication` class from your IDE.

## Using the Application

The app listens on [http://localhost:8080](http://localhost:8080). EventSourcingDB's API is at
[http://localhost:3000](http://localhost:3000) (API token: `secret` by default, see `.env`/`ESDB_API_TOKEN`).

## Project Structure

Slices live under `src/main/java/{basePackage}/slices/{context}/{slicename}/` — see `.build-kit/CLAUDE.md`
for the conventions this project follows and how new slices get built from the event model board.

## Useful resources

- [OpenCQRS Documentation](https://docs.opencqrs.com)
- [OpenCQRS Reference — Core Components](https://docs.opencqrs.com/reference/core_components/)
- [EventSourcingDB Documentation](https://docs.eventsourcingdb.io)
