package io.aegisops.incident.api;

import io.aegisops.incident.domain.IncidentSeverity;
import io.aegisops.incident.domain.IncidentStatus;
import io.aegisops.incident.messaging.outbox.IncidentOutboxEventEntity;
import io.aegisops.incident.messaging.outbox.IncidentOutboxEventRepository;
import io.aegisops.incident.messaging.outbox.IncidentOutboxPublisher;
import io.aegisops.incident.messaging.outbox.OutboxPublicationStatus;
import io.aegisops.incident.persistence.IncidentEntity;
import io.aegisops.incident.persistence.IncidentJpaRepository;
import org.apache.kafka.clients.consumer.ConsumerConfig;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.apache.kafka.clients.consumer.ConsumerRecords;
import org.apache.kafka.clients.consumer.KafkaConsumer;
import org.apache.kafka.common.serialization.StringDeserializer;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.kafka.KafkaContainer;
import org.testcontainers.mysql.MySQLContainer;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Properties;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(
        properties = "aegisops.outbox.publisher.enabled=false"
)
@AutoConfigureMockMvc
@Testcontainers
class IncidentControllerIntegrationTest {

    @Container
    @ServiceConnection
    static final MySQLContainer MYSQL =
            new MySQLContainer("mysql:8.4")
                    .withDatabaseName("aegisops_test")
                    .withUsername("aegisops")
                    .withPassword("test_password");

    @Container
    static final KafkaContainer KAFKA =
            new KafkaContainer("apache/kafka:4.3.1");

    @DynamicPropertySource
    static void configureKafka(
            DynamicPropertyRegistry registry
    ) {
        registry.add(
                "spring.kafka.bootstrap-servers",
                KAFKA::getBootstrapServers
        );
    }

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private IncidentJpaRepository incidentRepository;

    @Autowired
    private IncidentOutboxEventRepository outboxRepository;

    @Autowired
    private IncidentOutboxPublisher outboxPublisher;

    @BeforeEach
    void cleanDatabase() {
        outboxRepository.deleteAll();
        incidentRepository.deleteAll();
    }

    @Test
    void createsAndListsIncident() throws Exception {
        mockMvc.perform(post("/api/v1/incidents")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "serviceName": "payments-api",
                                  "title": "Elevated HTTP error rate",
                                  "description": "HTTP 5xx threshold exceeded",
                                  "severity": "CRITICAL"
                                }
                                """))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.id").isNotEmpty())
                .andExpect(jsonPath("$.serviceName")
                        .value("payments-api"))
                .andExpect(jsonPath("$.severity")
                        .value("CRITICAL"))
                .andExpect(jsonPath("$.status")
                        .value("OPEN"));

        mockMvc.perform(get("/api/v1/incidents"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].serviceName")
                        .value("payments-api"));
    }

    @Test
    void rejectsInvalidIncident() throws Exception {
        mockMvc.perform(post("/api/v1/incidents")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "serviceName": "",
                                  "title": "",
                                  "severity": null
                                }
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.title")
                        .value("Invalid incident request"))
                .andExpect(jsonPath("$.errors.serviceName").exists())
                .andExpect(jsonPath("$.errors.title").exists())
                .andExpect(jsonPath("$.errors.severity").exists());
    }

    @Test
    void returnsNotFoundForUnknownIncident() throws Exception {
        UUID missingId = UUID.randomUUID();

        mockMvc.perform(get(
                        "/api/v1/incidents/{incidentId}",
                        missingId
                ))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.title")
                        .value("Incident not found"))
                .andExpect(jsonPath("$.detail")
                        .value("Incident not found: " + missingId));
    }

    @Test
    void updatesIncidentThroughLifecycle() throws Exception {
        UUID incidentId = saveIncident(IncidentStatus.OPEN);

        mockMvc.perform(patch(
                        "/api/v1/incidents/{incidentId}/status",
                        incidentId
                )
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "status": "ACKNOWLEDGED"
                                }
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id")
                        .value(incidentId.toString()))
                .andExpect(jsonPath("$.status")
                        .value("ACKNOWLEDGED"));

        mockMvc.perform(patch(
                        "/api/v1/incidents/{incidentId}/status",
                        incidentId
                )
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "status": "RESOLVED"
                                }
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status")
                        .value("RESOLVED"));

        mockMvc.perform(get(
                        "/api/v1/incidents/{incidentId}",
                        incidentId
                ))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status")
                        .value("RESOLVED"));
    }

    @Test
    void allowsIdempotentStatusUpdate() throws Exception {
        UUID incidentId =
                saveIncident(IncidentStatus.ACKNOWLEDGED);

        mockMvc.perform(patch(
                        "/api/v1/incidents/{incidentId}/status",
                        incidentId
                )
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "status": "ACKNOWLEDGED"
                                }
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status")
                        .value("ACKNOWLEDGED"));
    }

    @Test
    void rejectsBackwardStatusTransition() throws Exception {
        UUID incidentId = saveIncident(IncidentStatus.RESOLVED);

        mockMvc.perform(patch(
                        "/api/v1/incidents/{incidentId}/status",
                        incidentId
                )
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "status": "ACKNOWLEDGED"
                                }
                                """))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.title")
                        .value(
                                "Invalid incident status transition"
                        ))
                .andExpect(jsonPath("$.detail")
                        .value(
                                "Cannot transition incident status "
                                        + "from RESOLVED to ACKNOWLEDGED"
                        ));
    }

    @Test
    void rejectsStatusUpdateWithoutStatus() throws Exception {
        UUID incidentId = saveIncident(IncidentStatus.OPEN);

        mockMvc.perform(patch(
                        "/api/v1/incidents/{incidentId}/status",
                        incidentId
                )
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                }
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.title")
                        .value("Invalid incident request"))
                .andExpect(jsonPath("$.errors.status").exists());
    }

    @Test
    void publishesCreatedIncidentEventToKafka() throws Exception {
        mockMvc.perform(post("/api/v1/incidents")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "serviceName": "inventory-api",
                                  "title": "Inventory synchronization failure",
                                  "description": "Inventory updates stopped",
                                  "severity": "CRITICAL"
                                }
                                """))
                .andExpect(status().isCreated());

        List<IncidentOutboxEventEntity> pendingEvents =
                outboxRepository.findAll();

        assertEquals(1, pendingEvents.size());

        IncidentOutboxEventEntity pendingEvent =
                pendingEvents.get(0);

        assertEquals(
                OutboxPublicationStatus.PENDING,
                pendingEvent.getPublicationStatus()
        );
        assertEquals(0, pendingEvent.getPublicationAttempts());

        outboxPublisher.publishPendingEvents();

        IncidentOutboxEventEntity publishedEvent =
                outboxRepository
                        .findById(pendingEvent.getEventId())
                        .orElseThrow();

        assertEquals(
                OutboxPublicationStatus.PUBLISHED,
                publishedEvent.getPublicationStatus()
        );
        assertEquals(1, publishedEvent.getPublicationAttempts());

        ConsumerRecord<String, String> kafkaRecord =
                consumeIncidentEvent();

        assertEquals(
                publishedEvent.getAggregateId(),
                kafkaRecord.key()
        );
        assertTrue(
                kafkaRecord.value().contains(
                        publishedEvent.getEventId()
                )
        );
        assertTrue(
                kafkaRecord.value().contains(
                        publishedEvent.getAggregateId()
                )
        );
        assertTrue(
                kafkaRecord.value().contains(
                        "INCIDENT_CREATED"
                )
        );
    }

    private UUID saveIncident(IncidentStatus status) {
        UUID incidentId = UUID.randomUUID();
        Instant now = Instant.now();

        incidentRepository.save(
                new IncidentEntity(
                        incidentId.toString(),
                        "payments-api",
                        "Elevated HTTP error rate",
                        "HTTP 5xx threshold exceeded",
                        IncidentSeverity.CRITICAL,
                        status,
                        now,
                        now
                )
        );

        return incidentId;
    }

    private ConsumerRecord<String, String> consumeIncidentEvent() {
        Properties properties = new Properties();

        properties.put(
                ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG,
                KAFKA.getBootstrapServers()
        );
        properties.put(
                ConsumerConfig.GROUP_ID_CONFIG,
                "incident-outbox-test-" + UUID.randomUUID()
        );
        properties.put(
                ConsumerConfig.AUTO_OFFSET_RESET_CONFIG,
                "earliest"
        );
        properties.put(
                ConsumerConfig.ENABLE_AUTO_COMMIT_CONFIG,
                "false"
        );
        properties.put(
                ConsumerConfig.KEY_DESERIALIZER_CLASS_CONFIG,
                StringDeserializer.class.getName()
        );
        properties.put(
                ConsumerConfig.VALUE_DESERIALIZER_CLASS_CONFIG,
                StringDeserializer.class.getName()
        );

        try (KafkaConsumer<String, String> consumer =
                     new KafkaConsumer<>(properties)) {

            consumer.subscribe(
                    List.of("aegisops.incident.events.v1")
            );

            Instant deadline = Instant.now().plusSeconds(15);

            while (Instant.now().isBefore(deadline)) {
                ConsumerRecords<String, String> records =
                        consumer.poll(Duration.ofSeconds(1));

                if (!records.isEmpty()) {
                    return records.iterator().next();
                }
            }
        }

        throw new AssertionError(
                "No incident event received from Kafka"
        );
    }
}