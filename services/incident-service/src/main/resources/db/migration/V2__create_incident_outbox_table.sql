CREATE TABLE incident_outbox_events (
    event_id CHAR(36) NOT NULL,
    aggregate_id CHAR(36) NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    event_version INT NOT NULL,
    payload JSON NOT NULL,
    publication_status VARCHAR(20) NOT NULL,
    publication_attempts INT NOT NULL DEFAULT 0,
    created_at DATETIME(6) NOT NULL,
    published_at DATETIME(6) NULL,
    last_error VARCHAR(2000) NULL,

    PRIMARY KEY (event_id),

    INDEX idx_incident_outbox_status_created (
        publication_status,
        created_at
    ),

    INDEX idx_incident_outbox_aggregate (
        aggregate_id
    )
);