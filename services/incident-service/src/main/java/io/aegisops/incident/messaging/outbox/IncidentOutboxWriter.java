package io.aegisops.incident.messaging.outbox;

import io.aegisops.incident.messaging.IncidentEvent;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

@Component
public class IncidentOutboxWriter {

    private final IncidentOutboxEventRepository outboxRepository;
    private final ObjectMapper objectMapper;

    public IncidentOutboxWriter(
            IncidentOutboxEventRepository outboxRepository,
            ObjectMapper objectMapper
    ) {
        this.outboxRepository = outboxRepository;
        this.objectMapper = objectMapper;
    }

    public void append(IncidentEvent event) {
        String payload;

        try {
            payload = objectMapper.writeValueAsString(event);
        }
        catch (Exception exception) {
            throw new IllegalStateException(
                    "Failed to serialize incident event "
                            + event.eventId(),
                    exception
            );
        }

        outboxRepository.save(
                new IncidentOutboxEventEntity(
                        event.eventId().toString(),
                        event.incidentId().toString(),
                        event.eventType().name(),
                        event.eventVersion(),
                        payload,
                        event.occurredAt()
                )
        );
    }
}