<#
.SYNOPSIS
    Asks GitHub Actions to run one publishing workflow, then waits to see whether it actually
    worked. Intended to be run by Windows Task Scheduler on a machine that stays on.

.DESCRIPTION
    Windows is only the clock here. The publishers themselves — generate_road_data.py and
    generate_cloud_frames.py — keep running on GitHub Actions exactly as they always have; this
    script does nothing but trigger them reliably, because GitHub's own scheduler does not.

        acquire lock -> verify gh auth -> gh workflow run (retry the request 3x)
        -> identify the run this dispatch created -> poll until it completes
        -> record success or failure -> release lock

    Accepting `gh workflow run` exiting 0 as success would prove almost nothing: it only means the
    dispatch request was accepted. So the run this dispatch created is identified by id and
    creation time, and its conclusion is what decides the outcome.

    No credential lives here. Every GitHub call uses whatever login `gh auth login` already
    established on this machine.

.PARAMETER Workflow
    Workflow file name, e.g. "update-road-info.yml".

.PARAMETER TaskName
    Short label for the log and the lock file, e.g. "IRCA".

.EXAMPLE
    .\scripts\trigger-cloud-workflow.ps1 -Workflow "update-road-info.yml" -TaskName "IRCA"
    .\scripts\trigger-cloud-workflow.ps1 -Workflow "update-cloud-forecast.yml" -TaskName "ECMWF"
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string] $Workflow,
    [Parameter(Mandatory = $true)][string] $TaskName,
    [string] $Repository = 'lovemonlin/iceland-aurora-cloud',
    [string] $Ref = 'main',
    [string] $WorkingRoot,
    [double] $TimeoutMinutes = 20,
    [int] $PollSeconds = 15,
    [int] $RunAppearTimeoutSeconds = 180,
    [int] $DispatchRetries = 3,
    [int] $RetryDelaySeconds = 30,
    [int] $ClockToleranceSeconds = 90
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ── Settings ──────────────────────────────────────────────────────────────────

# The lock is treated as abandoned after this long, so a crashed run cannot block every later one.
# Comfortably longer than the run timeout, so a slow-but-live run is never cut in on.
$LockStaleAfterMinutes = $TimeoutMinutes + 10

$MaxLogBytes = 5MB

# ── Paths ─────────────────────────────────────────────────────────────────────

if ([string]::IsNullOrWhiteSpace($WorkingRoot)) {
    $WorkingRoot = Split-Path -Parent $PSScriptRoot
}

$RuntimeDir = Join-Path $WorkingRoot '.runtime'
# One lock per workflow: a road trigger must never block a cloud trigger, or vice versa.
$LockPath = Join-Path $RuntimeDir ('{0}-trigger.lock' -f $TaskName.ToLowerInvariant())
$LogDir = Join-Path $WorkingRoot 'logs'
$LogPath = Join-Path $LogDir 'cloud-workflow-trigger.log'

# ── Logging ───────────────────────────────────────────────────────────────────

function Initialize-Log {
    if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
    if (Test-Path $LogPath) {
        $size = (Get-Item $LogPath).Length
        if ($size -ge $MaxLogBytes) {
            $rotated = "$LogPath.1"
            if (Test-Path $rotated) { Remove-Item $rotated -Force }
            Move-Item $LogPath $rotated -Force
        }
    }
}

function Write-Log {
    param([string] $Message)
    $line = '[{0}] {1} {2}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz'), $TaskName, $Message
    Write-Host $line
    Add-Content -Path $LogPath -Value $line -Encoding utf8
}

# ── Native command helpers ────────────────────────────────────────────────────

<#
    Windows PowerShell wraps a native command's stderr in ErrorRecords when it is redirected, which
    under $ErrorActionPreference = 'Stop' would throw on ordinary progress output. So every
    external command runs with the preference relaxed, and the caller checks the exit code instead.
#>
function Invoke-Native {
    param(
        [Parameter(Mandatory = $true)][string] $Command,
        [Parameter(ValueFromRemainingArguments = $true)][string[]] $Arguments
    )
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = & $Command @Arguments 2>&1 | Out-String
        $code = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previous
    }
    return [pscustomobject]@{ ExitCode = $code; Output = $output.Trim() }
}

function Invoke-Gh {
    # -Arguments is bound by name: passing the array positionally would collapse it into one string.
    param([Parameter(ValueFromRemainingArguments = $true)][string[]] $Arguments)
    return Invoke-Native -Command 'gh' -Arguments $Arguments
}

# ── Lock ──────────────────────────────────────────────────────────────────────

function Test-LockHeld {
    if (-not (Test-Path $LockPath)) { return $false }

    $age = (Get-Date) - (Get-Item $LockPath).LastWriteTime
    if ($age.TotalMinutes -ge $LockStaleAfterMinutes) {
        Write-Log ("Clearing a lock abandoned {0:N0} minutes ago." -f $age.TotalMinutes)
        Remove-Item $LockPath -Force
        return $false
    }

    # A lock whose process is gone is from a crashed run, not a live one.
    $recordedPid = (Get-Content $LockPath -Raw -ErrorAction SilentlyContinue)
    if ($recordedPid) {
        $recordedPid = $recordedPid.Trim()
        $alive = Get-Process -Id $recordedPid -ErrorAction SilentlyContinue
        if (-not $alive) {
            Write-Log "Clearing a lock left behind by process $recordedPid, which is no longer running."
            Remove-Item $LockPath -Force
            return $false
        }
    }

    return $true
}

# ── GitHub ────────────────────────────────────────────────────────────────────

function ConvertFrom-GhJson {
    param([string] $Text)
    if ([string]::IsNullOrWhiteSpace($Text)) { return @() }
    try {
        return @($Text | ConvertFrom-Json)
    } catch {
        return @()
    }
}

function Get-DispatchRuns {
    $result = Invoke-Gh run list --repo $Repository --workflow $Workflow --event workflow_dispatch `
        --limit 10 --json 'databaseId,createdAt,status,conclusion'
    if ($result.ExitCode -ne 0) { return $null }
    return ConvertFrom-GhJson $result.Output
}

function Get-UtcTime {
    param($Value)
    return [datetime]::Parse([string]$Value, [cultureinfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::AdjustToUniversal)
}

# ── Main ──────────────────────────────────────────────────────────────────────

Initialize-Log
$exitCode = 0
$lockTaken = $false

try {
    Write-Log "START ($Workflow -> $Repository@$Ref)"

    # Never embed a token. If the machine is not logged in, that is a person's job to fix.
    $auth = Invoke-Gh auth status
    if ($auth.ExitCode -ne 0) {
        # The output can carry a masked token, so it is deliberately not logged.
        Write-Log 'ABORTED: gh is not authenticated on this machine. Run `gh auth login` interactively.'
        exit 1
    }
    Write-Log 'gh auth OK'

    if (Test-LockHeld) {
        Write-Log 'SKIPPED: previous trigger still active.'
        exit 0
    }

    if (-not (Test-Path $RuntimeDir)) { New-Item -ItemType Directory -Path $RuntimeDir -Force | Out-Null }
    Set-Content -Path $LockPath -Value $PID -Encoding ascii
    $lockTaken = $true

    # Recorded before dispatching so an older run can never be mistaken for this one.
    $before = Get-DispatchRuns
    $knownIds = @()
    if ($null -ne $before) { $knownIds = @($before | ForEach-Object { $_.databaseId }) }
    $triggerTime = (Get-Date).ToUniversalTime()
    Write-Log ("trigger time {0:yyyy-MM-ddTHH:mm:ss}Z" -f $triggerTime)

    # Only the dispatch *request* is retried. A workflow that ran and failed is a real failure and
    # must not be re-triggered here: that would stack duplicate runs on one broken publish.
    $dispatched = $false
    for ($attempt = 1; $attempt -le $DispatchRetries; $attempt++) {
        $dispatch = Invoke-Gh workflow run $Workflow --repo $Repository --ref $Ref
        if ($dispatch.ExitCode -eq 0) {
            Write-Log "dispatch accepted (attempt $attempt)"
            $dispatched = $true
            break
        }
        Write-Log "dispatch attempt $attempt failed. $($dispatch.Output)"
        if ($attempt -lt $DispatchRetries -and $RetryDelaySeconds -gt 0) { Start-Sleep -Seconds $RetryDelaySeconds }
    }

    if (-not $dispatched) {
        Write-Log "ERROR: DISPATCH FAILED after $DispatchRetries attempts. No run was created."
        $exitCode = 1
        exit $exitCode
    }

    # `gh workflow run` returning 0 only means the request was accepted, so the run itself is
    # identified here: it must be new, and it must have been created at or after the dispatch.
    $earliestAcceptable = $triggerTime.AddSeconds(-$ClockToleranceSeconds)
    $runId = $null
    $appearDeadline = (Get-Date).AddSeconds($RunAppearTimeoutSeconds)
    while ($null -eq $runId -and (Get-Date) -lt $appearDeadline) {
        if ($PollSeconds -gt 0) { Start-Sleep -Seconds $PollSeconds }
        $candidates = Get-DispatchRuns
        if ($null -eq $candidates) { continue }
        foreach ($candidate in $candidates) {
            if ($knownIds -contains $candidate.databaseId) { continue }
            $created = Get-UtcTime $candidate.createdAt
            if ($created -lt $earliestAcceptable) { continue }
            $runId = $candidate.databaseId
            Write-Log "run $runId detected (created $($candidate.createdAt))"
            break
        }
    }

    if ($null -eq $runId) {
        Write-Log 'ERROR: RUN NOT FOUND. The dispatch was accepted but no new workflow_dispatch run appeared.'
        $exitCode = 1
        exit $exitCode
    }

    $deadline = (Get-Date).AddMinutes($TimeoutMinutes)
    $status = 'unknown'
    $conclusion = ''
    while ((Get-Date) -lt $deadline) {
        $view = Invoke-Gh run view $runId --repo $Repository --json 'status,conclusion'
        if ($view.ExitCode -eq 0) {
            $parsed = @(ConvertFrom-GhJson $view.Output)
            if ($parsed.Count -gt 0) {
                $status = [string]$parsed[0].status
                $conclusion = [string]$parsed[0].conclusion
                if ($status -eq 'completed') { break }
            }
        }
        if ($PollSeconds -gt 0) { Start-Sleep -Seconds $PollSeconds }
    }

    if ($status -ne 'completed') {
        Write-Log "ERROR: TIMEOUT after $TimeoutMinutes minutes; run $runId is still $status."
        $exitCode = 1
        exit $exitCode
    }

    if ($conclusion -ne 'success') {
        # Left for the next scheduled occurrence rather than retried: a failing publisher does not
        # get better by being asked three more times in a row.
        Write-Log "ERROR: WORKFLOW FAILED. Run $runId concluded $conclusion."
        $exitCode = 1
        exit $exitCode
    }

    Write-Log "run $runId success"
    Write-Log 'DONE'
} catch {
    Write-Log "ERROR: $($_.Exception.Message)"
    $exitCode = 1
} finally {
    if ($lockTaken -and (Test-Path $LockPath)) { Remove-Item $LockPath -Force -ErrorAction SilentlyContinue }
}

exit $exitCode
