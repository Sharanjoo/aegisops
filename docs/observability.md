# AegisOps Observability Guide

Local-development observability only: a single-instance Prometheus with
6-hour retention on an `emptyDir` (see
[`architecture.md`](architecture.md#kubernetes-deployment-kind)), no
Alertmanager, no external alert delivery, no Grafana. Metric names,
alert rules, and known limitations are documented below.

## Custom Metrics

### Incident service (`/actuator/prometheus`, exposed alongside its existing REST API on port 8080)

| Metric | Type | Labels | Meaning |
|---|---|---|---|
| `aegisops_incident_creations_total` | Counter | `severity` (`LOW`/`MEDIUM`/`HIGH`/`CRITICAL`) | Incidents successfully created and persisted. Incremented only after the incident is saved and its outbox event appended - never on a failed transaction. |
| `aegisops_incident_status_changes_total` | Counter | `from`, `to` (`OPEN`/`ACKNOWLEDGED`/`RESOLVED`) | Successful status transitions. Not incremented for a no-op (same-status) update or a rejected invalid transition. |
| `aegisops_outbox_publications_total` | Counter | `outcome` (`succeeded`/`failed`) | Outbox-to-Kafka publication attempts, by outcome. |

Plus the standard Spring Boot Actuator / Micrometer JVM, HTTP, and
DataSource metrics (`jvm_memory_used_bytes`, `http_server_requests_seconds_count`,
`hikaricp_connections_active`, and similar) - useful for general health,
not AegisOps-specific.

### Realtime gateway (`/metrics`, port 8081, alongside `/health`)

| Metric | Type | Labels | Meaning |
|---|---|---|---|
| `aegisops_realtime_gateway_kafka_events_consumed_total` | Counter | `event_type` (`INCIDENT_CREATED`/`INCIDENT_STATUS_CHANGED`) | Valid Kafka incident events consumed and broadcast. |
| `aegisops_realtime_gateway_kafka_messages_rejected_total` | Counter | `reason` (`empty_value`/`invalid_payload`) | Kafka messages rejected before broadcast - an empty message value, or one that failed JSON parsing / schema validation. |
| `aegisops_realtime_gateway_kafka_processing_failures_total` | Counter | none | Unexpected errors while processing a Kafka message, outside normal validation rejection - a distinct, less common failure boundary from the rejection counter above. |
| `aegisops_realtime_gateway_websocket_broadcast_attempts_total` | Counter | none | Attempts to broadcast a valid event to connected WebSocket clients (once per consumed event, regardless of client count). |
| `aegisops_realtime_gateway_websocket_deliveries_total` | Counter | none | Individual client deliveries that succeeded (summed across all connected clients per broadcast). |
| `aegisops_realtime_gateway_websocket_clients` | Gauge | none | Currently connected WebSocket clients. |

### Cluster agent (`/metrics`, port 9090 - separate from its own process, which has no other HTTP surface)

| Metric | Type | Labels | Meaning |
|---|---|---|---|
| `aegisops_cluster_agent_findings_detected_total` | Counter | `container_type` (`application`/`init`) | Raw CrashLoopBackOff signals detected, before deduplication. |
| `aegisops_cluster_agent_findings_suppressed_total` | Counter | none | Findings suppressed as duplicates during the cooldown window (`AEGISOPS_FINDING_COOLDOWN`, default 15m). |
| `aegisops_cluster_agent_incident_submissions_total` | Counter | `outcome` (`succeeded`/`failed`) | Incident-service submission attempts, by outcome. A failed submission also un-suppresses the finding (see `services/cluster-agent/README.md`), so it can be retried on the next observed restart. |
| `aegisops_cluster_agent_watch_failures_total` | Counter | none | Times the Kubernetes Pod watcher stopped due to an unrecoverable error (informer cache sync failure, or the watch loop itself returning an error). |

Every label set above is small and bounded by design - never a pod name,
incident ID, namespace, or error message, which would make each unique
value its own permanently-retained time series (a Prometheus
anti-pattern). Every counter is pre-registered at 0 for all of its known
label combinations at startup, so it is visible on the very first scrape
rather than only after the corresponding event first occurs.

## Useful PromQL Examples

```promql
# Incidents created per minute, by severity
rate(aegisops_incident_creations_total[5m])

# Outbox publication failure rate
rate(aegisops_outbox_publications_total{outcome="failed"}[5m])

# Cluster-agent incident submission success ratio over the last 15 minutes
sum(rate(aegisops_cluster_agent_incident_submissions_total{outcome="succeeded"}[15m]))
  /
sum(rate(aegisops_cluster_agent_incident_submissions_total[15m]))

# Currently connected dashboard WebSocket clients
aegisops_realtime_gateway_websocket_clients

# Realtime-gateway Kafka message rejection rate, by reason
rate(aegisops_realtime_gateway_kafka_messages_rejected_total[5m])

# Any AegisOps scrape target currently down
up{job=~"incident-service|realtime-gateway|cluster-agent"} == 0
```

## Alert Rules

Defined in
[`infrastructure/kubernetes/base/prometheus/configmap.yaml`](../infrastructure/kubernetes/base/prometheus/configmap.yaml)
and evaluated by Prometheus itself - visible under Prometheus's own
**Alerts** page. There is no Alertmanager in this milestone: nothing is
paged, emailed, or otherwise delivered externally.

| Alert | Condition | Meaning |
|---|---|---|
| `AegisOpsScrapeTargetDown` | `up{job=~"incident-service\|realtime-gateway\|cluster-agent"} == 0` for 1m | Prometheus has been unable to scrape a target for at least a minute. |
| `IncidentOutboxPublicationFailing` | `increase(aegisops_outbox_publications_total{outcome="failed"}[5m]) > 0` | At least one outbox-to-Kafka publication has failed in the last 5 minutes. |
| `ClusterAgentIncidentSubmissionFailing` | `increase(aegisops_cluster_agent_incident_submissions_total{outcome="failed"}[5m]) > 2` | cluster-agent has failed to submit an incident more than twice in 5 minutes - the incident service may be unreachable or unhealthy. |
| `RealtimeGatewayEventProcessingFailing` | `increase(aegisops_realtime_gateway_kafka_processing_failures_total[5m]) > 0` | realtime-gateway hit at least one unexpected Kafka processing failure in the last 5 minutes. |

## Inspecting Prometheus Targets

```powershell
kubectl port-forward -n aegisops-system svc/prometheus 9090:9090
```

Then open `http://localhost:9090/targets` - all three application jobs
(`incident-service`, `realtime-gateway`, `cluster-agent`) should show
state `UP`. `http://localhost:9090/alerts` shows the rules above and
whether any are currently firing. `verify-kind.ps1` performs the same
target and representative-metric check automatically.

## Known Local Limitations

- **Not persistent**: Prometheus's data lives on an `emptyDir` - a pod
  restart or reschedule loses all scraped history. A real deployment
  would use a PVC.
- **6-hour retention**: intentionally short, matched to the emptyDir's
  ephemeral nature.
- **Single instance, no HA**: one Prometheus pod, no replication.
- **No Alertmanager**: firing alerts are visible only in Prometheus's own
  UI/API - nothing is delivered externally.
- **Static scrape targets only**: no Kubernetes service-discovery, so
  Prometheus needs no Kubernetes API access or ServiceAccount token - but
  it also means a new instance of a scraped service would need a manual
  config change to be discovered (not relevant today: each of the three
  targets is a single-replica Deployment).
- **No Grafana**: Prometheus's own UI (graph, targets, alerts) is the
  only visualization in this milestone.
