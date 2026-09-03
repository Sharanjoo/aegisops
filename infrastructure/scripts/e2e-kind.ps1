#!/usr/bin/env pwsh
<#
    Deterministic end-to-end test against an ALREADY-DEPLOYED AegisOps kind
    stack (run deploy-kind.ps1 first - this script does not deploy
    anything). Written for PowerShell Core (pwsh) so the same script runs
    unmodified on Windows locally and on an Ubuntu GitHub Actions runner.

    Flow: verify the stack is healthy -> port-forward the dashboard ->
    open a WebSocket on its exact /ws/incidents route -> create one
    uniquely-named CrashLoopBackOff pod -> wait for cluster-agent to detect
    it -> verify the WebSocket carried an INCIDENT_CREATED notification for
    it -> poll the dashboard's REST proxy until the complete incident
    appears -> verify the two identify the same incident.

    Exits nonzero on any failure. Always removes the test pod and its own
    port-forward (try/finally), even after failure. Never touches the
    namespace, StatefulSets, PVCs, the Kafka topic, or unrelated workloads.
    On failure, writes diagnostics (pod/workload status, namespace events,
    pod descriptions, sanitized logs, Kafka consumer-group state, and the
    failing stage) to -DiagnosticsDir for CI artifact upload.

    Usage:
      pwsh infrastructure/scripts/e2e-kind.ps1
      pwsh infrastructure/scripts/e2e-kind.ps1 -DashboardLocalPort 28080
#>
[CmdletBinding()]
param(
    [string]$ClusterName = "aegisops-dev",
    [string]$Namespace = "aegisops-system",
    [int]$DashboardLocalPort = 18080,
    [int]$OverallTimeoutSeconds = 420,
    [string]$DiagnosticsDir = ""
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
if ([string]::IsNullOrWhiteSpace($DiagnosticsDir)) {
    $DiagnosticsDir = Join-Path $repoRoot ".e2e-diagnostics"
}

$script:stage = "startup"
$script:testPodName = "e2e-crashloop-$([guid]::NewGuid().ToString('N').Substring(0, 8))"
$script:portForwardProcess = $null
$script:wsPowerShell = $null
$script:wsAsyncResult = $null
$script:wsCts = $null
$script:wsMessagesFile = $null
$script:overallDeadline = (Get-Date).AddSeconds($OverallTimeoutSeconds)

function Set-Stage {
    param([Parameter(Mandatory)][string]$Name)
    $script:stage = $Name
    Write-Host "`n=== [$Name] ==="
}

function Assert-NotPastDeadline {
    if ((Get-Date) -gt $script:overallDeadline) {
        throw "Overall timeout of ${OverallTimeoutSeconds}s exceeded during stage '$script:stage'."
    }
}

function Wait-Until {
    param(
        [Parameter(Mandatory)][scriptblock]$Condition,
        [int]$TimeoutSeconds = 120,
        [int]$IntervalSeconds = 3,
        [Parameter(Mandatory)][string]$Description
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)

    while ((Get-Date) -lt $deadline) {
        Assert-NotPastDeadline

        if (& $Condition) {
            return
        }

        Start-Sleep -Seconds $IntervalSeconds
    }

    throw "Timed out after ${TimeoutSeconds}s waiting for: $Description"
}

function Save-Diagnostics {
    Write-Host "`nCollecting diagnostics into $DiagnosticsDir (failing stage: $script:stage) ..."

    New-Item -ItemType Directory -Path $DiagnosticsDir -Force | Out-Null

    "Failing stage: $script:stage`nTimestamp: $(Get-Date -AsUTC -Format o)" |
        Out-File (Join-Path $DiagnosticsDir "summary.txt")

    kubectl get pods,services,statefulsets,deployments,jobs,pvc -n $Namespace -o wide *> `
        (Join-Path $DiagnosticsDir "workloads.txt")

    kubectl get events -n $Namespace --sort-by=.lastTimestamp *> `
        (Join-Path $DiagnosticsDir "events.txt")

    foreach ($workload in @(
        "deployment/cluster-agent", "deployment/incident-service",
        "deployment/realtime-gateway", "deployment/dashboard",
        "statefulset/kafka", "statefulset/mysql"
    )) {
        $safeName = $workload -replace "/", "-"
        kubectl describe $workload -n $Namespace *> `
            (Join-Path $DiagnosticsDir "describe-$safeName.txt")
    }

    if (kubectl get pod $script:testPodName -n default --ignore-not-found -o name 2>$null) {
        kubectl describe pod $script:testPodName -n default *> `
            (Join-Path $DiagnosticsDir "describe-test-pod.txt")
    }

    foreach ($workload in @(
        "deployment/cluster-agent", "deployment/incident-service",
        "deployment/realtime-gateway", "deployment/dashboard",
        "statefulset/kafka", "job/kafka-topic-init"
    )) {
        $safeName = $workload -replace "/", "-"
        $rawLog = kubectl logs $workload -n $Namespace --tail=300 --all-containers 2>&1
        # Defense in depth: this codebase never logs secret values, but
        # strip anything that looks like one before writing to disk anyway.
        $sanitized = $rawLog | ForEach-Object {
            $_ -replace '(?i)(password|secret|token)("?\s*[:=]\s*"?)[^\s",}'']+', '$1$2[REDACTED]'
        }
        $sanitized | Out-File (Join-Path $DiagnosticsDir "logs-$safeName.txt")
    }

    kubectl exec kafka-0 -n $Namespace -- /opt/kafka/bin/kafka-consumer-groups.sh `
        --bootstrap-server localhost:9092 `
        --describe --group aegisops-realtime-gateway-v1 *> `
        (Join-Path $DiagnosticsDir "kafka-consumer-group.txt")

    if ($script:wsMessagesFile -and (Test-Path $script:wsMessagesFile)) {
        Copy-Item $script:wsMessagesFile (Join-Path $DiagnosticsDir "ws-messages.jsonl") -ErrorAction SilentlyContinue
    }

    Write-Host "Diagnostics written."
}

try {
    Set-Stage "verify kind context and namespace"
    $currentContext = kubectl config current-context
    if ($LASTEXITCODE -ne 0) { throw "Failed to read current kubectl context." }
    $expectedContext = "kind-$ClusterName"
    if ($currentContext.Trim() -ne $expectedContext) {
        throw "kubectl context is '$($currentContext.Trim())', expected '$expectedContext'. Switch context or pass -ClusterName."
    }

    kubectl get namespace $Namespace | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Namespace '$Namespace' does not exist." }

    Set-Stage "verify required workloads are ready"
    foreach ($deployment in @("incident-service", "realtime-gateway", "dashboard", "cluster-agent")) {
        Wait-Until -Description "deployment/$deployment ready" -TimeoutSeconds 30 -IntervalSeconds 3 -Condition {
            $ready = kubectl get deployment $deployment -n $Namespace -o jsonpath='{.status.readyReplicas}' 2>$null
            $desired = kubectl get deployment $deployment -n $Namespace -o jsonpath='{.spec.replicas}' 2>$null
            $ready -and $desired -and ($ready -eq $desired)
        }
        Write-Host "  deployment/$deployment ready"
    }
    foreach ($statefulset in @("mysql", "kafka")) {
        Wait-Until -Description "statefulset/$statefulset ready" -TimeoutSeconds 30 -IntervalSeconds 3 -Condition {
            $ready = kubectl get statefulset $statefulset -n $Namespace -o jsonpath='{.status.readyReplicas}' 2>$null
            $desired = kubectl get statefulset $statefulset -n $Namespace -o jsonpath='{.spec.replicas}' 2>$null
            $ready -and $desired -and ($ready -eq $desired)
        }
        Write-Host "  statefulset/$statefulset ready"
    }

    Set-Stage "start dashboard port-forward"
    # A unique log path per run - so that if it fails to bind, the actual
    # kubectl error is read from a file this run definitely wrote, not one
    # left over from an earlier invocation on the same machine.
    $pfStderrPath = Join-Path ([System.IO.Path]::GetTempPath()) "e2e-dashboard-pf-$($script:testPodName).err"
    $script:portForwardProcess = Start-Process -FilePath "kubectl" `
        -ArgumentList "port-forward", "-n", $Namespace, "svc/dashboard", "${DashboardLocalPort}:8080" `
        -PassThru -NoNewWindow `
        -RedirectStandardOutput (Join-Path ([System.IO.Path]::GetTempPath()) "e2e-dashboard-pf-$($script:testPodName).log") `
        -RedirectStandardError $pfStderrPath

    # kubectl exits immediately if it cannot bind the local port (e.g. a
    # leftover process from a previous run hasn't released it yet) - detect
    # that here with a clear error, rather than a confusing timeout later
    # on every subsequent HTTP call.
    Start-Sleep -Seconds 2
    if ($script:portForwardProcess.HasExited) {
        $stderrContent = Get-Content $pfStderrPath -Raw -ErrorAction SilentlyContinue
        throw "kubectl port-forward exited immediately (local port $DashboardLocalPort may already be in use): $stderrContent"
    }

    Set-Stage "wait for dashboard health"
    Wait-Until -Description "dashboard /health returns 200" -TimeoutSeconds 60 -IntervalSeconds 2 -Condition {
        try {
            $response = Invoke-WebRequest -Uri "http://localhost:$DashboardLocalPort/health" -TimeoutSec 5 -UseBasicParsing
            $response.StatusCode -eq 200
        } catch {
            $false
        }
    }

    Set-Stage "open WebSocket before creating the failure"
    New-Item -ItemType Directory -Path $DiagnosticsDir -Force | Out-Null
    $script:wsMessagesFile = Join-Path $DiagnosticsDir "ws-messages.jsonl"
    Remove-Item $script:wsMessagesFile -ErrorAction SilentlyContinue

    # Runs on a background thread in THIS process (not a separate Start-Job
    # process) specifically so $script:wsCts.Cancel() in cleanup can
    # interrupt a pending ReceiveAsync immediately by reference - a
    # CancellationTokenSource created inside a Start-Job scriptblock is
    # local to that job's own process and unreachable from here, which
    # left a blocked ReceiveAsync (and so the whole cleanup) unkillable.
    $script:wsCts = [System.Threading.CancellationTokenSource]::new()
    $script:wsPowerShell = [powershell]::Create()
    [void]$script:wsPowerShell.AddScript({
        param($Url, $OutFile, $Token)

        $webSocket = [System.Net.WebSockets.ClientWebSocket]::new()

        try {
            $webSocket.ConnectAsync([Uri]$Url, $Token).GetAwaiter().GetResult() | Out-Null
        } catch {
            "CONNECT_ERROR: $($_.Exception.Message)" | Out-File $OutFile -Append
            return
        }

        $buffer = New-Object byte[] 16384

        while ($webSocket.State -eq [System.Net.WebSockets.WebSocketState]::Open -and -not $Token.IsCancellationRequested) {
            $segment = [System.ArraySegment[byte]]::new($buffer)

            try {
                $result = $webSocket.ReceiveAsync($segment, $Token).GetAwaiter().GetResult()
            } catch {
                break
            }

            if ($result.MessageType -eq [System.Net.WebSockets.WebSocketMessageType]::Close) {
                break
            }

            $text = [System.Text.Encoding]::UTF8.GetString($buffer, 0, $result.Count)
            Add-Content -Path $OutFile -Value $text
        }

        try { $webSocket.Dispose() } catch {}
    }).AddArgument("ws://localhost:$DashboardLocalPort/ws/incidents").AddArgument($script:wsMessagesFile).AddArgument($script:wsCts.Token)

    $script:wsAsyncResult = $script:wsPowerShell.BeginInvoke()

    # Give the connection a moment to actually establish before the finding
    # exists - the whole point of opening it early.
    Wait-Until -Description "WebSocket connection running" -TimeoutSeconds 15 -IntervalSeconds 1 -Condition {
        $script:wsPowerShell.InvocationStateInfo.State -eq "Running"
    }

    Set-Stage "create intentional CrashLoopBackOff pod"
    $serviceName = $script:testPodName
    kubectl run $script:testPodName `
        --image=busybox:1.36.1 `
        --restart=Always `
        --labels="app.kubernetes.io/name=$serviceName" `
        --command -- sh -c "exit 1" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Failed to create the intentional test pod." }
    Write-Host "Created pod $script:testPodName"

    Set-Stage "wait for genuine CrashLoopBackOff"
    # busybox's restart backoff is exponential (10s, 20s, 40s, 80s, ...,
    # capped at 5m) - under host contention the container's own restart
    # cadence can slow down independently of this poll, so this budget is
    # generous rather than tuned to the fast case.
    Wait-Until -Description "pod/$script:testPodName reaches CrashLoopBackOff" -TimeoutSeconds 240 -IntervalSeconds 5 -Condition {
        $reason = kubectl get pod $script:testPodName -n default -o jsonpath='{.status.containerStatuses[0].state.waiting.reason}' 2>$null
        $reason -eq "CrashLoopBackOff"
    }
    Write-Host "pod/$script:testPodName reached CrashLoopBackOff"

    Set-Stage "verify INCIDENT_CREATED WebSocket notification"
    $script:wsIncidentId = $null
    Wait-Until -Description "WebSocket INCIDENT_CREATED notification for $serviceName" -TimeoutSeconds 90 -IntervalSeconds 3 -Condition {
        if (-not (Test-Path $script:wsMessagesFile)) { return $false }

        foreach ($line in (Get-Content $script:wsMessagesFile -ErrorAction SilentlyContinue)) {
            try {
                $incidentEvent = $line | ConvertFrom-Json -ErrorAction Stop
            } catch {
                continue
            }

            if ($incidentEvent.eventType -eq "INCIDENT_CREATED" -and $incidentEvent.serviceName -eq $serviceName) {
                $script:wsIncidentId = $incidentEvent.incidentId
                return $true
            }
        }

        return $false
    }
    Write-Host "WebSocket carried INCIDENT_CREATED for ${serviceName} (incidentId=$script:wsIncidentId)"

    Set-Stage "poll REST proxy for the persisted incident"
    $script:restIncident = $null
    Wait-Until -Description "GET /api/v1/incidents contains the persisted incident" -TimeoutSeconds 60 -IntervalSeconds 3 -Condition {
        try {
            $incidents = Invoke-RestMethod -Uri "http://localhost:$DashboardLocalPort/api/v1/incidents" -TimeoutSec 5
        } catch {
            return $false
        }

        $match = $incidents | Where-Object { $_.serviceName -eq $serviceName }

        if ($match) {
            $script:restIncident = $match
            return $true
        }

        return $false
    }

    Set-Stage "verify incident fields"
    $requiredFields = @("id", "serviceName", "severity", "status", "title", "description", "createdAt", "updatedAt")
    foreach ($field in $requiredFields) {
        $value = $script:restIncident.$field
        if ([string]::IsNullOrEmpty($value)) {
            throw "Persisted incident is missing required field '$field'."
        }
    }
    Write-Host "Persisted incident has all required fields."

    Set-Stage "verify WebSocket and REST incident IDs match"
    if ($script:restIncident.id -ne $script:wsIncidentId) {
        throw "WebSocket incidentId ($script:wsIncidentId) does not match REST incident id ($($script:restIncident.id))."
    }
    Write-Host "WebSocket and REST incident IDs match: $($script:restIncident.id)"

    Write-Host "`nE2E test passed."
    exit 0
} catch {
    Write-Host "`nE2E test FAILED at stage '$script:stage': $($_.Exception.Message)" -ForegroundColor Red
    Save-Diagnostics
    exit 1
} finally {
    Set-Stage "cleanup"

    # Cluster and local-process cleanup first, deliberately ahead of the
    # WebSocket runspace below: those two lines must run even if stopping
    # the runspace is ever slow, not be blocked behind it.
    kubectl delete pod $script:testPodName -n default --ignore-not-found --wait=false | Out-Null

    if ($script:portForwardProcess -and -not $script:portForwardProcess.HasExited) {
        Stop-Process -Id $script:portForwardProcess.Id -Force -ErrorAction SilentlyContinue
    }

    Write-Host "Cleanup complete: removed pod/$script:testPodName and stopped the port-forward."

    if ($script:wsCts) {
        # Cancels the token ReceiveAsync is actually awaiting, in-process -
        # unblocks it immediately rather than depending on a cross-process
        # job-stop signal reaching a thread parked in a blocking async call.
        $script:wsCts.Cancel()
    }

    if ($script:wsPowerShell) {
        try {
            if ($script:wsAsyncResult -and -not $script:wsAsyncResult.IsCompleted) {
                [void]$script:wsAsyncResult.AsyncWaitHandle.WaitOne(5000)
            }
        } catch {
        } finally {
            try { $script:wsPowerShell.Stop() } catch {}
            $script:wsPowerShell.Dispose()
        }
    }

    if ($script:wsCts) {
        $script:wsCts.Dispose()
    }
}
