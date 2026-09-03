# AegisOps Five-Minute Demo

A live walkthrough of the full detection-to-dashboard flow, running
entirely in the local kind cluster. Each step names what you should
actually see - not a sample transcript - so you can tell a real result
from a stuck one.

## Before You Start

```powershell
pwsh infrastructure/scripts/deploy-kind.ps1
pwsh infrastructure/scripts/verify-kind.ps1
```

**Checkpoint**: `verify-kind.ps1` prints `All checks passed.` If it
doesn't, resolve that first - see [`runbook.md`](runbook.md#common-failure-diagnosis).

## 1. Show the Healthy Kubernetes Stack

```powershell
kubectl get pods,statefulsets -n aegisops-system
```

**Expect**: every pod `Running` or `Completed` (the one-shot
`kafka-topic-init` Job), zero unexpected restarts, both StatefulSets
`1/1`.

## 2. Open the Dashboard

```powershell
kubectl port-forward -n aegisops-system svc/dashboard 8080:8080
```

Open `http://localhost:8080`.

**Expect**: the header shows a live WebSocket connection indicator, and
the incident table (initially empty or showing prior incidents) loads
without errors.

## 3. Open Prometheus Targets

In a second terminal:

```powershell
kubectl port-forward -n aegisops-system svc/prometheus 9090:9090
```

Open `http://localhost:9090/targets`.

**Expect**: `incident-service`, `realtime-gateway`, and `cluster-agent`
all show state `UP`. Open `http://localhost:9090/graph` and query
`aegisops_cluster_agent_findings_detected_total` - it should already
return a series (at 0), even before this demo's own CrashLoop.

## 4. Create the Intentional CrashLoop

```powershell
kubectl run demo-crashloop `
    --image=busybox:1.36.1 `
    --restart=Always `
    --labels="app.kubernetes.io/name=demo-crashloop" `
    --command -- sh -c "exit 1"
```

**Expect**: `kubectl get pod demo-crashloop` shows `STATUS` cycle through
`ContainerCreating` -> `Error` -> `CrashLoopBackOff` within about 30-60
seconds.

## 5. Show Agent Detection

```powershell
kubectl logs -n aegisops-system deployment/cluster-agent --since=2m
```

**Expect**: a structured JSON log line with `"msg":"CrashLoopBackOff detected"`
naming `demo-crashloop`, followed shortly by
`"msg":"incident created from Kubernetes finding"` carrying an
`incidentId`.

## 6. Show Incident Persistence

```powershell
curl http://localhost:8080/api/v1/incidents
```

**Expect**: a JSON array containing an incident with
`"serviceName":"demo-crashloop"`, `"status":"OPEN"`, and a populated
`title`/`description`/timestamps.

## 7. Show Kafka/WebSocket Delivery

```powershell
kubectl logs -n aegisops-system deployment/realtime-gateway --since=2m
```

**Expect**: a log line with `"msg":"Incident event broadcast to WebSocket clients"`
carrying the same `incidentId` as step 6, and `"eventType":"INCIDENT_CREATED"`.

## 8. Show the Incident in the Dashboard

Return to the browser tab from step 2.

**Expect**: the `demo-crashloop` incident appears in the table without a
manual refresh, with severity `HIGH` and status `OPEN`.

## 9. Show Relevant Metric Counters Changing

In the Prometheus UI (`http://localhost:9090/graph`), re-run:

```promql
aegisops_cluster_agent_findings_detected_total
aegisops_cluster_agent_incident_submissions_total
aegisops_realtime_gateway_kafka_events_consumed_total
aegisops_incident_creations_total
```

**Expect**: each counter's value for the relevant label (e.g.
`container_type="application"`, `outcome="succeeded"`,
`event_type="INCIDENT_CREATED"`, `severity="HIGH"`) is higher than it was
in step 3.

## 10. Remove the Demo Workload

```powershell
kubectl delete pod demo-crashloop --ignore-not-found
```

**Expect**: the pod disappears from `kubectl get pods`. The incident
record itself is intentionally **not** deleted - it stays in the
dashboard as history, exactly as a real detected failure would.

Stop both port-forwards (`Ctrl+C` in each terminal) to finish.

## Troubleshooting Checkpoints

| Symptom | Likely cause | Where to look |
|---|---|---|
| Pod never reaches `CrashLoopBackOff` | Image pull delay, or it exited with status 0 | `kubectl describe pod demo-crashloop` |
| No detection log from cluster-agent | Agent not running, or RBAC issue | `kubectl logs deployment/cluster-agent`, `kubectl auth can-i list pods --as=system:serviceaccount:aegisops-system:cluster-agent` |
| Incident missing from REST API | Incident-service can't reach MySQL | `kubectl logs deployment/incident-service`, check for `HikariPool` errors |
| Dashboard doesn't update live | WebSocket not connected, or realtime-gateway isn't consuming | Browser dev tools Network tab for `/ws/incidents`; `kubectl logs deployment/realtime-gateway` |
| Prometheus target `DOWN` | Wrong port/path in scrape config, or the pod isn't ready | `http://localhost:9090/targets` shows the last scrape error directly |

For anything not covered here, see
[`runbook.md`](runbook.md#common-failure-diagnosis). The exact same flow
this guide walks through by hand is also run automatically and
deterministically by
[`infrastructure/scripts/e2e-kind.ps1`](../infrastructure/scripts/e2e-kind.ps1).
