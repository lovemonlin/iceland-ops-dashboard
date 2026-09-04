<#
.SYNOPSIS
    Exercises hourly-snapshot.ps1's safety behaviour against throwaway repositories.

.DESCRIPTION
    Every case builds a fresh temporary repository with a fake `npm run snapshot`, so the real
    production repository is never used to test failure handling. Run it after changing the runner.

.EXAMPLE
    .\scripts\test-hourly-snapshot.ps1
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
# Continue, not Stop: Windows PowerShell turns a native command's stderr into ErrorRecords, and git
# writes ordinary notices there. Every step below is checked explicitly instead.
$ErrorActionPreference = 'Continue'

$Runner = Join-Path $PSScriptRoot 'hourly-snapshot.ps1'
$script:Passed = 0
$script:Failed = 0

<# Windows PowerShell's utf8 encoding writes a BOM, which node rejects when parsing JSON. #>
function Write-TextFile {
    param([string] $Path, [string] $Content)
    [System.IO.File]::WriteAllText($Path, $Content, (New-Object System.Text.UTF8Encoding($false)))
}

function Assert-That {
    param([string] $Name, [bool] $Condition, [string] $Detail = '')
    if ($Condition) {
        Write-Host "  PASS  $Name" -ForegroundColor Green
        $script:Passed++
    } else {
        Write-Host "  FAIL  $Name" -ForegroundColor Red
        if ($Detail) { Write-Host "        $Detail" -ForegroundColor DarkGray }
        $script:Failed++
    }
}

<#
    A miniature repository: a real git repo with a bare origin, a valid snapshot, and a committed
    fake collector whose behaviour is chosen by mode. The collector is a file rather than an inline
    `node -e` because cmd mangles quotes and parentheses on the way through npm.
#>
function New-TestRepository {
    param([ValidateSet('fresh', 'noop', 'fail', 'corrupt', 'mock', 'stray')][string] $Mode = 'noop')

    $root = Join-Path ([System.IO.Path]::GetTempPath()) ("hourly-test-{0}" -f [guid]::NewGuid())
    $work = Join-Path $root 'work'
    $origin = Join-Path $root 'origin.git'
    New-Item -ItemType Directory -Path $work -Force | Out-Null

    & git init --bare --initial-branch=main $origin *>$null
    & git -C $work init --initial-branch=main *>$null
    & git -C $work config user.name 'Test Runner' *>$null
    & git -C $work config user.email 'test@example.invalid' *>$null
    & git -C $work config core.autocrlf false *>$null
    & git -C $work remote add origin $origin *>$null

    New-Item -ItemType Directory -Path (Join-Path $work 'public\data') -Force | Out-Null
    Write-TextFile (Join-Path $work '.gitignore') "logs/`n.runtime/`n"


    $snapshot = @{
        schemaVersion = 1
        generatedAt   = (Get-Date).ToUniversalTime().AddHours(-3).ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
        overallStatus = 'ok'
        sources       = @{ metno = @{ id = 'metno'; provenance = @{ mode = 'production' } } }
        pipelines     = @{ ircaPipeline = @{ id = 'ircaPipeline'; provenance = @{ mode = 'production' } } }
    }
    Write-TextFile (Join-Path $work 'public\data\latest-health.json') ($snapshot | ConvertTo-Json -Depth 6)

    $collector = @'
const fs = require("node:fs");
const mode = process.argv[2];
const file = "public/data/latest-health.json";

if (mode === "fail") process.exit(3);
if (mode === "noop") process.exit(0);
if (mode === "corrupt") {
  fs.writeFileSync(file, "{ not json");
  process.exit(0);
}

const snapshot = JSON.parse(fs.readFileSync(file, "utf8"));
snapshot.generatedAt = new Date().toISOString();
if (mode === "mock") snapshot.sources.metno.provenance.mode = "mock";
fs.writeFileSync(file, JSON.stringify(snapshot, null, 2));
if (mode === "stray") fs.appendFileSync("package.json", " ");
'@
    Write-TextFile (Join-Path $work 'fake-collector.cjs') $collector

    $package = @{ name = 'hourly-test'; version = '1.0.0'; scripts = @{ snapshot = "node fake-collector.cjs $Mode" } }
    Write-TextFile (Join-Path $work 'package.json') ($package | ConvertTo-Json -Depth 4)

    & git -C $work add -A *>$null
    & git -C $work commit -m 'initial' *>$null
    & git -C $work push -u origin main *>$null

    return [pscustomobject]@{ Root = $root; Work = $work; Origin = $origin }
}

function Invoke-Runner {
    param([string] $Work, [switch] $Force)
    $arguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $Runner, '-RepositoryPath', $Work)
    if ($Force) { $arguments += '-Force' }
    $output = & powershell.exe @arguments 2>&1 | Out-String
    return [pscustomobject]@{ ExitCode = $LASTEXITCODE; Output = $output }
}

function Get-CommitCount {
    param([string] $Work)
    return [int](& git -C $Work rev-list --count HEAD)
}

$repos = @()
try {
    Write-Host "`n1. a normal run commits and pushes only the snapshot" -ForegroundColor Cyan
    $repo = New-TestRepository -Mode fresh; $repos += $repo
    $before = Get-CommitCount $repo.Work
    $result = Invoke-Runner -Work $repo.Work
    $changedFiles = (& git -C $repo.Work show --name-only --pretty=format: HEAD | Where-Object { $_ -ne '' })
    Assert-That 'exits 0' ($result.ExitCode -eq 0) $result.Output
    Assert-That 'creates exactly one commit' ((Get-CommitCount $repo.Work) -eq $before + 1)
    Assert-That 'commit touches only the snapshot' (($changedFiles -join ',') -eq 'public/data/latest-health.json') ($changedFiles -join ',')
    Assert-That 'pushed to origin' ([int](& git -C $repo.Work rev-list --count 'origin/main..HEAD') -eq 0)
    Assert-That 'logs DONE' ($result.Output -match 'DONE')

    Write-Host "`n2. a dirty working tree aborts without collecting" -ForegroundColor Cyan
    $repo = New-TestRepository -Mode fresh; $repos += $repo
    Set-Content -Path (Join-Path $repo.Work 'my-notes.txt') -Value 'work in progress' -Encoding utf8
    $before = Get-CommitCount $repo.Work
    $result = Invoke-Runner -Work $repo.Work
    Assert-That 'exits non-zero' ($result.ExitCode -ne 0)
    Assert-That 'says ABORTED' ($result.Output -match 'ABORTED: working tree is not clean')
    Assert-That 'creates no commit' ((Get-CommitCount $repo.Work) -eq $before)
    Assert-That 'leaves the user file alone' (Test-Path (Join-Path $repo.Work 'my-notes.txt'))

    Write-Host "`n3. a held lock skips" -ForegroundColor Cyan
    $repo = New-TestRepository -Mode fresh; $repos += $repo
    New-Item -ItemType Directory -Path (Join-Path $repo.Work '.runtime') -Force | Out-Null
    Set-Content -Path (Join-Path $repo.Work '.runtime\hourly-snapshot.lock') -Value $PID -Encoding ascii
    $before = Get-CommitCount $repo.Work
    $result = Invoke-Runner -Work $repo.Work
    Assert-That 'exits 0' ($result.ExitCode -eq 0)
    Assert-That 'says SKIPPED' ($result.Output -match 'SKIPPED: previous hourly snapshot run still active')
    Assert-That 'creates no commit' ((Get-CommitCount $repo.Work) -eq $before)
    Assert-That 'leaves the lock in place' (Test-Path (Join-Path $repo.Work '.runtime\hourly-snapshot.lock'))

    Write-Host "`n4. a failing snapshot command never publishes" -ForegroundColor Cyan
    $repo = New-TestRepository -Mode fail; $repos += $repo
    $before = Get-CommitCount $repo.Work
    $result = Invoke-Runner -Work $repo.Work
    Assert-That 'exits non-zero' ($result.ExitCode -ne 0)
    Assert-That 'says SNAPSHOT FAILED' ($result.Output -match 'SNAPSHOT FAILED')
    Assert-That 'creates no commit' ((Get-CommitCount $repo.Work) -eq $before)

    Write-Host "`n5. an invalid snapshot is never published" -ForegroundColor Cyan
    $repo = New-TestRepository -Mode corrupt; $repos += $repo
    $before = Get-CommitCount $repo.Work
    $result = Invoke-Runner -Work $repo.Work
    Assert-That 'exits non-zero' ($result.ExitCode -ne 0)
    Assert-That 'says it refuses to publish' ($result.Output -match 'failed validation')
    Assert-That 'creates no commit' ((Get-CommitCount $repo.Work) -eq $before)

    Write-Host "`n6. non-production provenance is never published" -ForegroundColor Cyan
    $repo = New-TestRepository -Mode mock; $repos += $repo
    $before = Get-CommitCount $repo.Work
    $result = Invoke-Runner -Work $repo.Work
    Assert-That 'exits non-zero' ($result.ExitCode -ne 0)
    Assert-That 'names the offending source' ($result.Output -match 'metno is not production data')
    Assert-That 'creates no commit' ((Get-CommitCount $repo.Work) -eq $before)

    Write-Host "`n7. an unexpected changed file aborts" -ForegroundColor Cyan
    $repo = New-TestRepository -Mode stray; $repos += $repo
    $before = Get-CommitCount $repo.Work
    $result = Invoke-Runner -Work $repo.Work
    Assert-That 'exits non-zero' ($result.ExitCode -ne 0)
    Assert-That 'says unexpected files changed' ($result.Output -match 'ABORTED: unexpected files changed')
    Assert-That 'creates no commit' ((Get-CommitCount $repo.Work) -eq $before)

    Write-Host "`n8. no change is a success, not a failure" -ForegroundColor Cyan
    $repo = New-TestRepository -Mode noop; $repos += $repo
    $before = Get-CommitCount $repo.Work
    $result = Invoke-Runner -Work $repo.Work
    Assert-That 'exits 0' ($result.ExitCode -eq 0)
    Assert-That 'says no snapshot changes' ($result.Output -match 'No snapshot changes')
    Assert-That 'creates no commit' ((Get-CommitCount $repo.Work) -eq $before)

    Write-Host "`n9. a commit left unpushed is sent by the next run, without collecting twice" -ForegroundColor Cyan
    $repo = New-TestRepository -Mode fresh; $repos += $repo
    # Simulate the previous run committing and then failing to push.
    Add-Content -Path (Join-Path $repo.Work 'public\data\latest-health.json') -Value ' ' -Encoding utf8
    & git -C $repo.Work add public/data/latest-health.json *>$null
    & git -C $repo.Work commit -m 'Update production snapshot (unpushed)' *>$null
    $before = Get-CommitCount $repo.Work
    $result = Invoke-Runner -Work $repo.Work
    Assert-That 'exits 0' ($result.ExitCode -eq 0) $result.Output
    Assert-That 'reports the recovery push' ($result.Output -match 'recovered earlier commits')
    Assert-That 'origin has the earlier commit' ([int](& git -C $repo.Work rev-list --count 'origin/main..HEAD') -eq 0)
    Assert-That 'adds at most one new commit' ((Get-CommitCount $repo.Work) -le $before + 1)

    Write-Host "`n10. a fresh snapshot is left alone unless forced" -ForegroundColor Cyan
    $repo = New-TestRepository -Mode fresh; $repos += $repo
    $file = Join-Path $repo.Work 'public\data\latest-health.json'
    $current = Get-Content $file -Raw | ConvertFrom-Json
    $current.generatedAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
    Write-TextFile $file ($current | ConvertTo-Json -Depth 6)
    & git -C $repo.Work add public/data/latest-health.json *>$null
    & git -C $repo.Work commit -m 'fresh snapshot' *>$null
    & git -C $repo.Work push origin main *>$null
    $before = Get-CommitCount $repo.Work
    $result = Invoke-Runner -Work $repo.Work
    Assert-That 'exits 0' ($result.ExitCode -eq 0)
    Assert-That 'says it skipped a recent collection' ($result.Output -match 'SKIPPED: snapshot is only')
    Assert-That 'creates no commit' ((Get-CommitCount $repo.Work) -eq $before)
} finally {
    foreach ($repo in $repos) {
        Remove-Item $repo.Root -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Write-Host "`n$($script:Passed) passed, $($script:Failed) failed" -ForegroundColor $(if ($script:Failed -eq 0) { 'Green' } else { 'Red' })
if ($script:Failed -gt 0) { exit 1 }
