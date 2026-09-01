package io.aegisops.incident.api;

import io.aegisops.incident.application.IncidentApplicationService;
import io.aegisops.incident.domain.Incident;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.net.URI;
import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/incidents")
public class IncidentController {

    private final IncidentApplicationService incidentService;

    public IncidentController(IncidentApplicationService incidentService) {
        this.incidentService = incidentService;
    }

    @PostMapping
    public ResponseEntity<Incident> create(
            @Valid @RequestBody CreateIncidentRequest request
    ) {
        Incident incident = incidentService.create(request);

        return ResponseEntity
                .created(URI.create("/api/v1/incidents/" + incident.id()))
                .body(incident);
    }

    @GetMapping
    public List<Incident> findAll() {
        return incidentService.findAll();
    }

    @GetMapping("/{incidentId}")
    public Incident findById(@PathVariable UUID incidentId) {
        return incidentService.findById(incidentId);
    }
}