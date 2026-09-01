package io.aegisops.incident.persistence;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface IncidentJpaRepository
        extends JpaRepository<IncidentEntity, String> {

    List<IncidentEntity> findAllByOrderByCreatedAtDesc();
}