package io.aegisops.incident.messaging;

import io.aegisops.incident.domain.Incident;
import io.aegisops.incident.domain.IncidentSeverity;
import io.aegisops.incident.domain.IncidentStatus;

import java.time.Instant;
import java.util.UUID;

public record IncidentEvent(
        UUID eventId,
        IncidentEventType eventType,
        int eventVersion,
        Instant occurredAt,
        UUID incidentId,
        String serviceName,
        IncidentSeverity severity,
        IncidentStatus status,
        IncidentStatus previousStatus
) {

    private static final int CURRENT_VERSION = 1;

    public static IncidentEvent created(Incident incident) {
        return new IncidentEvent(
                UUID.randomUUID(),
                IncidentEventType.INCIDENT_CREATED,
                CURRENT_VERSION,
                incident.createdAt(),
                incident.id(),
                incident.serviceName(),
                incident.severity(),
                incident.status(),
                null
        );
    }

    public static IncidentEvent statusChanged(
            Incident incident,
            IncidentStatus previousStatus
    ) {
        return new IncidentEvent(
                UUID.randomUUID(),
                IncidentEventType.INCIDENT_STATUS_CHANGED,
                CURRENT_VERSION,
                incident.updatedAt(),
                incident.id(),
                incident.serviceName(),
                incident.severity(),
                incident.status(),
                previousStatus
        );
    }
}