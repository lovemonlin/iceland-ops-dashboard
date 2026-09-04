<#
.SYNOPSIS
    Collects one production snapshot and publishes it. Intended to be run hourly by Windows Task
    Scheduler on a machine that stays on.

.DESCRIPTION
    One safe, single-shot run:

        acquire lock -> verify repo -> push anything left over -> pull --ff-only
        -> npm run snapshot -> validate -> guard changed files
        -> commit only the snapshot -> push -> log -> release lock

    It is deliberately conservative. It never stashes, resets, checks out, cleans or force-pushes,
    and it refuses to touch a working tree that has your own uncommitted work in it. If anything
    looks wrong it stops and leaves the previous published snapshot in place.

    No credential lives here. Pushing uses whatever Git credential helper the machine already has.

.PARAMETER Force
    Collect even if the current snapshot is younger than the skip window. Used for manual testing.

.PARAMETER RepositoryPath
    Repository to operate on. Defaults to the repository this script lives in.

.EXAMPLE
    .\scripts\hourly-snapshot.ps1
    .\scripts\hourly-snapshot.ps1 -Force
#>
[CmdletBinding()]
param(
    [switch] $Force,
    [string] $RepositoryPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ── Settings ──────────────────────────────────────────────────────────────────

# A snapshot younger than this is left alone, so the Windows runner and the GitHub schedule
# (still enabled as a backup) cannot both collect within the same hour.
$SkipIfSnapshotYoungerThanMinutes = 45

# The lock is treated as abandoned after this long, so a crashed run cannot block every later one.
$LockStaleAfterMinutes = 30

$MaxLogBytes = 5MB

# ── Paths ─────────────────────────────────────────────────────────────────────

if ([string]::IsNullOrWhiteSpace($RepositoryPath)) {
    $RepositoryPath = Split-Path -Parent $PSScriptRoot
}

$SnapshotRelativePath = 'public/data/latest-health.json'
$SnapshotPath = Join-Path $RepositoryPath 'public\data\latest-health.json'
$RuntimeDir = Join-Path $RepositoryPath '.runtime'
$LockPath = Join-Path $RuntimeDir 'hourly-snapshot.lock'
$LogDir = Join-Path $RepositoryPath 'logs'
$LogPath = Join-Path $LogDir 'hourly-snapshot.log'

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
    $line = '[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz'), $Message
    Write-Host $line
    Add-Content -Path $LogPath -Value $line -Encoding utf8
}

# ── Native command helpers ────────────────────────────────────────────────────

<#
    Windows PowerShell wraps a native command's stderr in ErrorRecords when it is redirected, which
    under $ErrorActionPreference = 'Stop' would throw on git's ordinary progress output. So every
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

function Invoke-Git {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]] $Arguments)
    # -Arguments is bound by name: passing the array positionally would collapse it into one string.
    return Invoke-Native -Command 'git' -Arguments (@('-C', $RepositoryPath) + $Arguments)
}

function Get-WorkingTreeChanges {
    $status = Invoke-Git status --porcelain
    if ($status.ExitCode -ne 0) { throw "git status failed: $($status.Output)" }
    if ([string]::IsNullOrWhiteSpace($status.Output)) { return @() }
    return @($status.Output -split "`r?`n" | Where-Object { $_ -ne '' })
}

# "?? path" / " M path" -> "path". Rename entries keep only the destination.
function Get-ChangedPath {
    param([string] $StatusLine)
    $path = $StatusLine.Substring(2).Trim()
    if ($path -match '->') { $path = ($path -split '->')[-1].Trim() }
    return $path.Trim('"')
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

# ── Snapshot validation ───────────────────────────────────────────────────────

# Delegates to node so the check matches how the dashboard itself reads the file.
function Test-SnapshotValid {
    $script = @'
const { readFileSync } = require("node:fs");
const snapshot = JSON.parse(readFileSync(process.argv[2], "utf8"));
const problems = [];
if (typeof snapshot.schemaVersion !== "number") problems.push("schemaVersion is not a number");
if (Number.isNaN(Date.parse(snapshot.generatedAt))) problems.push("generatedAt is not a valid timestamp");
if (!snapshot.sources || typeof snapshot.sources !== "object") problems.push("sources is missing");
if (!snapshot.pipelines || typeof snapshot.pipelines !== "object") problems.push("pipelines is missing");
const entries = [...Object.values(snapshot.sources ?? {}), ...Object.values(snapshot.pipelines ?? {})];
if (entries.length === 0) problems.push("snapshot contains no entries");
for (const entry of entries) {
  if (entry.provenance?.mode !== "production") problems.push(`${entry.id} is not production data`);
}
if (problems.length > 0) {
  console.error(problems.join("; "));
  process.exit(1);
}
console.log(`${entries.length} entries, generated ${snapshot.generatedAt}, overall ${snapshot.overallStatus}`);
'@
    $temp = Join-Path $env:TEMP ("validate-snapshot-{0}.cjs" -f [guid]::NewGuid())
    # Written without a BOM: Windows PowerShell's utf8 encoding adds one, and node rejects it.
    [System.IO.File]::WriteAllText($temp, $script, (New-Object System.Text.UTF8Encoding($false)))
    try {
        return Invoke-Native -Command 'node' -Arguments @($temp, $SnapshotPath)
    } finally {
        Remove-Item $temp -Force -ErrorAction SilentlyContinue
    }
}

function Get-SnapshotAgeMinutes {
    if (-not (Test-Path $SnapshotPath)) { return $null }
    try {
        $snapshot = Get-Content $SnapshotPath -Raw | ConvertFrom-Json
        $generated = [datetime]::Parse($snapshot.generatedAt, [cultureinfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::AdjustToUniversal)
        return ((Get-Date).ToUniversalTime() - $generated).TotalMinutes
    } catch {
        return $null
    }
}

# ── Main ──────────────────────────────────────────────────────────────────────

Initialize-Log
$exitCode = 0
$lockTaken = $false

try {
    Write-Log 'START'

    if (-not (Test-Path (Join-Path $RepositoryPath '.git'))) {
        Write-Log "ABORTED: $RepositoryPath is not a git repository."
        exit 1
    }

    if (Test-LockHeld) {
        Write-Log 'SKIPPED: previous hourly snapshot run still active.'
        exit 0
    }

    if (-not (Test-Path $RuntimeDir)) { New-Item -ItemType Directory -Path $RuntimeDir -Force | Out-Null }
    Set-Content -Path $LockPath -Value $PID -Encoding ascii
    $lockTaken = $true

    $branch = (Invoke-Git rev-parse --abbrev-ref HEAD).Output
    if ($branch -ne 'main') {
        Write-Log "ABORTED: expected branch main, found $branch."
        $exitCode = 1
        exit $exitCode
    }

    # Never touch a tree that has the user's own work in it.
    $changes = @(Get-WorkingTreeChanges)
    if ($changes.Count -gt 0) {
        Write-Log 'ABORTED: working tree is not clean.'
        foreach ($change in $changes) { Write-Log "  $change" }
        $exitCode = 1
        exit $exitCode
    }

    $fetch = Invoke-Git fetch origin main
    if ($fetch.ExitCode -ne 0) {
        Write-Log "ERROR: git fetch failed. $($fetch.Output)"
        $exitCode = 1
        exit $exitCode
    }

    # A previous run may have committed but failed to push; send that first rather than
    # collecting again and stacking a second snapshot commit on top.
    $ahead = [int](Invoke-Git rev-list --count 'origin/main..HEAD').Output
    if ($ahead -gt 0) {
        Write-Log "Local branch is $ahead commit(s) ahead of origin; pushing before collecting."
        $recover = Invoke-Git push origin main
        if ($recover.ExitCode -ne 0) {
            Write-Log "ERROR: PUSH FAILED while recovering earlier commits. $($recover.Output)"
            $exitCode = 1
            exit $exitCode
        }
        Write-Log 'push OK (recovered earlier commits)'
    }

    $pull = Invoke-Git pull --ff-only origin main
    if ($pull.ExitCode -ne 0) {
        Write-Log "ABORTED: git pull --ff-only failed; the branch has diverged and needs a human. $($pull.Output)"
        $exitCode = 1
        exit $exitCode
    }
    Write-Log 'git pull OK'

    if (-not $Force) {
        $age = Get-SnapshotAgeMinutes
        if ($null -ne $age -and $age -lt $SkipIfSnapshotYoungerThanMinutes) {
            Write-Log ("SKIPPED: snapshot is only {0:N0} minutes old (another scheduler already collected)." -f $age)
            exit 0
        }
    }

    Push-Location $RepositoryPath
    try {
        # Recorded in the snapshot, so a Windows collection is distinguishable from GitHub's.
        $env:SNAPSHOT_TRIGGER = 'windows'
        $run = Invoke-Native -Command 'npm' -Arguments @('run', 'snapshot')
    } finally {
        Pop-Location
    }
    foreach ($line in ($run.Output -split "`r?`n")) {
        if ($line.Trim() -ne '') { Write-Log "  npm: $($line.TrimEnd())" }
    }
    $snapshotExit = $run.ExitCode

    if ($snapshotExit -ne 0) {
        Write-Log "ERROR: SNAPSHOT FAILED (exit $snapshotExit). Nothing committed; the previous published snapshot stands."
        $exitCode = 1
        exit $exitCode
    }
    Write-Log 'snapshot OK'

    $validation = Test-SnapshotValid
    if ($validation.ExitCode -ne 0) {
        Write-Log "ABORTED: snapshot failed validation, refusing to publish. $($validation.Output)"
        $exitCode = 1
        exit $exitCode
    }
    Write-Log "validated: $($validation.Output)"

    # Only the snapshot may have moved. Anything else means something unexpected happened.
    $changes = @(Get-WorkingTreeChanges)
    $unexpected = @($changes | Where-Object { (Get-ChangedPath $_) -ne $SnapshotRelativePath })
    if ($unexpected.Count -gt 0) {
        Write-Log 'ABORTED: unexpected files changed.'
        foreach ($change in $unexpected) { Write-Log "  $change" }
        $exitCode = 1
        exit $exitCode
    }

    if ($changes.Count -eq 0) {
        Write-Log 'No snapshot changes.'
        Write-Log 'DONE'
        exit 0
    }

    # Named explicitly: never `git add .`, which could sweep in anything else.
    $add = Invoke-Git add $SnapshotRelativePath
    if ($add.ExitCode -ne 0) {
        Write-Log "ERROR: git add failed. $($add.Output)"
        $exitCode = 1
        exit $exitCode
    }

    $message = 'Update production snapshot {0}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm K')
    $commit = Invoke-Git commit -m $message
    if ($commit.ExitCode -ne 0) {
        Write-Log "ERROR: git commit failed. $($commit.Output)"
        $exitCode = 1
        exit $exitCode
    }
    $sha = (Invoke-Git rev-parse --short HEAD).Output
    Write-Log "commit $sha"

    $push = Invoke-Git push origin main
    if ($push.ExitCode -ne 0) {
        # The commit stays; the next run pushes it before collecting again.
        Write-Log "ERROR: PUSH FAILED. The commit is kept locally and the next run will push it. $($push.Output)"
        $exitCode = 1
        exit $exitCode
    }
    Write-Log 'push OK'
    Write-Log 'DONE'
} catch {
    Write-Log "ERROR: $($_.Exception.Message)"
    $exitCode = 1
} finally {
    if ($lockTaken -and (Test-Path $LockPath)) { Remove-Item $LockPath -Force -ErrorAction SilentlyContinue }
}

exit $exitCode
