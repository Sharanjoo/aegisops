package io.aegisops.incident.application;

import io.aegisops.incident.api.CreateIncidentRequest;
import io.aegisops.incident.domain.Incident;
import io.aegisops.incident.domain.IncidentStatus;
import io.aegisops.incident.exception.IncidentNotFoundException;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class IncidentApplicationService {

    private final Map<UUID, Incident> incidents = new ConcurrentHashMap<>();

    public Incident create(CreateIncidentRequest request) {
        Instant now = Instant.now();
        UUID incidentId = UUID.randomUUID();

        Incident incident = new Incident(
                incidentId,
                request.serviceName(),
                request.title(),
                request.description() == null ? "" : request.description(),
                request.severity(),
                IncidentStatus.OPEN,
                now,
                now
        );

        incidents.put(incidentId, incident);
        return incident;
    }

    public List<Incident> findAll() {
        return incidents.values()
                .stream()
                .sorted(Comparator.comparing(Incident::createdAt).reversed())
                .toList();
    }

    public Incident findById(UUID incidentId) {
        Incident incident = incidents.get(incidentId);

        if (incident == null) {
            throw new IncidentNotFoundException(incidentId);
        }

        return incident;
    }
}