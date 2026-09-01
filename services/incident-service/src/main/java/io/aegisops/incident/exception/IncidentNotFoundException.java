package io.aegisops.incident.exception;

import java.util.UUID;

public final class IncidentNotFoundException extends RuntimeException {

    public IncidentNotFoundException(UUID incidentId) {
        super("Incident not found: " + incidentId);
    }
}