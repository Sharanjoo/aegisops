package io.aegisops.incident.persistence;

import io.aegisops.incident.domain.Incident;
import org.springframework.stereotype.Component;

import java.util.UUID;

@Component
public class IncidentPersistenceMapper {

    public IncidentEntity toEntity(Incident incident) {
        return new IncidentEntity(
                incident.id().toString(),
                incident.serviceName(),
                incident.title(),
                incident.description(),
                incident.severity(),
                incident.status(),
                incident.createdAt(),
                incident.updatedAt()
        );
    }

    public Incident toDomain(IncidentEntity entity) {
        return new Incident(
                UUID.fromString(entity.getId()),
                entity.getServiceName(),
                entity.getTitle(),
                entity.getDescription(),
                entity.getSeverity(),
                entity.getStatus(),
                entity.getCreatedAt(),
                entity.getUpdatedAt()
        );
    }
}