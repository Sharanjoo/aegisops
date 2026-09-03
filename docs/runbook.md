# AegisOps Kubernetes Runbook

Operational reference for running the AegisOps stack in the local kind
cluster. See [`README.md`](../README.md#kubernetes-deployment-kind) for a
shorter quick-start and [`architecture.md`](architecture.md#kubernetes-deployment-kind)
for the topology and design rationale behind what's described here.

## Prerequisites

- Docker Desktop, kind, and kubectl (see the repo root
  [README.md Prerequisites](../README.md#prerequisites))
- [PowerShell Core (`pwsh`)](https://github.com/PowerShell/PowerShell) -
  `deploy-kind.ps1`, `verify-kind.ps1`, and `e2e-kind.ps1` all require it
- A running kind cluster named `aegisops-dev` (`kubectl config current-context`
  should read `kind-aegisops-dev`) - none of these scripts create the
  cluster itself

## Safe Secret Setup

```powershell
Copy-Item .\infrastructure\kubernetes\overlays\kind-local\.env.example `
    .\infrastructure\kubernetes\overlays\kind-local\.env
# then edit .env with real local values
```

`.env` is git-ignored. `deploy-kind.ps1` prefers already-set environment
variables over this file, and fails with a clear error naming only the
missing keys - it never logs a value. See **Secret Setup** in the root
README for the exact keys.

## Build, Load, and Deploy

```powershell
pwsh infrastructure/scripts/deploy-kind.ps1
```

Rebuilds all four `:dev` images, loads them into kind, applies the Secret,
MySQL, Kafka, the Kafka topic, the four application workloads, and the
Prometheus observability stage - in that order, waiting for each to become
ready. Pass `-SkipBuild` to redeploy already-built images without
rebuilding (useful when only a manifest changed).

## Rollout and Health Verification

```powershell
pwsh infrastructure/scripts/verify-kind.ps1
```

Read-only. Confirms every Deployment/StatefulSet is fully ready, every pod
is non-root with capabilities dropped and resource limits set, only
`cluster-agent` mounts a ServiceAccount token, Prometheus is ready with all
three application targets `UP`, and a representative custom metric exists
per service.

## Dashboard and Prometheus Port-Forwarding

```powershell
# Dashboard
kubectl port-forward -n aegisops-system svc/dashboard 8080:8080
# then open http://localhost:8080

# Prometheus
kubectl port-forward -n aegisops-system svc/prometheus 9090:9090
# then open http://localhost:9090/targets or http://localhost:9090/alerts
```

Neither is exposed outside the cluster - port-forward is the only access
path, by design (see `docs/observability.md` for what to look at once
you're in).

## Common Failure Diagnosis

```powershell
# Every workload's status at a glance
kubectl get pods,services,statefulsets,deployments,jobs,pvc -n aegisops-system -o wide

# A specific pod's probes, resource limits, and recent events
kubectl describe pod <pod-name> -n aegisops-system

# Namespace-wide events, most recent last
kubectl get events -n aegisops-system --sort-by=.lastTimestamp

# A workload's logs
kubectl logs -n aegisops-system deployment/<name> --tail=200
kubectl logs -n aegisops-system statefulset/kafka --tail=200

# PVC status and the volume it's bound to
kubectl get pvc -n aegisops-system

# The Kafka topic itself
kubectl exec kafka-0 -n aegisops-system -- \
    /opt/kafka/bin/kafka-topics.sh --bootstrap-server localhost:9092 \
    --describe --topic aegisops.incident.events.v1

# realtime-gateway's consumer group (lag, active member, assigned partitions)
kubectl exec kafka-0 -n aegisops-system -- \
    /opt/kafka/bin/kafka-consumer-groups.sh --bootstrap-server localhost:9092 \
    --describe --group aegisops-realtime-gateway-v1
```

## Rerunning Deployment Safely

`deploy-kind.ps1` is idempotent and safe to run repeatedly - it never
deletes the namespace, MySQL/Kafka StatefulSets, or their PVCs. On every
run it explicitly `kubectl rollout restart`s the four application
Deployments (never MySQL/Kafka) so a rebuilt image under the same `:dev`
tag actually replaces running pods - a plain re-apply alone would not,
since Kubernetes never sees the tag string change.

## Recovering a Failed Topic-Init Job

The `kafka-topic-init` Job's pod template is immutable once created, so a
Job that previously exhausted its `backoffLimit` sits permanently `Failed`
and is never retried by re-applying the same manifest.
`deploy-kind.ps1` already detects and handles this automatically - it
deletes only that one Job (never Kafka, its StatefulSet, or its PVC) and
lets the next apply recreate it. To do this by hand:

```powershell
kubectl get job kafka-topic-init -n aegisops-system
# if STATUS is Failed:
kubectl delete job kafka-topic-init -n aegisops-system
kubectl apply -k infrastructure/kubernetes/overlays/kind-local/20-kafka-topic-init
kubectl wait --for=condition=complete job/kafka-topic-init -n aegisops-system --timeout=180s
```

## Restarting Application Pods vs. Deleting Persistent Infrastructure

These are very different operations - know which one you mean:

```powershell
# Safe: cycles pods, no data loss, MySQL/Kafka untouched.
kubectl rollout restart deployment/incident-service -n aegisops-system

# Safe: re-applies application manifests only.
kubectl apply -k infrastructure/kubernetes/overlays/kind-local/30-application

# DESTRUCTIVE: deletes all persisted incident and Kafka event data.
# Do not run unless you intend to lose it.
kubectl delete -k infrastructure/kubernetes/overlays/kind-local/10-infrastructure
kubectl delete pvc -l app.kubernetes.io/part-of=aegisops -n aegisops-system
```

## Safe Cleanup vs. Destructive Cleanup

Three distinct levels, from always-safe to irreversible:

```powershell
# 1. Remove a manual CrashLoopBackOff test pod (always safe):
kubectl delete pod <test-pod-name> --ignore-not-found

# 2. Remove only the application Deployments - MySQL/Kafka data and the
#    namespace are untouched; re-running deploy-kind.ps1 restores them:
kubectl delete -k infrastructure/kubernetes/overlays/kind-local/30-application

# 3. DESTRUCTIVE - deletes all persisted data. Confirm you mean this
#    before running either line:
kubectl delete -k infrastructure/kubernetes/overlays/kind-local/10-infrastructure
kubectl delete pvc -l app.kubernetes.io/part-of=aegisops -n aegisops-system

# Deleting the whole namespace is more destructive still - it also
# removes cluster-agent's RBAC - and is never done by any script here:
kubectl delete namespace aegisops-system
```

None of the commands under level 3 are ever executed by `deploy-kind.ps1`,
`verify-kind.ps1`, or `e2e-kind.ps1` - they are documented here for a
human operator's deliberate use only.
