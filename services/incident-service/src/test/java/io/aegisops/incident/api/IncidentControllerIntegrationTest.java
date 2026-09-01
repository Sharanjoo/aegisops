package io.aegisops.incident.api;

import io.aegisops.incident.persistence.IncidentJpaRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.mysql.MySQLContainer;

import java.util.UUID;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
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

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private IncidentJpaRepository incidentRepository;

    @BeforeEach
    void cleanDatabase() {
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
                .andExpect(jsonPath("$.serviceName").value("payments-api"))
                .andExpect(jsonPath("$.severity").value("CRITICAL"))
                .andExpect(jsonPath("$.status").value("OPEN"));

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
}