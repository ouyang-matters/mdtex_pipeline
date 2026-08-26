# MDTeX Studio Installer (Windows)
#
# Run from PowerShell:  .\install.ps1
# Safe to run multiple times (idempotent).
#
# The command contract is identical on Windows and Linux:
#   publisher start | init | doctor | update | build <article> --target <t> | version
#
# This script creates publisher.cmd and publisher.ps1 shims in a user-writable
# bin directory and adds that directory to the user PATH, so the plain
# `publisher` command works in both PowerShell and CMD without activating any
# environment or typing a path to a script.
#
# Every native command below goes through Invoke-NativeCommand. Success is
# decided by the process exit code and nothing else: npm, npx and git all write
# warnings and progress to stderr, and stderr is not failure. See
# scripts/windows/NativeCommand.ps1 for why that needs saying.

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppName = "publisher"
$MinNodeMajor = 18

$helperPath = Join-Path $ScriptDir "scripts\windows\NativeCommand.ps1"
if (-not (Test-Path -LiteralPath $helperPath)) {
    Write-Host "Error: missing $helperPath" -ForegroundColor Red
    Write-Host "Run the installer from a complete checkout of the repository."
    exit 1
}
. $helperPath

function Write-Step($msg)  { Write-Host $msg -ForegroundColor White }
function Write-Ok($msg)    { Write-Host $msg -ForegroundColor Green }
function Write-Warn($msg)  { Write-Host $msg -ForegroundColor Yellow }
function Write-Fail($msg)  { Write-Host $msg -ForegroundColor Red }
function Write-Indented($lines) { $lines | ForEach-Object { Write-Host "  $_" } }

# npm and friends report deprecations and audit notices on stderr. Those are
# diagnostics worth showing, so they are surfaced rather than swallowed — but
# they never decide whether a step succeeded.
function Show-CommandDiagnostics($result, [int]$TailLines = 3) {
    $warnings = @($result.Output | Where-Object { $_ -match '(?i)\b(warn|warning|deprecat|vulnerabilit)' })
    if ($warnings.Count -gt 0) { Write-Indented $warnings }

    $tail = @($result.Output | Where-Object { $_ -notmatch '(?i)\b(warn|warning|deprecat|vulnerabilit)' } |
              Select-Object -Last $TailLines)
    if ($tail.Count -gt 0) { Write-Indented $tail }
}

Write-Host ""
Write-Step "MDTeX Studio Installer"
Write-Step "======================"
Write-Host ""

# ── 1. Check Node.js ────────────────────────────────────────────────────────

$nodeExe = Resolve-NativeCommand -Name "node" -Optional
if (-not $nodeExe) {
    Write-Fail "Error: Node.js is not installed."
    Write-Host "Install Node.js >= $MinNodeMajor from https://nodejs.org/"
    exit 1
}

$nodeCheck = Invoke-NativeCommand -FilePath $nodeExe -Arguments @("-v") -Capture
if (-not $nodeCheck.Success) {
    Write-Fail "Error: could not run Node.js at $nodeExe"
    if ($nodeCheck.Error) { Write-Host "  $($nodeCheck.Error)" }
    exit 1
}

$nodeVersion = ($nodeCheck.Output | Select-Object -First 1).Trim()
$nodeMajor = [int]($nodeVersion -replace '^v(\d+).*', '$1')
if ($nodeMajor -lt $MinNodeMajor) {
    Write-Fail "Error: Node.js $nodeVersion is too old. Need >= v$MinNodeMajor."
    exit 1
}
Write-Host "Node.js: $nodeVersion  ($nodeExe)"

# ── 2. Check npm ────────────────────────────────────────────────────────────

# Resolved explicitly to npm.cmd rather than left to PowerShell, which would
# pick npm.ps1 and run npm inside a PowerShell scope that inherits this
# script's 'Stop' preference.
$npmExe = Resolve-NativeCommand -Name "npm" -Optional
if (-not $npmExe) {
    Write-Fail "Error: npm is not installed."
    exit 1
}

$npmCheck = Invoke-NativeCommand -FilePath $npmExe -Arguments @("-v") -Capture
if (-not $npmCheck.Success) {
    Write-Fail "Error: could not run npm at $npmExe"
    if ($npmCheck.Error) { Write-Host "  $($npmCheck.Error)" }
    exit 1
}
Write-Host "npm: $(($npmCheck.Output | Select-Object -First 1).Trim())  ($npmExe)"

# ── 3. Check git and pull latest ────────────────────────────────────────────

Set-Location $ScriptDir

$gitExe = Resolve-NativeCommand -Name "git" -Optional
if ($gitExe) {
    $gitCheck = Invoke-NativeCommand -FilePath $gitExe -Arguments @("--version") -Capture
    if ($gitCheck.Success) {
        Write-Host "git: $(($gitCheck.Output | Select-Object -First 1).Trim())"
    } else {
        Write-Warn "Warning: git found but not runnable. 'publisher update' will not work."
        $gitExe = $null
    }
} else {
    Write-Warn "Warning: git not found. 'publisher update' will not work."
}

if ($gitExe -and (Test-Path "$ScriptDir\.git") -and $env:MDTEX_SKIP_PULL -ne "1") {
    Write-Host ""
    Write-Step "Pulling latest changes..."
    # git reports progress on stderr as a matter of course.
    $pull = Invoke-NativeCommand -FilePath $gitExe -Arguments @("pull", "--ff-only") -Capture
    Write-Indented $pull.Output
    if (-not $pull.Success) {
        Write-Warn "Warning: git pull failed (exit code $($pull.ExitCode)). Continuing with the current checkout."
    }
}

Write-Host ""

# ── 4. Install dependencies ────────────────────────────────────────────────

Write-Step "Installing dependencies..."
$npmInstall = Invoke-NativeCommand -FilePath $npmExe `
    -Arguments @("install", "--no-audit", "--no-fund") -Capture

# Deprecation warnings are printed, then ignored. Only the exit code decides.
Show-CommandDiagnostics $npmInstall

if (-not $npmInstall.Success) {
    Write-Fail "Error: npm install failed (exit code $($npmInstall.ExitCode))"
    if ($npmInstall.Error) { Write-Host "  $($npmInstall.Error)" }
    Write-Host ""
    Write-Host "Full output:"
    Write-Indented $npmInstall.Output
    exit 1
}
Write-Host ""

# ── 5. Build UI ─────────────────────────────────────────────────────────────

Write-Step "Building UI..."
# npx has the same .cmd/.ps1 pair as npm.
$npxExe = Resolve-NativeCommand -Name "npx" -Optional
if (-not $npxExe) {
    Write-Fail "Error: npx is not available. Reinstall Node.js."
    exit 1
}

$build = Invoke-NativeCommand -FilePath $npxExe -Arguments @("vite", "build") -Capture
if (-not $build.Success) {
    Write-Indented $build.Output
    Write-Fail "Error: UI build failed (exit code $($build.ExitCode))"
    if ($build.Error) { Write-Host "  $($build.Error)" }
    exit 1
}

$summary = @($build.Output | Where-Object { $_ -match '(built in|modules transformed)' })
if ($summary.Count -gt 0) { Write-Indented $summary } else { Write-Indented (@($build.Output) | Select-Object -Last 3) }
Write-Host ""

# ── 6. Initialize user directories ─────────────────────────────────────────

Write-Step "Initializing user directories..."
$init = Invoke-NativeCommand -FilePath $nodeExe -Arguments @("$ScriptDir\src\cli\index.js", "init")
if (-not $init.Success) {
    Write-Fail "Error: initialization failed (exit code $($init.ExitCode))."
    exit 1
}
Write-Host ""

# ── 7. Install the `publisher` command ─────────────────────────────────────

Write-Step "Setting up the publisher command..."

$BinDir = if ($env:MDTEX_BIN_DIR) { $env:MDTEX_BIN_DIR } else { Join-Path $env:LOCALAPPDATA "Programs\MDTeX\bin" }
New-Item -ItemType Directory -Force -Path $BinDir | Out-Null

# CMD shim - makes `publisher` work in cmd.exe and in PowerShell.
$cmdShim = @"
@echo off
setlocal
"$nodeExe" "$ScriptDir\src\cli\index.js" %*
endlocal
"@
Set-Content -Path (Join-Path $BinDir "$AppName.cmd") -Value $cmdShim -Encoding ASCII

# PowerShell shim - preferred by PowerShell when both exist, and forwards the
# child process exit code so scripting with `publisher` behaves correctly.
#
# The shim relaxes $ErrorActionPreference around the node call for the same
# reason the installer does: `publisher doctor` and `publisher build` write
# diagnostics to stderr, and in a caller's strict session those writes would
# otherwise surface as NativeCommandError instead of as the tool's own output.
$ps1Shim = @"
#!/usr/bin/env pwsh
# MDTeX Studio launcher - generated by install.ps1
`$ErrorActionPreference = 'Continue'
if (Test-Path -Path 'variable:PSNativeCommandUseErrorActionPreference') {
    `$PSNativeCommandUseErrorActionPreference = `$false
}
& "$nodeExe" "$ScriptDir\src\cli\index.js" @args
exit `$LASTEXITCODE
"@
Set-Content -Path (Join-Path $BinDir "$AppName.ps1") -Value $ps1Shim -Encoding UTF8

Write-Host "  Installed: $(Join-Path $BinDir "$AppName.cmd")"
Write-Host "  Installed: $(Join-Path $BinDir "$AppName.ps1")"

# Add the bin directory to the *user* PATH (no admin rights needed), only once.
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ([string]::IsNullOrEmpty($userPath)) { $userPath = "" }

$alreadyOnPath = $userPath.Split(';') | Where-Object { $_.TrimEnd('\') -ieq $BinDir.TrimEnd('\') }

if ($alreadyOnPath) {
    Write-Host "  PATH already contains $BinDir"
} else {
    $newPath = if ($userPath.TrimEnd(';') -eq "") { $BinDir } else { "$($userPath.TrimEnd(';'));$BinDir" }
    [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
    Write-Host "  Added to user PATH: $BinDir"
    Write-Warn "  Open a new terminal for the PATH change to take effect."
}

# Make it usable in *this* session too.
if (-not ($env:Path.Split(';') | Where-Object { $_.TrimEnd('\') -ieq $BinDir.TrimEnd('\') })) {
    $env:Path = "$env:Path;$BinDir"
}

Write-Host ""

# ── 8. LaTeX detection ──────────────────────────────────────────────────────

Write-Step "Checking for LaTeX..."
$latex = Invoke-NativeCommand -FilePath $nodeExe `
    -Arguments @("$ScriptDir\src\cli\index.js", "latex") -Capture
Write-Indented $latex.Output
if (-not $latex.Success -and $latex.Error) { Write-Warn "  ($($latex.Error))" }
Write-Host ""

# ── 9. Self-test ────────────────────────────────────────────────────────────

Write-Step "Running self-test..."
$selftest = Invoke-NativeCommand -FilePath $nodeExe -Arguments @("$ScriptDir\scripts\selftest.js")
if ($selftest.Success) {
    Write-Host ""
    Write-Ok "Self-test passed."
} else {
    Write-Host ""
    Write-Warn "Warning: Some self-tests failed. Run 'publisher doctor' for details."
}

# ── 10. Done ────────────────────────────────────────────────────────────────

Write-Host ""
Write-Ok "Installation complete!"
Write-Host ""
Write-Host "Start MDTeX Studio:"
Write-Host "  publisher start" -ForegroundColor Cyan
Write-Host ""
Write-Host "Other commands (identical on Windows and Linux):"
Write-Host "  publisher init" -ForegroundColor Cyan
Write-Host "  publisher doctor" -ForegroundColor Cyan
Write-Host "  publisher update" -ForegroundColor Cyan
Write-Host "  publisher build <article-dir> --target pdf" -ForegroundColor Cyan
Write-Host "  publisher build <article-dir> --target wechat" -ForegroundColor Cyan
Write-Host "  publisher version" -ForegroundColor Cyan
Write-Host ""
Write-Host "Configuration:  $env:LOCALAPPDATA\publisher\"
Write-Host "Workspace:      $env:LOCALAPPDATA\publisher\workspace\"
Write-Host ""
Write-Host "To update later, run this script again, or: publisher update"
Write-Host ""
