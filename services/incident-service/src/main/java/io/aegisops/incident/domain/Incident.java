package io.aegisops.incident.domain;

import java.time.Instant;
import java.util.UUID;

public record Incident(
        UUID id,
        String serviceName,
        String title,
        String description,
        IncidentSeverity severity,
        IncidentStatus status,
        Instant createdAt,
        Instant updatedAt
) {
}