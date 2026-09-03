package io.aegisops.incident.application;

import io.aegisops.incident.api.CreateIncidentRequest;
import io.aegisops.incident.api.UpdateIncidentStatusRequest;
import io.aegisops.incident.domain.IncidentSeverity;
import io.aegisops.incident.domain.IncidentStatus;
import io.aegisops.incident.exception.IncidentNotFoundException;
import io.aegisops.incident.exception.InvalidIncidentStatusTransitionException;
import io.aegisops.incident.messaging.outbox.IncidentOutboxWriter;
import io.aegisops.incident.persistence.IncidentEntity;
import io.aegisops.incident.persistence.IncidentJpaRepository;
import io.aegisops.incident.persistence.IncidentPersistenceMapper;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class IncidentApplicationServiceTest {

    @Mock
    private IncidentJpaRepository incidentRepository;

    @Mock
    private IncidentOutboxWriter outboxWriter;

    private final IncidentPersistenceMapper incidentMapper =
            new IncidentPersistenceMapper();

    private MeterRegistry meterRegistry;
    private IncidentApplicationService incidentService;

    @BeforeEach
    void setUp() {
        meterRegistry = new SimpleMeterRegistry();
        incidentService = new IncidentApplicationService(
                incidentRepository,
                incidentMapper,
                outboxWriter,
                meterRegistry
        );
    }

    private double createdCount(IncidentSeverity severity) {
        return meterRegistry
                .counter(
                        "aegisops.incident.creations",
                        "severity", severity.name()
                )
                .count();
    }

    private double statusChangeCount(
            IncidentStatus from,
            IncidentStatus to
    ) {
        return meterRegistry
                .counter(
                        "aegisops.incident.status.changes",
                        "from", from.name(),
                        "to", to.name()
                )
                .count();
    }

    @Test
    void createIncrementsCounterAndAppendsOutboxEvent() {
        when(incidentRepository.save(any()))
                .thenAnswer(invocation -> invocation.getArgument(0));

        incidentService.create(new CreateIncidentRequest(
                "cluster-agent-demo",
                "Pod is crash-looping",
                "description",
                IncidentSeverity.HIGH
        ));

        assertEquals(1.0, createdCount(IncidentSeverity.HIGH));
        verify(outboxWriter).append(any());
    }

    @Test
    void createDoesNotIncrementCounterWhenSaveFails() {
        when(incidentRepository.save(any()))
                .thenThrow(new RuntimeException("database unavailable"));

        assertThrows(
                RuntimeException.class,
                () -> incidentService.create(new CreateIncidentRequest(
                        "cluster-agent-demo",
                        "Pod is crash-looping",
                        "description",
                        IncidentSeverity.HIGH
                ))
        );

        assertEquals(0.0, createdCount(IncidentSeverity.HIGH));
    }

    @Test
    void updateStatusIncrementsCounterOnValidTransition() {
        UUID incidentId = UUID.randomUUID();
        IncidentEntity entity = existingEntity(
                incidentId,
                IncidentStatus.OPEN
        );

        when(incidentRepository.findById(incidentId.toString()))
                .thenReturn(Optional.of(entity));
        when(incidentRepository.save(entity)).thenReturn(entity);

        incidentService.updateStatus(
                incidentId,
                new UpdateIncidentStatusRequest(
                        IncidentStatus.ACKNOWLEDGED
                )
        );

        assertEquals(
                1.0,
                statusChangeCount(
                        IncidentStatus.OPEN,
                        IncidentStatus.ACKNOWLEDGED
                )
        );
        verify(outboxWriter).append(any());
    }

    @Test
    void updateStatusDoesNotIncrementCounterWhenStatusUnchanged() {
        UUID incidentId = UUID.randomUUID();
        IncidentEntity entity = existingEntity(
                incidentId,
                IncidentStatus.OPEN
        );

        when(incidentRepository.findById(incidentId.toString()))
                .thenReturn(Optional.of(entity));

        incidentService.updateStatus(
                incidentId,
                new UpdateIncidentStatusRequest(IncidentStatus.OPEN)
        );

        assertEquals(
                0.0,
                statusChangeCount(
                        IncidentStatus.OPEN,
                        IncidentStatus.OPEN
                )
        );
    }

    @Test
    void updateStatusDoesNotIncrementCounterOnInvalidTransition() {
        UUID incidentId = UUID.randomUUID();
        IncidentEntity entity = existingEntity(
                incidentId,
                IncidentStatus.ACKNOWLEDGED
        );

        when(incidentRepository.findById(incidentId.toString()))
                .thenReturn(Optional.of(entity));

        assertThrows(
                InvalidIncidentStatusTransitionException.class,
                () -> incidentService.updateStatus(
                        incidentId,
                        new UpdateIncidentStatusRequest(
                                IncidentStatus.OPEN
                        )
                )
        );

        assertEquals(
                0.0,
                statusChangeCount(
                        IncidentStatus.ACKNOWLEDGED,
                        IncidentStatus.OPEN
                )
        );
    }

    @Test
    void updateStatusDoesNotIncrementCounterWhenIncidentMissing() {
        UUID incidentId = UUID.randomUUID();

        when(incidentRepository.findById(incidentId.toString()))
                .thenReturn(Optional.empty());

        assertThrows(
                IncidentNotFoundException.class,
                () -> incidentService.updateStatus(
                        incidentId,
                        new UpdateIncidentStatusRequest(
                                IncidentStatus.ACKNOWLEDGED
                        )
                )
        );

        assertEquals(
                0.0,
                statusChangeCount(
                        IncidentStatus.OPEN,
                        IncidentStatus.ACKNOWLEDGED
                )
        );
    }

    private IncidentEntity existingEntity(
            UUID incidentId,
            IncidentStatus status
    ) {
        Instant now = Instant.now();

        return new IncidentEntity(
                incidentId.toString(),
                "cluster-agent-demo",
                "Pod is crash-looping",
                "description",
                IncidentSeverity.HIGH,
                status,
                now,
                now
        );
    }
}
