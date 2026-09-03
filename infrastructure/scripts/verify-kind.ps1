<#
    Read-only verification of an already-deployed AegisOps stack in
    kind. Prints workload/service/storage status and flags anything
    that fails the deployment's own security and resource-limit
    contract. Makes no changes to the cluster - safe to run at any
    time, including against a partially-rolled-out deployment.

    Usage:
      pwsh infrastructure/scripts/verify-kind.ps1
#>
[CmdletBinding()]
param(
    [string]$Namespace = "aegisops-system"
)

$ErrorActionPreference = "Stop"
$problems = New-Object System.Collections.Generic.List[string]

Write-Host "=== Workloads, Services, and Storage in namespace '$Namespace' ==="
kubectl get pods,services,statefulsets,jobs,pvc -n $Namespace -o wide

Write-Host "`n=== Deployment / StatefulSet readiness ==="
$deployments = (kubectl get deployments -n $Namespace -o json | ConvertFrom-Json).items
foreach ($d in $deployments) {
    $desired = $d.spec.replicas
    $ready = $d.status.readyReplicas
    $ok = ($ready -eq $desired) -and ($desired -gt 0)
    Write-Host "  deployment/$($d.metadata.name): ready=$ready/$desired"
    if (-not $ok) { $problems.Add("deployment/$($d.metadata.name) is not fully ready ($ready/$desired)") }
}

$statefulsets = (kubectl get statefulsets -n $Namespace -o json | ConvertFrom-Json).items
foreach ($s in $statefulsets) {
    $desired = $s.spec.replicas
    $ready = $s.status.readyReplicas
    $ok = ($ready -eq $desired) -and ($desired -gt 0)
    Write-Host "  statefulset/$($s.metadata.name): ready=$ready/$desired"
    if (-not $ok) { $problems.Add("statefulset/$($s.metadata.name) is not fully ready ($ready/$desired)") }
}

Write-Host "`n=== Pod Security Standard: non-root, no privilege escalation ==="
$pods = (kubectl get pods -n $Namespace -o json | ConvertFrom-Json).items
foreach ($pod in $pods) {
    $podSpec = $pod.spec
    $name = $pod.metadata.name
    $isClusterAgent = $name -like "cluster-agent-*"

    foreach ($container in $podSpec.containers) {
        $sc = $container.securityContext
        if ($null -eq $sc -or $sc.allowPrivilegeEscalation -ne $false) {
            $problems.Add("pod/$name container $($container.name) does not set allowPrivilegeEscalation: false")
        }
        if ($null -eq $sc -or -not $sc.capabilities -or ($sc.capabilities.drop -notcontains "ALL")) {
            $problems.Add("pod/$name container $($container.name) does not drop all capabilities")
        }
    }

    $runAsNonRoot = $podSpec.securityContext.runAsNonRoot
    if ($runAsNonRoot -ne $true) {
        $problems.Add("pod/$name does not set runAsNonRoot: true at the pod level")
    }

    # Only cluster-agent calls the Kubernetes API and needs its ServiceAccount token.
    $automount = $podSpec.automountServiceAccountToken
    if ($isClusterAgent) {
        if ($automount -eq $false) {
            $problems.Add("pod/$name (cluster-agent) unexpectedly disables ServiceAccount token automount")
        }
    } else {
        if ($automount -ne $false) {
            $problems.Add("pod/$name is not cluster-agent but does not disable ServiceAccount token automount")
        }
    }

    Write-Host "  pod/${name}: runAsNonRoot=$runAsNonRoot automountServiceAccountToken=$automount"
}

Write-Host "`n=== Probes and resource requests/limits ==="
foreach ($pod in $pods) {
    $name = $pod.metadata.name
    # One-shot Job pods run to completion and are never probed. cluster-agent
    # predates this milestone, has no HTTP surface, and was explicitly kept
    # as-is (see base/cluster-agent) - so it's exempt from the probe check,
    # unlike the four HTTP-serving application workloads this milestone owns.
    $isJobPod = @($pod.metadata.ownerReferences | Where-Object { $_.kind -eq "Job" }).Count -gt 0
    $isClusterAgent = $name -like "cluster-agent-*"
    $probesExpected = -not ($isJobPod -or $isClusterAgent)

    foreach ($container in $pod.spec.containers) {
        $hasProbes = $container.readinessProbe -and $container.livenessProbe
        $hasResources = $container.resources.requests -and $container.resources.limits
        Write-Host "  pod/$name container $($container.name): probes=$([bool]$hasProbes) resources=$([bool]$hasResources)"
        if ($probesExpected -and -not $hasProbes) { $problems.Add("pod/$name container $($container.name) is missing a readiness or liveness probe") }
        if (-not $hasResources) { $problems.Add("pod/$name container $($container.name) is missing resource requests or limits") }
    }
}

Write-Host "`n=== Prometheus targets and representative custom metrics ==="
$prometheusReady = kubectl get deployment prometheus -n $Namespace -o jsonpath='{.status.readyReplicas}' 2>$null
if ($LASTEXITCODE -ne 0 -or $prometheusReady -ne "1") {
    $problems.Add("deployment/prometheus is not ready - skipping target/metric verification")
} else {
    # -NoNewWindow (not -WindowStyle, which Start-Process only supports on
    # Windows) and .NET's own temp path (not $env:TEMP, unset on Linux) -
    # this script runs both locally on Windows and in Ubuntu CI.
    $tempDir = [System.IO.Path]::GetTempPath()
    $pfProcess = Start-Process -FilePath "kubectl" `
        -ArgumentList "port-forward", "-n", $Namespace, "svc/prometheus", "19090:9090" `
        -NoNewWindow -PassThru `
        -RedirectStandardOutput (Join-Path $tempDir "verify-kind-prometheus-pf.log") `
        -RedirectStandardError (Join-Path $tempDir "verify-kind-prometheus-pf.err")

    Start-Sleep -Seconds 3

    try {
        # Prometheus's own scrape_interval is 15s (see base/prometheus's
        # ConfigMap) and it staggers each target's first scrape rather than
        # firing all of them in lockstep - immediately after the Deployment
        # itself becomes ready (which only means its own /-/ready probe
        # passed, not that it has scraped anything yet), a target can still
        # legitimately read health "unknown" for a few seconds. Poll rather
        # than check once.
        $pollDeadline = (Get-Date).AddSeconds(45)
        $remainingJobs = @("incident-service", "realtime-gateway", "cluster-agent")
        $remainingMetrics = @(
            "aegisops_incident_creations_total",
            "aegisops_realtime_gateway_kafka_events_consumed_total",
            "aegisops_cluster_agent_findings_detected_total"
        )

        while (((Get-Date) -lt $pollDeadline) -and ($remainingJobs.Count -gt 0 -or $remainingMetrics.Count -gt 0)) {
            if ($remainingJobs.Count -gt 0) {
                $targets = Invoke-RestMethod -Uri "http://localhost:19090/api/v1/targets" -TimeoutSec 10
                $activeTargets = $targets.data.activeTargets

                foreach ($job in @($remainingJobs)) {
                    $target = $activeTargets | Where-Object { $_.labels.job -eq $job }
                    if ($target -and $target.health -eq "up") {
                        Write-Host "  target ${job}: UP"
                        $remainingJobs = $remainingJobs | Where-Object { $_ -ne $job }
                    }
                }
            }

            if ($remainingMetrics.Count -gt 0) {
                foreach ($metricName in @($remainingMetrics)) {
                    $query = Invoke-RestMethod -Uri "http://localhost:19090/api/v1/query?query=$metricName" -TimeoutSec 10
                    if ($query.data.result.Count -gt 0) {
                        Write-Host "  metric ${metricName}: present"
                        $remainingMetrics = $remainingMetrics | Where-Object { $_ -ne $metricName }
                    }
                }
            }

            if ($remainingJobs.Count -gt 0 -or $remainingMetrics.Count -gt 0) {
                Start-Sleep -Seconds 5
            }
        }

        foreach ($job in $remainingJobs) {
            $problems.Add("Prometheus target '$job' did not become UP within 45s")
        }
        foreach ($metricName in $remainingMetrics) {
            $problems.Add("Prometheus has no series for expected metric '$metricName' within 45s")
        }
    } catch {
        $problems.Add("Failed to query Prometheus: $($_.Exception.Message)")
    } finally {
        Stop-Process -Id $pfProcess.Id -Force -ErrorAction SilentlyContinue
    }
}

Write-Host "`n=== Summary ==="
if ($problems.Count -eq 0) {
    Write-Host "All checks passed."
} else {
    Write-Warning "$($problems.Count) issue(s) found:"
    foreach ($p in $problems) { Write-Warning "  - $p" }
    exit 1
}
