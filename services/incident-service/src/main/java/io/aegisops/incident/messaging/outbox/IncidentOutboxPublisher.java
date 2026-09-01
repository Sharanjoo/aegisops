package io.aegisops.incident.messaging.outbox;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.concurrent.TimeUnit;

@Component
public class IncidentOutboxPublisher {

    private static final Logger LOGGER =
            LoggerFactory.getLogger(IncidentOutboxPublisher.class);

    private final IncidentOutboxEventRepository outboxRepository;
    private final KafkaTemplate<String, String> kafkaTemplate;
    private final String incidentEventsTopic;

    public IncidentOutboxPublisher(
            IncidentOutboxEventRepository outboxRepository,
            KafkaTemplate<String, String> kafkaTemplate,
            @Value("${aegisops.kafka.topics.incident-events}")
            String incidentEventsTopic
    ) {
        this.outboxRepository = outboxRepository;
        this.kafkaTemplate = kafkaTemplate;
        this.incidentEventsTopic = incidentEventsTopic;
    }


    @Transactional
    public void publishPendingEvents() {
        List<IncidentOutboxEventEntity> pendingEvents =
                outboxRepository
                        .findTop100ByPublicationStatusOrderByCreatedAtAsc(
                                OutboxPublicationStatus.PENDING
                        );

        for (IncidentOutboxEventEntity event : pendingEvents) {
            try {
                kafkaTemplate
                        .send(
                                incidentEventsTopic,
                                event.getAggregateId(),
                                event.getPayload()
                        )
                        .get(10, TimeUnit.SECONDS);

                event.markPublished(Instant.now());

                LOGGER.info(
                        "Published incident event {} to {}",
                        event.getEventId(),
                        incidentEventsTopic
                );
            }
            catch (InterruptedException exception) {
                Thread.currentThread().interrupt();
                event.recordFailedAttempt(exception.getMessage());

                LOGGER.warn(
                        "Interrupted while publishing incident event {}",
                        event.getEventId(),
                        exception
                );

                break;
            }
            catch (Exception exception) {
                event.recordFailedAttempt(rootMessage(exception));

                LOGGER.warn(
                        "Failed to publish incident event {}",
                        event.getEventId(),
                        exception
                );
            }
        }
    }

    private String rootMessage(Exception exception) {
        Throwable cause = exception.getCause();

        if (cause != null && cause.getMessage() != null) {
            return cause.getMessage();
        }

        return exception.getMessage();
    }
}