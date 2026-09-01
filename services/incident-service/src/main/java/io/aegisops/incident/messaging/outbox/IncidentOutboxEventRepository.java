package io.aegisops.incident.messaging.outbox;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface IncidentOutboxEventRepository
        extends JpaRepository<IncidentOutboxEventEntity, String> {

    List<IncidentOutboxEventEntity>
            findTop100ByPublicationStatusOrderByCreatedAtAsc(
                    OutboxPublicationStatus publicationStatus
            );
}