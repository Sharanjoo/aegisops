package io.aegisops.incident.api;

import io.aegisops.incident.domain.IncidentStatus;
import jakarta.validation.constraints.NotNull;

public record UpdateIncidentStatusRequest(
        @NotNull IncidentStatus status
) {
}