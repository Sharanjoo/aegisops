package io.aegisops.incident.messaging.outbox;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;

@Entity
@Table(name = "incident_outbox_events")
public class IncidentOutboxEventEntity {

    @Id
    @Column(
            name = "event_id",
            nullable = false,
            updatable = false,
            columnDefinition = "char(36)"
    )
    private String eventId;

    @Column(
            name = "aggregate_id",
            nullable = false,
            updatable = false,
            columnDefinition = "char(36)"
    )
    private String aggregateId;

    @Column(
            name = "event_type",
            nullable = false,
            updatable = false,
            length = 100
    )
    private String eventType;

    @Column(
            name = "event_version",
            nullable = false,
            updatable = false
    )
    private int eventVersion;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(
            name = "payload",
            nullable = false,
            updatable = false,
            columnDefinition = "json"
    )
    private String payload;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.VARCHAR)
    @Column(
            name = "publication_status",
            nullable = false,
            length = 20
    )
    private OutboxPublicationStatus publicationStatus;

    @Column(name = "publication_attempts", nullable = false)
    private int publicationAttempts;

    @Column(
            name = "created_at",
            nullable = false,
            updatable = false,
            columnDefinition = "datetime(6)"
    )
    private Instant createdAt;

    @Column(
            name = "published_at",
            columnDefinition = "datetime(6)"
    )
    private Instant publishedAt;

    @Column(name = "last_error", length = 2000)
    private String lastError;

    protected IncidentOutboxEventEntity() {
    }

    public IncidentOutboxEventEntity(
            String eventId,
            String aggregateId,
            String eventType,
            int eventVersion,
            String payload,
            Instant createdAt
    ) {
        this.eventId = eventId;
        this.aggregateId = aggregateId;
        this.eventType = eventType;
        this.eventVersion = eventVersion;
        this.payload = payload;
        this.publicationStatus = OutboxPublicationStatus.PENDING;
        this.publicationAttempts = 0;
        this.createdAt = createdAt;
    }

    public String getEventId() {
        return eventId;
    }

    public String getAggregateId() {
        return aggregateId;
    }

    public String getEventType() {
        return eventType;
    }

    public int getEventVersion() {
        return eventVersion;
    }

    public String getPayload() {
        return payload;
    }

    public OutboxPublicationStatus getPublicationStatus() {
        return publicationStatus;
    }

    public int getPublicationAttempts() {
        return publicationAttempts;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getPublishedAt() {
        return publishedAt;
    }

    public String getLastError() {
        return lastError;
    }

    public void markPublished(Instant publishedAt) {
        this.publicationStatus = OutboxPublicationStatus.PUBLISHED;
        this.publicationAttempts++;
        this.publishedAt = publishedAt;
        this.lastError = null;
    }

    public void recordFailedAttempt(String errorMessage) {
        this.publicationAttempts++;
        this.lastError = truncate(errorMessage);
    }

    private String truncate(String value) {
        if (value == null || value.length() <= 2000) {
            return value;
        }

        return value.substring(0, 2000);
    }
}