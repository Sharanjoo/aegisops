# AegisOps Cluster Agent

The AegisOps cluster agent observes Kubernetes workloads and reports detected
failures to the AegisOps incident service.

The agent currently detects containers in `CrashLoopBackOff`, suppresses
duplicate findings during a configurable cooldown, and creates persistent
AegisOps incidents through the incident-service REST API.

## Current Capabilities

- Connects through local kubeconfig during development.
- Uses Kubernetes ServiceAccount authentication when deployed in-cluster.
- Watches Pods across all namespaces using a shared informer.
- Detects `CrashLoopBackOff` in application and init containers.
- Resolves service names from standard Kubernetes application labels.
- Suppresses duplicate findings using a configurable cooldown.
- Retries incident creation after failed HTTP requests.
- Produces structured JSON logs.
- Runs as a non-root distroless container.
- Uses read-only Kubernetes RBAC permissions.

## Detection Flow

```text
Kubernetes API
    -> Pod informer
        -> CrashLoopBackOff detector
            -> Cooldown and deduplication
                -> Incident-service REST API
                    -> MySQL
                    -> Transactional outbox
                    -> Kafka
```

## Technology

- Go 1.27
- Kubernetes client-go 0.37
- Kubernetes shared informers
- Kubernetes ServiceAccounts and RBAC
- Docker multi-stage builds
- Distroless non-root runtime image
- kind for local Kubernetes development
- GitHub Actions

## Project Structure

```text
cluster-agent/
├── cmd/
│   └── agent/
│       └── main.go
├── internal/
│   ├── config/
│   ├── detection/
│   ├── incident/
│   └── kubernetes/
├── deploy/
│   └── kubernetes/
│       ├── namespace.yaml
│       ├── rbac.yaml
│       └── deployment.yaml
├── Dockerfile
├── go.mod
└── go.sum
```

## Configuration

| Environment variable | Default | Purpose |
|---|---|---|
| `AEGISOPS_CLUSTER_NAME` | `kind-aegisops-dev` | Identifies the source Kubernetes cluster |
| `AEGISOPS_INCIDENT_SERVICE_URL` | `http://localhost:8080` | Incident-service base URL |
| `AEGISOPS_INCIDENT_SERVICE_TIMEOUT` | `5s` | HTTP request timeout |
| `AEGISOPS_FINDING_COOLDOWN` | `15m` | Duplicate-finding suppression period |

When deployed locally inside kind, the Deployment uses
`http://host.docker.internal:8080` to reach the incident service running on
the Docker Desktop host.

A production deployment should use the incident service's Kubernetes Service
DNS name.

## Local Development

Verify that the current Kubernetes context points to the development cluster:

```powershell
kubectl config current-context
kubectl get nodes
```

Run the agent locally:

```powershell
go run ./cmd/agent
```

Local execution reads the active kubeconfig, normally from
`$HOME\.kube\config`.

## Tests

Run all unit tests:

```powershell
go test ./...
```

Run static analysis:

```powershell
go vet ./...
```

The test suite covers:

- CrashLoopBackOff detection
- Healthy-container filtering
- Init-container detection
- Kubernetes service-name resolution
- Finding deduplication and cooldown behavior
- Retry behavior after forgotten findings
- Configuration defaults and validation
- Incident request mapping
- Incident-service HTTP success and failure handling

## Container Image

Build the local image:

```powershell
docker build --tag aegisops/cluster-agent:dev .
```

The runtime image:

- contains only the compiled agent and required certificates
- runs with UID and GID `65532`
- has no shell or package manager
- uses a read-only root filesystem in Kubernetes
- drops all Linux capabilities

Load the image into kind:

```powershell
kind load docker-image `
    aegisops/cluster-agent:dev `
    --name aegisops-dev
```

## Kubernetes Deployment

Apply the namespace and Pod Security configuration:

```powershell
kubectl apply -f .\deploy\kubernetes\namespace.yaml
```

Apply the ServiceAccount and read-only RBAC:

```powershell
kubectl apply -f .\deploy\kubernetes\rbac.yaml
```

Deploy the agent:

```powershell
kubectl apply -f .\deploy\kubernetes\deployment.yaml
```

Verify the rollout:

```powershell
kubectl rollout status `
    deployment/cluster-agent `
    -n aegisops-system

kubectl logs `
    -n aegisops-system `
    deployment/cluster-agent
```

An in-cluster deployment reports:

```json
{"msg":"connected to Kubernetes","configSource":"in-cluster"}
```

## RBAC Permissions

The agent can only perform these operations on Pods:

- `get`
- `list`
- `watch`

The agent cannot delete Pods, modify Deployments, or perform remediation.

Verify the permissions:

```powershell
kubectl auth can-i list pods `
    --all-namespaces `
    --as=system:serviceaccount:aegisops-system:cluster-agent

kubectl auth can-i delete pods `
    --all-namespaces `
    --as=system:serviceaccount:aegisops-system:cluster-agent
```

Expected results:

```text
yes
no
```

## Manual CrashLoopBackOff Test

Create an intentionally failing Pod:

```powershell
kubectl run crashloop-demo `
    --image=busybox:1.36.1 `
    --restart=Always `
    --labels="app.kubernetes.io/name=cluster-agent-demo" `
    --command -- sh -c "exit 1"
```

Inspect the agent logs:

```powershell
kubectl logs `
    -n aegisops-system `
    deployment/cluster-agent `
    --since=5m
```

Clean up:

```powershell
kubectl delete pod crashloop-demo --ignore-not-found
```

## Security Model

The current agent is observation-only:

- It has no mutation permissions.
- It cannot restart, delete, patch, or scale workloads.
- It runs as a non-root user.
- Privilege escalation is disabled.
- The root filesystem is read-only.
- All Linux capabilities are dropped.
- The namespace enforces the Kubernetes restricted Pod Security Standard.

Automated remediation will be implemented separately with explicit policies,
bounded actions, audit records, cooldowns, and configurable approval modes.
