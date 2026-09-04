<#
.SYNOPSIS
    Offline safety tests for trigger-cloud-workflow.ps1.

.DESCRIPTION
    Every scenario runs against a fake `gh` on a temporary PATH and a temporary working root, so
    nothing here dispatches a real workflow, reads a real token, or touches a real repository.

    The fake reads a scripted scenario and records every call it received, which is how the tests
    can assert things a return code cannot show: that a failed workflow is not re-dispatched, that
    an older run is never accepted as this run, and that an unauthenticated machine dispatches
    nothing at all.

.EXAMPLE
    .\scripts\test-trigger-cloud-workflow.ps1
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
# Native commands write to stderr in the normal course of things; failures are read from exit codes.
$ErrorActionPreference = 'Continue'

$RunnerPath = Join-Path $PSScriptRoot 'trigger-cloud-workflow.ps1'
$script:Passed = 0
$script:Failed = 0

function Write-TextFile {
    # Written without a BOM: Windows PowerShell's utf8 encoding adds one, and the fake's JSON
    # parsing and the assertions both read cleaner without it.
    param([string] $Path, [string] $Content)
    $directory = Split-Path -Parent $Path
    if (-not (Test-Path $directory)) { New-Item -ItemType Directory -Path $directory -Force | Out-Null }
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

# ── The fake gh ───────────────────────────────────────────────────────────────

$FakeGh = @'
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$dir = $env:GH_FAKE_DIR
$scenario = Get-Content (Join-Path $dir 'scenario.json') -Raw | ConvertFrom-Json
Add-Content -Path (Join-Path $dir 'calls.log') -Value ($args -join ' ') -Encoding utf8

function Next-Value {
    param([string] $Name, $List)
    $items = @($List)
    if ($items.Count -eq 0) { return $null }
    $counterPath = Join-Path $dir ("counter-$Name.txt")
    $index = 0
    if (Test-Path $counterPath) { $index = [int](Get-Content $counterPath -Raw).Trim() }
    Set-Content -Path $counterPath -Value ($index + 1) -Encoding ascii
    # The last scripted answer repeats, so a poll loop keeps seeing the same state.
    if ($index -ge $items.Count) { $index = $items.Count - 1 }
    return $items[$index]
}

function Resolve-Times {
    param([string] $Text)
    $now = (Get-Date).ToUniversalTime()
    $text = $Text -replace '__NOW__', $now.ToString('yyyy-MM-ddTHH:mm:ssZ')
    return $text -replace '__OLD__', $now.AddHours(-4).ToString('yyyy-MM-ddTHH:mm:ssZ')
}

$command = if ($args.Count -ge 2) { "$($args[0]) $($args[1])" } else { "$($args[0])" }

switch ($command) {
    'auth status' { exit [int]$scenario.auth }
    'workflow run' { exit [int](Next-Value -Name 'dispatch' -List $scenario.dispatch) }
    'run list' {
        Write-Output (Resolve-Times (Next-Value -Name 'runList' -List $scenario.runList))
        exit 0
    }
    'run view' {
        Write-Output (Resolve-Times (Next-Value -Name 'runView' -List $scenario.runView))
        exit 0
    }
    default { Write-Error "fake gh received an unexpected command: $command"; exit 90 }
}
'@

function New-FakeGh {
    param([hashtable] $Scenario)

    $dir = Join-Path ([System.IO.Path]::GetTempPath()) ("gh-fake-{0}" -f [guid]::NewGuid())
    New-Item -ItemType Directory -Path $dir -Force | Out-Null

    Write-TextFile (Join-Path $dir 'gh-fake.ps1') $FakeGh
    # A .cmd shim is what PowerShell will find on PATH as "gh".
    Write-TextFile (Join-Path $dir 'gh.cmd') @"
@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0gh-fake.ps1" %*
"@
    Write-TextFile (Join-Path $dir 'scenario.json') ($Scenario | ConvertTo-Json -Depth 6)
    Write-TextFile (Join-Path $dir 'calls.log') ''
    return $dir
}

function New-WorkingRoot {
    $root = Join-Path ([System.IO.Path]::GetTempPath()) ("trigger-root-{0}" -f [guid]::NewGuid())
    New-Item -ItemType Directory -Path $root -Force | Out-Null
    return $root
}

function Invoke-Runner {
    param(
        [string] $FakeDir,
        [string] $Root,
        [string] $TaskName = 'IRCA',
        [string] $Workflow = 'update-road-info.yml',
        [int] $PollSeconds = 0
    )

    $arguments = @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $RunnerPath,
        '-Workflow', $Workflow,
        '-TaskName', $TaskName,
        '-Repository', 'example/fake-repo',
        '-WorkingRoot', $Root,
        '-PollSeconds', [string]$PollSeconds,
        '-RetryDelaySeconds', '0',
        '-RunAppearTimeoutSeconds', '3',
        '-TimeoutMinutes', '0.05'
    )
    $previousPath = $env:PATH
    $previousDir = $env:GH_FAKE_DIR
    $env:PATH = "$FakeDir;$previousPath"
    $env:GH_FAKE_DIR = $FakeDir
    try {
        $output = & powershell @arguments 2>&1 | Out-String
        $code = $LASTEXITCODE
    } finally {
        $env:PATH = $previousPath
        $env:GH_FAKE_DIR = $previousDir
    }
    return [pscustomobject]@{
        ExitCode = $code
        Output   = $output
        Calls    = @(Get-Content (Join-Path $FakeDir 'calls.log') | Where-Object { $_ -ne '' })
    }
}

function Get-CallCount {
    param([object] $Result, [string] $Pattern)
    return @($Result.Calls | Where-Object { $_ -like $Pattern }).Count
}

$RunningList = '[{"databaseId":991,"createdAt":"__NOW__","status":"in_progress","conclusion":""}]'
$OldOnlyList = '[{"databaseId":41,"createdAt":"__OLD__","status":"completed","conclusion":"success"}]'
$EmptyList = '[]'

# ── Scenarios ─────────────────────────────────────────────────────────────────

Write-Host ''
Write-Host '1. a normal trigger waits for the run and reports its success'
$fake = New-FakeGh @{
    auth     = 0
    dispatch = @(0)
    runList  = @($EmptyList, $RunningList)
    runView  = @('{"status":"in_progress","conclusion":""}', '{"status":"completed","conclusion":"success"}')
}
$root = New-WorkingRoot
$result = Invoke-Runner -FakeDir $fake -Root $root
Assert-That 'exits 0' ($result.ExitCode -eq 0) $result.Output
Assert-That 'dispatches exactly once' ((Get-CallCount $result 'workflow run*') -eq 1)
Assert-That 'identifies the run' ($result.Output -match 'run 991 detected')
Assert-That 'reports success' ($result.Output -match 'run 991 success')
Assert-That 'logs DONE' ($result.Output -match 'DONE')
$logged = Get-Content (Join-Path $root 'logs\cloud-workflow-trigger.log') -Raw
Assert-That 'writes the shared trigger log' ($logged -match 'IRCA DONE')
Assert-That 'releases the lock' (-not (Test-Path (Join-Path $root '.runtime\irca-trigger.lock')))

Write-Host ''
Write-Host '2. an unauthenticated machine dispatches nothing'
$fake = New-FakeGh @{ auth = 1; dispatch = @(0); runList = @($EmptyList); runView = @('{}') }
$root = New-WorkingRoot
$result = Invoke-Runner -FakeDir $fake -Root $root
Assert-That 'exits non-zero' ($result.ExitCode -ne 0)
Assert-That 'says it aborted on auth' ($result.Output -match 'ABORTED: gh is not authenticated')
Assert-That 'never dispatches' ((Get-CallCount $result 'workflow run*') -eq 0)
Assert-That 'tells the user to log in interactively' ($result.Output -match 'gh auth login')

Write-Host ''
Write-Host '3. a rejected dispatch request is retried'
$fake = New-FakeGh @{
    auth     = 0
    dispatch = @(1, 1, 0)
    runList  = @($EmptyList, $RunningList)
    runView  = @('{"status":"completed","conclusion":"success"}')
}
$root = New-WorkingRoot
$result = Invoke-Runner -FakeDir $fake -Root $root
Assert-That 'exits 0 once the request lands' ($result.ExitCode -eq 0) $result.Output
Assert-That 'retries up to three times' ((Get-CallCount $result 'workflow run*') -eq 3)
Assert-That 'reports which attempt worked' ($result.Output -match 'dispatch accepted \(attempt 3\)')

Write-Host ''
Write-Host '4. a dispatch that never lands fails loudly'
$fake = New-FakeGh @{ auth = 0; dispatch = @(1, 1, 1); runList = @($EmptyList); runView = @('{}') }
$root = New-WorkingRoot
$result = Invoke-Runner -FakeDir $fake -Root $root
Assert-That 'exits non-zero' ($result.ExitCode -ne 0)
Assert-That 'says DISPATCH FAILED' ($result.Output -match 'DISPATCH FAILED')
Assert-That 'stops after three attempts' ((Get-CallCount $result 'workflow run*') -eq 3)

Write-Host ''
Write-Host '5. a failed workflow is reported, not re-triggered'
$fake = New-FakeGh @{
    auth     = 0
    dispatch = @(0)
    runList  = @($EmptyList, $RunningList)
    runView  = @('{"status":"completed","conclusion":"failure"}')
}
$root = New-WorkingRoot
$result = Invoke-Runner -FakeDir $fake -Root $root
Assert-That 'exits non-zero' ($result.ExitCode -ne 0)
Assert-That 'says WORKFLOW FAILED' ($result.Output -match 'WORKFLOW FAILED')
Assert-That 'names the conclusion' ($result.Output -match 'concluded failure')
# The whole point: three duplicate runs on one broken publisher would help nobody.
Assert-That 'dispatches only once' ((Get-CallCount $result 'workflow run*') -eq 1)

Write-Host ''
Write-Host '6. an older run is never mistaken for this one'
$fake = New-FakeGh @{
    auth     = 0
    dispatch = @(0)
    runList  = @($OldOnlyList)
    runView  = @('{"status":"completed","conclusion":"success"}')
}
$root = New-WorkingRoot
$result = Invoke-Runner -FakeDir $fake -Root $root
Assert-That 'exits non-zero' ($result.ExitCode -ne 0)
Assert-That 'says RUN NOT FOUND' ($result.Output -match 'RUN NOT FOUND')
Assert-That 'never claims success' (-not ($result.Output -match 'run 41 success'))

Write-Host ''
Write-Host '7. a run already listed before the dispatch is never mistaken for this one'
# Same id, present both before and after: only its age would suggest it is new.
$fake = New-FakeGh @{
    auth     = 0
    dispatch = @(0)
    runList  = @($RunningList)
    runView  = @('{"status":"completed","conclusion":"success"}')
}
$root = New-WorkingRoot
$result = Invoke-Runner -FakeDir $fake -Root $root
Assert-That 'exits non-zero' ($result.ExitCode -ne 0)
Assert-That 'says RUN NOT FOUND' ($result.Output -match 'RUN NOT FOUND')

Write-Host ''
Write-Host '8. a run that never finishes times out'
$fake = New-FakeGh @{
    auth     = 0
    dispatch = @(0)
    runList  = @($EmptyList, $RunningList)
    runView  = @('{"status":"in_progress","conclusion":""}')
}
$root = New-WorkingRoot
$result = Invoke-Runner -FakeDir $fake -Root $root -PollSeconds 1
Assert-That 'exits non-zero' ($result.ExitCode -ne 0)
Assert-That 'says TIMEOUT' ($result.Output -match 'TIMEOUT')
Assert-That 'never claims success' (-not ($result.Output -match 'run 991 success'))

Write-Host ''
Write-Host '9. a trigger still running is not doubled up'
$fake = New-FakeGh @{ auth = 0; dispatch = @(0); runList = @($EmptyList); runView = @('{}') }
$root = New-WorkingRoot
New-Item -ItemType Directory -Path (Join-Path $root '.runtime') -Force | Out-Null
Set-Content -Path (Join-Path $root '.runtime\irca-trigger.lock') -Value $PID -Encoding ascii
$result = Invoke-Runner -FakeDir $fake -Root $root
Assert-That 'exits 0' ($result.ExitCode -eq 0) $result.Output
Assert-That 'says SKIPPED' ($result.Output -match 'SKIPPED: previous trigger still active')
Assert-That 'never dispatches' ((Get-CallCount $result 'workflow run*') -eq 0)
Assert-That 'leaves the lock in place' (Test-Path (Join-Path $root '.runtime\irca-trigger.lock'))

Write-Host ''
Write-Host '10. the two workflows hold separate locks'
$fake = New-FakeGh @{
    auth     = 0
    dispatch = @(0)
    runList  = @($EmptyList, $RunningList)
    runView  = @('{"status":"completed","conclusion":"success"}')
}
$root = New-WorkingRoot
New-Item -ItemType Directory -Path (Join-Path $root '.runtime') -Force | Out-Null
Set-Content -Path (Join-Path $root '.runtime\irca-trigger.lock') -Value $PID -Encoding ascii
$result = Invoke-Runner -FakeDir $fake -Root $root -TaskName 'ECMWF' -Workflow 'update-cloud-forecast.yml'
Assert-That 'a held IRCA lock does not block ECMWF' ($result.ExitCode -eq 0) $result.Output
Assert-That 'ECMWF still dispatches' ((Get-CallCount $result 'workflow run*') -eq 1)
Assert-That 'the IRCA lock is untouched' (Test-Path (Join-Path $root '.runtime\irca-trigger.lock'))
Assert-That 'the ECMWF lock is released' (-not (Test-Path (Join-Path $root '.runtime\ecmwf-trigger.lock')))

Write-Host ''
Write-Host '11. nothing secret is ever written to the log'
$logged = Get-Content (Join-Path $root 'logs\cloud-workflow-trigger.log') -Raw
Assert-That 'no token appears in the log' (-not ($logged -match 'gh[pousr]_|github_pat_'))
Assert-That 'auth output is not echoed' (-not ($logged -match 'Token:'))

Write-Host ''
Write-Host "$script:Passed passed, $script:Failed failed"
exit ([int]($script:Failed -gt 0))
