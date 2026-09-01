# AegisOps Incident Service

Spring Boot service responsible for creating, retrieving, and managing

AegisOps incidents.

## Technology

- Java 21

- Spring Boot 4

- Spring Web MVC

- Spring Data JPA

- MySQL 8.4

- Flyway

- Testcontainers

- Maven

## Architecture

The service separates its API, application, domain, and persistence layers:

```text

REST Controller

    -> Application Service

        -> JPA Repository

            -> MySQL