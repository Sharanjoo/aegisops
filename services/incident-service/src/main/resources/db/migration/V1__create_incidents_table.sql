CREATE TABLE incidents (
    id CHAR(36) NOT NULL,
    service_name VARCHAR(100) NOT NULL,
    title VARCHAR(200) NOT NULL,
    description VARCHAR(2000) NOT NULL,
    severity VARCHAR(20) NOT NULL,
    status VARCHAR(20) NOT NULL,
    created_at DATETIME(6) NOT NULL,
    updated_at DATETIME(6) NOT NULL,

    CONSTRAINT pk_incidents PRIMARY KEY (id)
);

CREATE INDEX idx_incidents_created_at
    ON incidents (created_at);

CREATE INDEX idx_incidents_service_status
    ON incidents (service_name, status);