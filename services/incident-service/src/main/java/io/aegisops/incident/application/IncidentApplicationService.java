package io.aegisops.incident.application;

import io.aegisops.incident.api.CreateIncidentRequest;
import io.aegisops.incident.api.UpdateIncidentStatusRequest;
import io.aegisops.incident.domain.Incident;
import io.aegisops.incident.domain.IncidentSeverity;
import io.aegisops.incident.domain.IncidentStatus;
import io.aegisops.incident.exception.IncidentNotFoundException;
import io.aegisops.incident.exception.InvalidIncidentStatusTransitionException;
import io.aegisops.incident.messaging.IncidentEvent;
import io.aegisops.incident.messaging.outbox.IncidentOutboxWriter;
import io.aegisops.incident.persistence.IncidentEntity;
import io.aegisops.incident.persistence.IncidentJpaRepository;
import io.aegisops.incident.persistence.IncidentPersistenceMapper;
import io.micrometer.core.instrument.MeterRegistry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Service
@Transactional
public class IncidentApplicationService {

    private static final Logger LOGGER =
            LoggerFactory.getLogger(IncidentApplicationService.class);

    private final IncidentJpaRepository incidentRepository;
    private final IncidentPersistenceMapper incidentMapper;
    private final IncidentOutboxWriter outboxWriter;
    private final MeterRegistry meterRegistry;

    public IncidentApplicationService(
            IncidentJpaRepository incidentRepository,
            IncidentPersistenceMapper incidentMapper,
            IncidentOutboxWriter outboxWriter,
            MeterRegistry meterRegistry
    ) {
        this.incidentRepository = incidentRepository;
        this.incidentMapper = incidentMapper;
        this.outboxWriter = outboxWriter;
        this.meterRegistry = meterRegistry;

        // Registers each bounded severity at 0 immediately, rather than
        // only after the first incident of that severity is ever created -
        // so the counter is visible on the very first Prometheus scrape.
        for (IncidentSeverity severity : IncidentSeverity.values()) {
            meterRegistry.counter(
                    "aegisops.incident.creations",
                    "severity", severity.name()
            );
        }
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

        Incident savedIncident = incidentMapper.toDomain(
                incidentRepository.save(
                        incidentMapper.toEntity(incident)
                )
        );

        outboxWriter.append(
                IncidentEvent.created(savedIncident)
        );

        meterRegistry.counter(
                "aegisops.incident.creations",
                "severity", savedIncident.severity().name()
        ).increment();

        LOGGER.info(
                "Created incident {} for service {} (severity={})",
                savedIncident.id(),
                savedIncident.serviceName(),
                savedIncident.severity()
        );

        return savedIncident;
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

    public Incident updateStatus(
            UUID incidentId,
            UpdateIncidentStatusRequest request
    ) {
        IncidentEntity incidentEntity = incidentRepository
                .findById(incidentId.toString())
                .orElseThrow(() ->
                        new IncidentNotFoundException(incidentId)
                );

        IncidentStatus currentStatus = incidentEntity.getStatus();
        IncidentStatus targetStatus = request.status();

        if (currentStatus == targetStatus) {
            return incidentMapper.toDomain(incidentEntity);
        }

        if (!currentStatus.canTransitionTo(targetStatus)) {
            throw new InvalidIncidentStatusTransitionException(
                    currentStatus,
                    targetStatus
            );
        }

        incidentEntity.updateStatus(targetStatus, Instant.now());

        Incident updatedIncident = incidentMapper.toDomain(
                incidentRepository.save(incidentEntity)
        );

        outboxWriter.append(
                IncidentEvent.statusChanged(
                        updatedIncident,
                        currentStatus
                )
        );

        meterRegistry.counter(
                "aegisops.incident.status.changes",
                "from", currentStatus.name(),
                "to", targetStatus.name()
        ).increment();

        LOGGER.info(
                "Incident {} status changed {} -> {}",
                updatedIncident.id(),
                currentStatus,
                targetStatus
        );

        return updatedIncident;
    }
}