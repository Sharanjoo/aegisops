package io.aegisops.incident.application;

import io.aegisops.incident.api.CreateIncidentRequest;
import io.aegisops.incident.domain.Incident;
import io.aegisops.incident.domain.IncidentStatus;
import io.aegisops.incident.exception.IncidentNotFoundException;
import io.aegisops.incident.persistence.IncidentJpaRepository;
import io.aegisops.incident.persistence.IncidentPersistenceMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Service
@Transactional
public class IncidentApplicationService {

    private final IncidentJpaRepository incidentRepository;
    private final IncidentPersistenceMapper incidentMapper;

    public IncidentApplicationService(
            IncidentJpaRepository incidentRepository,
            IncidentPersistenceMapper incidentMapper
    ) {
        this.incidentRepository = incidentRepository;
        this.incidentMapper = incidentMapper;
    }

    public Incident create(CreateIncidentRequest request) {
        Instant now = Instant.now();

        Incident incident = new Incident(
                UUID.randomUUID(),
                request.serviceName(),
                request.title(),
                request.description() == null ? "" : request.description(),
                request.severity(),
                IncidentStatus.OPEN,
                now,
                now
        );

        return incidentMapper.toDomain(
                incidentRepository.save(
                        incidentMapper.toEntity(incident)
                )
        );
    }

    @Transactional(readOnly = true)
    public List<Incident> findAll() {
        return incidentRepository
                .findAllByOrderByCreatedAtDesc()
                .stream()
                .map(incidentMapper::toDomain)
                .toList();
    }

    @Transactional(readOnly = true)
    public Incident findById(UUID incidentId) {
        return incidentRepository
                .findById(incidentId.toString())
                .map(incidentMapper::toDomain)
                .orElseThrow(() ->
                        new IncidentNotFoundException(incidentId)
                );
    }
}