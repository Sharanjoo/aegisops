# # AegisOps Incident Service

Spring Boot service responsible for creating, retrieving, persisting, and

managing the lifecycle of AegisOps incidents.

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

```

Flyway manages the database schema, while integration tests use a temporary

MySQL Testcontainer.

## REST API

| Method | Endpoint | Description |

|---|---|---|

| `POST` | `/api/v1/incidents` | Create an incident |

| `GET` | `/api/v1/incidents` | List incidents |

| `GET` | `/api/v1/incidents/{incidentId}` | Retrieve an incident |

| `PATCH` | `/api/v1/incidents/{incidentId}/status` | Update incident status |

| `GET` | `/actuator/health` | Check service health |

## Incident Lifecycle

Supported status transitions:

```text

OPEN -> ACKNOWLEDGED -> RESOLVED

OPEN -----------------> RESOLVED

```

Sending the current status again is idempotent. Backward or invalid

transitions return HTTP `409 Conflict`.

Example status update:

```json

{

  "status": "ACKNOWLEDGED"

}

```

## Run Locally

From the repository root, start MySQL:

```powershell

docker compose `

    -f .\infrastructure\local\compose.yaml `

    up -d mysql

```

Set the local database password:

```powershell

$env:AEGISOPS_DB_PASSWORD = "aegisops_dev_password"

```

Start the service:

```powershell

cd .\services\incident-service

.\mvnw.cmd spring-boot:run -DskipTests

```

The service runs at `http://localhost:8080`.

## Run Tests

Docker must be running because integration tests use Testcontainers.

```powershell

cd .\services\incident-service

.\mvnw.cmd clean test

```