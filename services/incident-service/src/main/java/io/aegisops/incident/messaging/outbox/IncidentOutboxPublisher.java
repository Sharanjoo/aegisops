package io.aegisops.incident.messaging.outbox;

import io.micrometer.core.instrument.MeterRegistry;
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
    private final MeterRegistry meterRegistry;

    public IncidentOutboxPublisher(
            IncidentOutboxEventRepository outboxRepository,
            KafkaTemplate<String, String> kafkaTemplate,
            @Value("${aegisops.kafka.topics.incident-events}")
            String incidentEventsTopic,
            MeterRegistry meterRegistry
    ) {
        this.outboxRepository = outboxRepository;
        this.kafkaTemplate = kafkaTemplate;
        this.incidentEventsTopic = incidentEventsTopic;
        this.meterRegistry = meterRegistry;

        // Registers both outcomes at 0 immediately, so this counter is
        // visible on the very first Prometheus scrape rather than only
        // after the first publication attempt.
        meterRegistry.counter(
                "aegisops.outbox.publications", "outcome", "succeeded"
        );
        meterRegistry.counter(
                "aegisops.outbox.publications", "outcome", "failed"
        );
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

                meterRegistry.counter(
                        "aegisops.outbox.publications",
                        "outcome", "succeeded"
                ).increment();

                LOGGER.info(
                        "Published incident event {} to {}",
                        event.getEventId(),
                        incidentEventsTopic
                );
            }
            catch (InterruptedException exception) {
                Thread.currentThread().interrupt();
                event.recordFailedAttempt(exception.getMessage());

                meterRegistry.counter(
                        "aegisops.outbox.publications",
                        "outcome", "failed"
                ).increment();

                LOGGER.warn(
                        "Interrupted while publishing incident event {}",
                        event.getEventId(),
                        exception
                );

                break;
            }
            catch (Exception exception) {
                event.recordFailedAttempt(rootMessage(exception));

                meterRegistry.counter(
                        "aegisops.outbox.publications",
                        "outcome", "failed"
                ).increment();

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