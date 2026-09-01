package io.aegisops.incident.api;

import io.aegisops.incident.domain.IncidentSeverity;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public record CreateIncidentRequest(
        @NotBlank
        @Size(max = 100)
        String serviceName,

        @NotBlank
        @Size(max = 200)
        String title,

        @Size(max = 2000)
        String description,

        @NotNull
        IncidentSeverity severity
) {
}