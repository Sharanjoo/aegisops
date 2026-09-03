# syntax=docker/dockerfile:1.7

# ---- Build stage: compiles the executable jar with the Maven wrapper ----
FROM eclipse-temurin:21.0.9_10-jdk-alpine AS build

WORKDIR /src

COPY .mvn/ .mvn/
COPY mvnw pom.xml ./
RUN ./mvnw --batch-mode dependency:go-offline

COPY src ./src
RUN ./mvnw --batch-mode clean package -DskipTests


# ---- Runtime stage: JRE only, non-root, just the built jar ----
FROM eclipse-temurin:21.0.9_10-jre-alpine AS runtime

RUN addgroup -S aegisops \
    && adduser -S aegisops -G aegisops

WORKDIR /app

COPY --from=build --chown=aegisops:aegisops \
    /src/target/incident-service-*.jar \
    /app/app.jar

USER aegisops

EXPOSE 8080

HEALTHCHECK \
    --interval=30s \
    --timeout=3s \
    --start-period=45s \
    --retries=3 \
    CMD wget -qO- http://127.0.0.1:8080/actuator/health | grep -q '"status":"UP"' || exit 1

# Exec form so the JVM receives SIGTERM directly from Docker/Kubernetes and
# can shut down gracefully (see server.shutdown=graceful in
# application.properties) instead of a shell swallowing the signal.
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
