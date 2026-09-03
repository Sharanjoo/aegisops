<#
    Idempotent local deployment of the AegisOps stack into an existing
    kind cluster. Builds and loads all four application images, creates
    or updates the local Secret from environment variables or an
    ignored .env file, then applies the staged Kustomize overlays in
    dependency order: namespace -> infrastructure (MySQL/Kafka) ->
    Kafka topic init -> application workloads.

    Never deletes the cluster, a namespace, or a PersistentVolumeClaim.
    Safe to re-run: every step is either declarative (kubectl apply) or
    checks current state first.

    Because application images always use the same static ":dev" tag,
    re-applying an unchanged Deployment manifest alone would not pick up a
    freshly rebuilt image - so after applying the application workloads,
    this script explicitly runs "kubectl rollout restart" against the four
    application Deployments (never MySQL/Kafka) and waits for every
    rollout to finish, failing the script on any rollout failure.

    The Kafka topic-init Job is fixed-name and its pod template is
    immutable: a Job left over from a previous failed run is deleted (only
    that Job - never Kafka itself) before re-applying, and the topic's
    actual partition count is independently verified afterward rather than
    just trusting the Job's own exit status.

    Usage:
      pwsh infrastructure/scripts/deploy-kind.ps1
      pwsh infrastructure/scripts/deploy-kind.ps1 -SkipBuild
#>
[CmdletBinding()]
param(
    [string]$ClusterName = "aegisops-dev",
    [string]$Namespace = "aegisops-system",
    # Skip the docker build step and only (re)load + (re)deploy already-built :dev images.
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

function Invoke-Checked {
    param(
        [Parameter(Mandatory)][string]$Description,
        [Parameter(Mandatory)][scriptblock]$Command
    )
    Write-Host $Description
    & $Command
    if ($LASTEXITCODE -ne 0) {
        throw "Failed: $Description (exit code $LASTEXITCODE)"
    }
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$overlayRoot = Join-Path $repoRoot "infrastructure\kubernetes\overlays\kind-local"

$images = @(
    @{ Name = "incident-service"; Context = "services\incident-service" }
    @{ Name = "realtime-gateway"; Context = "services\realtime-gateway" }
    @{ Name = "dashboard"; Context = "apps\dashboard" }
    @{ Name = "cluster-agent"; Context = "services\cluster-agent" }
)

# --- 1. Validate required tools -------------------------------------------
Write-Host "=== Validating required tools ==="
foreach ($tool in @("kubectl", "kind", "docker")) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
        throw "Required tool '$tool' was not found on PATH."
    }
}
Write-Host "kubectl, kind, and docker are all available."

# --- 2. Validate kind cluster and context -----------------------------------
Write-Host "`n=== Validating kind cluster '$ClusterName' ==="
$existingClusters = (kind get clusters 2>$null) -split "`r?`n" | ForEach-Object { $_.Trim() }
if ($existingClusters -notcontains $ClusterName) {
    throw "kind cluster '$ClusterName' was not found. Existing clusters: $($existingClusters -join ', '). Create it first (see infrastructure/kind/cluster.yaml) - this script does not create clusters."
}
Invoke-Checked "Switching kubectl context to kind-$ClusterName ..." { kubectl config use-context "kind-$ClusterName" | Out-Null }

# --- 3. Build application images -------------------------------------------
if ($SkipBuild) {
    Write-Host "`n=== Skipping image build (-SkipBuild) ==="
} else {
    Write-Host "`n=== Building application images ==="
    foreach ($img in $images) {
        $tag = "aegisops/$($img.Name):dev"
        $context = Join-Path $repoRoot $img.Context
        Invoke-Checked "Building $tag from $context ..." { docker build --tag $tag $context }
    }
}

# --- 4. Load images into kind ------------------------------------------------
Write-Host "`n=== Loading images into kind cluster '$ClusterName' ==="
foreach ($img in $images) {
    $tag = "aegisops/$($img.Name):dev"
    Invoke-Checked "Loading $tag ..." { kind load docker-image $tag --name $ClusterName }
}

# --- 5. Namespace, then create/update the local Secret ----------------------
Write-Host "`n=== Applying namespace ==="
Invoke-Checked "kubectl apply -k 00-namespace ..." { kubectl apply -k (Join-Path $overlayRoot "00-namespace") }

Write-Host "`n=== Resolving Secret values ==="
$secretKeys = @("MYSQL_DATABASE", "MYSQL_USER", "MYSQL_PASSWORD", "MYSQL_ROOT_PASSWORD")
$envFile = Join-Path $overlayRoot ".env"
$fileValues = @{}
if (Test-Path $envFile) {
    Write-Host "Reading defaults from $envFile (git-ignored, values not logged)."
    foreach ($line in Get-Content $envFile) {
        $trimmed = $line.Trim()
        if ($trimmed -eq "" -or $trimmed.StartsWith("#")) { continue }
        $parts = $trimmed -split "=", 2
        if ($parts.Count -eq 2) { $fileValues[$parts[0].Trim()] = $parts[1].Trim() }
    }
} else {
    Write-Host "No .env file at $envFile - relying on already-set environment variables only."
}

$resolved = @{}
$missing = @()
foreach ($key in $secretKeys) {
    $value = [System.Environment]::GetEnvironmentVariable($key)
    if ([string]::IsNullOrEmpty($value)) { $value = $fileValues[$key] }
    if ([string]::IsNullOrEmpty($value)) {
        $missing += $key
    } else {
        $resolved[$key] = $value
    }
}

if ($missing.Count -gt 0) {
    throw "Missing required secret value(s): $($missing -join ', '). Set them as environment variables, or copy infrastructure\kubernetes\overlays\kind-local\.env.example to .env in that same directory and fill them in."
}

Write-Host "`n=== Creating/updating Secret 'aegisops-secrets' in namespace '$Namespace' (values not logged) ==="
$literalArgs = $secretKeys | ForEach-Object { "--from-literal=$_=$($resolved[$_])" }
$secretYaml = kubectl create secret generic aegisops-secrets -n $Namespace @literalArgs --dry-run=client -o yaml
if ($LASTEXITCODE -ne 0) { throw "Failed to render the Secret manifest." }
$secretYaml | kubectl apply -f -
if ($LASTEXITCODE -ne 0) { throw "Failed to apply the Secret." }
Write-Host "Secret applied."

# --- 6/7. Infrastructure: MySQL + Kafka, then wait for readiness ------------
Write-Host "`n=== Applying MySQL and Kafka ==="
Invoke-Checked "kubectl apply -k 10-infrastructure ..." { kubectl apply -k (Join-Path $overlayRoot "10-infrastructure") }

Write-Host "`n=== Waiting for MySQL and Kafka readiness ==="
Invoke-Checked "Waiting for statefulset/mysql ..." { kubectl rollout status statefulset/mysql -n $Namespace --timeout=300s }
Invoke-Checked "Waiting for statefulset/kafka ..." { kubectl rollout status statefulset/kafka -n $Namespace --timeout=300s }

# --- 8. Kafka topic provisioning ---------------------------------------------
Write-Host "`n=== Provisioning Kafka topic (aegisops.incident.events.v1) ==="

# The Job's pod template is immutable once created, so a plain re-apply of
# an unchanged manifest is a safe no-op (kubectl sees no diff) - but a Job
# that previously exhausted its backoffLimit sits permanently Failed and
# will never be retried by re-applying the same spec. Detect that case and
# delete only this one Job (never Kafka, its StatefulSet, or its PVC) so
# the apply below actually recreates and reruns it. A still-Complete or
# still-Running Job is left alone: the apply is a no-op and the wait below
# either returns immediately (already Complete) or attaches to the run
# already in progress.
$existingJobJson = kubectl get job kafka-topic-init -n $Namespace -o json 2>$null
if ($LASTEXITCODE -eq 0 -and $existingJobJson) {
    $existingJob = $existingJobJson | ConvertFrom-Json
    $failedCondition = @($existingJob.status.conditions) | Where-Object { $_.type -eq "Failed" -and $_.status -eq "True" }
    if (@($failedCondition).Count -gt 0) {
        Write-Host "Existing kafka-topic-init Job previously failed - deleting only this Job so it can be recreated ..."
        Invoke-Checked "Deleting failed job/kafka-topic-init ..." { kubectl delete job kafka-topic-init -n $Namespace --ignore-not-found }
    } else {
        Write-Host "Existing kafka-topic-init Job found (not in a Failed state) - re-apply will be a no-op."
    }
} else {
    Write-Host "No existing kafka-topic-init Job found - this will be a fresh provisioning run."
}

Invoke-Checked "kubectl apply -k 20-kafka-topic-init ..." { kubectl apply -k (Join-Path $overlayRoot "20-kafka-topic-init") }
kubectl wait --for=condition=complete job/kafka-topic-init -n $Namespace --timeout=180s
if ($LASTEXITCODE -ne 0) {
    Write-Warning "kafka-topic-init did not report Complete in time - recent logs:"
    kubectl logs job/kafka-topic-init -n $Namespace --tail=50
    throw "Kafka topic provisioning did not complete."
}

# The Job's own internal --describe only ever reaches its pod logs - verify
# independently, from here, that the topic actually exists with the
# partition count the incident service itself declares (see
# KafkaTopicConfiguration.java), rather than silently trusting Job success.
Write-Host "Verifying topic aegisops.incident.events.v1 has 3 partitions ..."
$topicDescribe = kubectl exec kafka-0 -n $Namespace -- /opt/kafka/bin/kafka-topics.sh --bootstrap-server localhost:9092 --describe --topic aegisops.incident.events.v1 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host $topicDescribe
    throw "Failed to describe Kafka topic aegisops.incident.events.v1 for verification."
}
if (($topicDescribe | Out-String) -notmatch "PartitionCount:\s*3\b") {
    Write-Host $topicDescribe
    throw "Kafka topic aegisops.incident.events.v1 does not report the expected partition count of 3."
}
Write-Host "Topic verified: aegisops.incident.events.v1 has 3 partitions."

# --- 9/10. Application workloads, then wait for rollouts --------------------
Write-Host "`n=== Applying application workloads ==="
Invoke-Checked "kubectl apply -k 30-application ..." { kubectl apply -k (Join-Path $overlayRoot "30-application") }

# All four application images are always built and reloaded into kind with
# the same static ":dev" tag (see steps 3/4 above), so a manifest re-apply
# alone is a no-op as far as Kubernetes can tell - it never sees the tag
# change and therefore never replaces already-running pods with the freshly
# loaded image. "kubectl rollout restart" forces exactly that: a normal
# rolling update (respecting each Deployment's own maxUnavailable/maxSurge)
# against the four application Deployments only - never MySQL or Kafka,
# which are intentionally left untouched here so their StatefulSets, pods,
# and PVCs are never disrupted by an application redeploy.
Write-Host "`n=== Restarting application Deployments to pick up freshly loaded images ==="
foreach ($deployment in @("incident-service", "realtime-gateway", "dashboard", "cluster-agent")) {
    Invoke-Checked "Restarting deployment/$deployment ..." { kubectl rollout restart "deployment/$deployment" -n $Namespace }
}

Write-Host "`n=== Waiting for application rollouts ==="
foreach ($deployment in @("incident-service", "realtime-gateway", "dashboard", "cluster-agent")) {
    Invoke-Checked "Waiting for deployment/$deployment ..." { kubectl rollout status "deployment/$deployment" -n $Namespace --timeout=300s }
}

# --- 11. Status summary -------------------------------------------------------
Write-Host "`n=== AegisOps status in namespace '$Namespace' ==="
kubectl get pods,services,statefulsets,jobs,pvc -n $Namespace -o wide

# --- 12. Port-forward and verification instructions --------------------------
Write-Host "`n=== Next steps ==="
Write-Host "Forward the dashboard to your machine:"
Write-Host "  kubectl port-forward -n $Namespace svc/dashboard 8080:8080"
Write-Host ""
Write-Host "Then, in another shell:"
Write-Host "  curl http://localhost:8080/health"
Write-Host "  curl http://localhost:8080/api/v1/incidents"
Write-Host ""
Write-Host "Tail any workload's logs, e.g.:"
Write-Host "  kubectl logs -n $Namespace deployment/cluster-agent --since=5m"
Write-Host ""
Write-Host "Deployment complete."
