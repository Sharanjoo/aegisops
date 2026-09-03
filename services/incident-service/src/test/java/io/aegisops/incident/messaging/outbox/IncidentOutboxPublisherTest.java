package io.aegisops.incident.messaging.outbox;

import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.kafka.support.SendResult;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class IncidentOutboxPublisherTest {

    private static final String TOPIC =
            "aegisops.incident.events.v1";

    @Mock
    private IncidentOutboxEventRepository outboxRepository;

    @Mock
    private KafkaTemplate<String, String> kafkaTemplate;

    private MeterRegistry meterRegistry;
    private IncidentOutboxPublisher outboxPublisher;

    @BeforeEach
    void setUp() {
        meterRegistry = new SimpleMeterRegistry();
        outboxPublisher = new IncidentOutboxPublisher(
                outboxRepository,
                kafkaTemplate,
                TOPIC,
                meterRegistry
        );
    }

    private double publicationsCount(String outcome) {
        return meterRegistry
                .counter(
                        "aegisops.outbox.publications",
                        "outcome", outcome
                )
                .count();
    }

    @Test
    void recordsFailedPublicationForRetry() {
        IncidentOutboxEventEntity event =
                new IncidentOutboxEventEntity(
                        UUID.randomUUID().toString(),
                        UUID.randomUUID().toString(),
                        "INCIDENT_CREATED",
                        1,
                        "{}",
                        Instant.now()
                );

        when(outboxRepository
                .findTop100ByPublicationStatusOrderByCreatedAtAsc(
                        OutboxPublicationStatus.PENDING
                ))
                .thenReturn(List.of(event));

        CompletableFuture<SendResult<String, String>>
                failedPublication = CompletableFuture.failedFuture(
                        new RuntimeException("Kafka unavailable")
                );

        when(kafkaTemplate.send(
                TOPIC,
                event.getAggregateId(),
                event.getPayload()
        )).thenReturn(failedPublication);

        outboxPublisher.publishPendingEvents();

        assertEquals(
                OutboxPublicationStatus.PENDING,
                event.getPublicationStatus()
        );
        assertEquals(1, event.getPublicationAttempts());
        assertEquals("Kafka unavailable", event.getLastError());
        assertNull(event.getPublishedAt());

        assertEquals(1.0, publicationsCount("failed"));
        assertEquals(0.0, publicationsCount("succeeded"));
    }

    @Test
    void recordsSuccessfulPublication() {
        IncidentOutboxEventEntity event =
                new IncidentOutboxEventEntity(
                        UUID.randomUUID().toString(),
                        UUID.randomUUID().toString(),
                        "INCIDENT_CREATED",
                        1,
                        "{}",
                        Instant.now()
                );

        when(outboxRepository
                .findTop100ByPublicationStatusOrderByCreatedAtAsc(
                        OutboxPublicationStatus.PENDING
                ))
                .thenReturn(List.of(event));

        CompletableFuture<SendResult<String, String>>
                successfulPublication = CompletableFuture.completedFuture(
                        null
                );

        when(kafkaTemplate.send(
                TOPIC,
                event.getAggregateId(),
                event.getPayload()
        )).thenReturn(successfulPublication);

        outboxPublisher.publishPendingEvents();

        assertEquals(
                OutboxPublicationStatus.PUBLISHED,
                event.getPublicationStatus()
        );

        assertEquals(1.0, publicationsCount("succeeded"));
        assertEquals(0.0, publicationsCount("failed"));
    }
}