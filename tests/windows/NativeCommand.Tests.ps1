<#
.SYNOPSIS
    Regression tests for scripts/windows/NativeCommand.ps1.

.DESCRIPTION
    The headline case is the one that broke the installer: a native command
    that writes warnings to stderr and exits 0 must be treated as success, with
    its warnings preserved, while the caller keeps $ErrorActionPreference =
    'Stop'.

    Deliberately dependency-free — no Pester — so it runs with nothing but
    `pwsh` (or `powershell.exe`) on any platform.

.EXAMPLE
    pwsh -NoProfile -File tests/windows/NativeCommand.Tests.ps1
#>

[CmdletBinding()]
param()

$script:Passed = 0
$script:Failed = 0

function Test-Case {
    param([string]$Name, [scriptblock]$Body)
    try {
        & $Body
        $script:Passed++
        Write-Host ("  [PASS] " + $Name)
    } catch {
        $script:Failed++
        Write-Host ("  [FAIL] " + $Name + " -- " + $_.Exception.Message)
    }
}

function Assert-True($condition, $message) {
    if (-not $condition) { throw $message }
}

function Assert-Equal($expected, $actual, $message) {
    if ($expected -ne $actual) { throw "$message (expected '$expected', got '$actual')" }
}

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
. (Join-Path $repoRoot "scripts\windows\NativeCommand.ps1".Replace('\', [IO.Path]::DirectorySeparatorChar))

$isWindowsHost = ($PSVersionTable.PSVersion.Major -lt 6) -or $IsWindows

# ── Fixtures ─────────────────────────────────────────────────────────────────
#
# Small executables that reproduce the shapes we care about. On Windows they
# are .cmd files; elsewhere, shell scripts.

$fixtureDir = Join-Path ([IO.Path]::GetTempPath()) ("mdtex-nativecmd-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $fixtureDir | Out-Null

function New-Fixture {
    param([string]$Name, [string]$CmdBody, [string]$ShBody)
    if ($isWindowsHost) {
        $path = Join-Path $fixtureDir "$Name.cmd"
        Set-Content -LiteralPath $path -Value $CmdBody -Encoding ASCII
    } else {
        $path = Join-Path $fixtureDir $Name
        Set-Content -LiteralPath $path -Value $ShBody -Encoding UTF8
        & /bin/chmod +x $path
    }
    return $path
}

# Exits 0 but writes deprecation warnings to stderr -- exactly npm install.
$noisySuccess = New-Fixture -Name "noisy-success" `
    -CmdBody @"
@echo off
echo npm warn deprecated whatwg-encoding@3.1.1: superseded 1>&2
echo npm warn deprecated abab@2.0.6: no longer supported 1>&2
echo added 37 packages in 1s
exit /b 0
"@ `
    -ShBody @'
#!/bin/sh
echo "npm warn deprecated whatwg-encoding@3.1.1: superseded" >&2
echo "npm warn deprecated abab@2.0.6: no longer supported" >&2
echo "added 37 packages in 1s"
exit 0
'@

# Genuinely fails.
$realFailure = New-Fixture -Name "real-failure" `
    -CmdBody @"
@echo off
echo npm error code ENOENT 1>&2
exit /b 254
"@ `
    -ShBody @'
#!/bin/sh
echo "npm error code ENOENT" >&2
exit 254
'@

# Echoes its arguments one per line, to prove argv survives intact.
$echoArgs = New-Fixture -Name "echo-args" `
    -CmdBody @"
@echo off
:loop
if "%~1"=="" goto :eof
echo [%~1]
shift
goto loop
"@ `
    -ShBody @'
#!/bin/sh
# printf, not echo: /bin/sh's echo expands backslash escapes, which would
# mangle a Windows-style path such as C:\Program Files\nodejs\npm.cmd.
for a in "$@"; do printf '[%s]\n' "$a"; done
'@

Write-Host ""
Write-Host "NativeCommand helper regression tests"
Write-Host "PowerShell $($PSVersionTable.PSVersion) on $(if ($isWindowsHost) { 'Windows' } else { $PSVersionTable.Platform })"
Write-Host ""

# ── The regression this whole change exists for ──────────────────────────────

Test-Case "stderr warnings with exit 0 are a success, under ErrorActionPreference=Stop" {
    $ErrorActionPreference = 'Stop'
    $result = Invoke-NativeCommand -FilePath $noisySuccess -Capture

    Assert-True $result.Success "a command that exited 0 must be reported as success"
    Assert-Equal 0 $result.ExitCode "exit code"
    Assert-True ($null -eq $result.Error) "no error should be recorded for a successful command"
}

Test-Case "the warnings themselves are preserved, not swallowed" {
    $ErrorActionPreference = 'Stop'
    $result = Invoke-NativeCommand -FilePath $noisySuccess -Capture
    $joined = ($result.Output -join "`n")

    Assert-True ($joined -match 'whatwg-encoding') "the first deprecation warning must survive"
    Assert-True ($joined -match 'abab') "the second deprecation warning must survive"
    Assert-True ($joined -match 'added 37 packages') "stdout must survive too"
}

Test-Case "an installer step continues after a warning-producing command" {
    # The failure mode reproduced end to end: a strict script that runs a noisy
    # command and then keeps going.
    $ErrorActionPreference = 'Stop'
    $reachedTheEnd = $false

    $result = Invoke-NativeCommand -FilePath $noisySuccess -Capture
    if (-not $result.Success) { throw "installer would have aborted on a warning" }
    $reachedTheEnd = $true

    Assert-True $reachedTheEnd "the script must reach the step after the noisy command"
}

Test-Case "a non-zero exit code is a failure" {
    $ErrorActionPreference = 'Stop'
    $result = Invoke-NativeCommand -FilePath $realFailure -Capture

    Assert-True (-not $result.Success) "exit 254 must be reported as failure"
    Assert-Equal 254 $result.ExitCode "exit code must be reported verbatim"
    Assert-True (($result.Output -join "`n") -match 'ENOENT') "failure output must be available to report"
}

Test-Case "failure does not throw, so the caller can print its own message" {
    $ErrorActionPreference = 'Stop'
    $threw = $false
    try { $null = Invoke-NativeCommand -FilePath $realFailure -Capture } catch { $threw = $true }
    Assert-True (-not $threw) "the helper must return a result, never throw, on a non-zero exit"
}

Test-Case "the caller's ErrorActionPreference is left untouched" {
    $ErrorActionPreference = 'Stop'
    $null = Invoke-NativeCommand -FilePath $noisySuccess -Capture
    Assert-Equal 'Stop' $ErrorActionPreference "the caller's strict setting must survive the call"
}

Test-Case "strict native exit-code mode does not defeat the helper" {
    # PowerShell 7.3+ can turn a non-zero exit into a terminating error. The
    # helper must still return a result rather than exploding.
    $ErrorActionPreference = 'Stop'
    if (Test-Path -Path 'variable:PSNativeCommandUseErrorActionPreference') {
        $PSNativeCommandUseErrorActionPreference = $true
    }

    $result = Invoke-NativeCommand -FilePath $realFailure -Capture
    Assert-True (-not $result.Success) "still a failure"
    Assert-Equal 254 $result.ExitCode "exit code still reported"

    if (Test-Path -Path 'variable:PSNativeCommandUseErrorActionPreference') {
        Assert-True $PSNativeCommandUseErrorActionPreference "the caller's setting must be restored"
    }
}

# ── Streaming (no -Capture) ──────────────────────────────────────────────────

Test-Case "streaming mode also reports the exit code correctly" {
    $ErrorActionPreference = 'Stop'
    # The command's own output goes to the console in streaming mode, which is
    # the point of it; muted here only to keep the test log readable.
    $result = Invoke-NativeCommand -FilePath $noisySuccess 2>$null 6>$null
    Assert-True $result.Success "streaming a noisy command is still a success"
}

# ── Arguments and paths with spaces ──────────────────────────────────────────

Test-Case "arguments containing spaces are passed as single arguments" {
    $ErrorActionPreference = 'Stop'
    $result = Invoke-NativeCommand -FilePath $echoArgs `
        -Arguments @("--target", "C:\Program Files\nodejs\npm.cmd", "two words", "plain") -Capture

    $lines = @($result.Output | Where-Object { $_ -match '^\[' })
    Assert-Equal 4 $lines.Count "each argument must arrive as exactly one argv entry"
    Assert-True ($lines -contains '[C:\Program Files\nodejs\npm.cmd]') "a path with spaces must arrive intact"
    Assert-True ($lines -contains '[two words]') "an argument with a space must arrive intact"
}

Test-Case "an executable whose own path contains spaces can be run" {
    $ErrorActionPreference = 'Stop'
    $spacedDir = Join-Path $fixtureDir "Program Files"
    New-Item -ItemType Directory -Force -Path $spacedDir | Out-Null

    $leaf = Split-Path -Leaf $noisySuccess
    $spacedExe = Join-Path $spacedDir $leaf
    Copy-Item -LiteralPath $noisySuccess -Destination $spacedExe -Force
    if (-not $isWindowsHost) { & /bin/chmod +x $spacedExe }

    $result = Invoke-NativeCommand -FilePath $spacedExe -Capture
    Assert-True $result.Success "a command under a path with spaces must run"
}

Test-Case "a missing command is a reported failure, not a crash" {
    $ErrorActionPreference = 'Stop'
    $result = Invoke-ResolvedCommand -Name "mdtex-no-such-command-anywhere"
    Assert-True (-not $result.Success) "a missing command is a failure"
    Assert-True ($result.Error -match 'not found') "with an explanatory message"
}

# ── Resolution never picks a .ps1 ────────────────────────────────────────────

Test-Case "Windows candidates never include a .ps1 wrapper" {
    $candidates = Get-NativeCommandCandidateName -Name "npm" -ForWindows $true
    Assert-True ($candidates -notcontains "npm.ps1") "npm.ps1 must never be a candidate"
    Assert-True ($candidates -contains "npm.cmd") "npm.cmd must be a candidate"
    Assert-True ($candidates -contains "npm.exe") "npm.exe must be a candidate"
}

Test-Case "an explicit extension is honoured as given" {
    $candidates = Get-NativeCommandCandidateName -Name "npm.cmd" -ForWindows $true
    Assert-Equal 1 $candidates.Count "an explicit extension must not be expanded"
    Assert-Equal "npm.cmd" $candidates[0] "and must be used verbatim"
}

Test-Case "non-Windows resolution is unchanged" {
    $candidates = Get-NativeCommandCandidateName -Name "npm" -ForWindows $false
    Assert-Equal 1 $candidates.Count "no extensions are appended off Windows"
    Assert-Equal "npm" $candidates[0] "the bare name is used"
}

Test-Case "resolution prefers the .cmd when a .ps1 sits beside it" {
    # PowerShell's own discovery prefers the .ps1; ours must not. This is the
    # root cause of the reported installer failure, asserted directly.
    $shimDir = Join-Path $fixtureDir "shims"
    New-Item -ItemType Directory -Force -Path $shimDir | Out-Null

    Set-Content -LiteralPath (Join-Path $shimDir "faketool.cmd") -Value "@echo off`r`necho cmd" -Encoding ASCII
    Set-Content -LiteralPath (Join-Path $shimDir "faketool.ps1") -Value "Write-Host 'ps1'" -Encoding UTF8
    if (-not $isWindowsHost) { & /bin/chmod +x (Join-Path $shimDir "faketool.cmd") }

    $originalPath = $env:PATH
    try {
        $env:PATH = $shimDir + [IO.Path]::PathSeparator + $env:PATH

        # What PowerShell would have picked on its own:
        $whatPowerShellPicks = (Get-Command faketool -ErrorAction SilentlyContinue).Source
        Assert-True ($whatPowerShellPicks -match '\.ps1$') `
            "precondition: PowerShell's own discovery prefers the .ps1 (this is the bug)"

        $resolved = Resolve-NativeCommand -Name "faketool" -ForWindows $true
        Assert-True ($resolved -match '\.cmd$') "our resolution must pick the .cmd, not the .ps1"
    } finally {
        $env:PATH = $originalPath
    }
}

# ── Cleanup ──────────────────────────────────────────────────────────────────

Remove-Item -LiteralPath $fixtureDir -Recurse -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host ("  " + $script:Passed + " passed, " + $script:Failed + " failed")
Write-Host ""

if ($script:Failed -gt 0) { exit 1 }
exit 0
