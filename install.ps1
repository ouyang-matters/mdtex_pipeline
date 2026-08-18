# MDTeX Pipeline Installer for Windows
# Run from PowerShell:  .\install.ps1
# Safe to run multiple times (idempotent).

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppName = "publisher"
$MinNodeMajor = 18

function ExitIfFailed($message) {
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Error: $message (exit code $LASTEXITCODE)" -ForegroundColor Red
        exit 1
    }
}

Write-Host ""
Write-Host "MDTeX Pipeline Installer" -ForegroundColor White
Write-Host "========================" -ForegroundColor White
Write-Host ""

# ── 1. Check Node.js ────────────────────────────────────────────────────────

$nodeVersion = $null
try { $nodeVersion = & node -v 2>$null } catch {}

if (-not $nodeVersion) {
    Write-Host "Error: Node.js is not installed." -ForegroundColor Red
    Write-Host "Install Node.js >= $MinNodeMajor from https://nodejs.org/"
    exit 1
}

$nodeMajor = [int]($nodeVersion -replace '^v(\d+).*', '$1')
if ($nodeMajor -lt $MinNodeMajor) {
    Write-Host "Error: Node.js $nodeVersion is too old. Need >= v$MinNodeMajor." -ForegroundColor Red
    exit 1
}
Write-Host "Node.js: $nodeVersion"

# ── 2. Check npm ────────────────────────────────────────────────────────────

$npmVersion = $null
try { $npmVersion = & npm -v 2>$null } catch {}

if (-not $npmVersion) {
    Write-Host "Error: npm is not installed." -ForegroundColor Red
    exit 1
}
Write-Host "npm: $npmVersion"

# ── 3. Check git and pull latest ────────────────────────────────────────────

Set-Location $ScriptDir

$hasGit = $false
try {
    $gitVersion = & git --version 2>$null
    Write-Host "git: $gitVersion"
    $hasGit = $true
} catch {
    Write-Host "Warning: git not found. Cannot pull updates." -ForegroundColor Yellow
}

if ($hasGit -and (Test-Path "$ScriptDir\.git")) {
    Write-Host ""
    Write-Host "Pulling latest changes..." -ForegroundColor White
    $pullOutput = & git pull --ff-only 2>&1
    $pullExit = $LASTEXITCODE
    $pullOutput | ForEach-Object { Write-Host "  $_" }
    if ($pullExit -ne 0) {
        Write-Host "Warning: git pull failed. Continuing with current version." -ForegroundColor Yellow
    }
}

Write-Host ""

# ── 4. Install dependencies ────────────────────────────────────────────────

Write-Host "Installing dependencies..." -ForegroundColor White

$npmOutput = & npm install --no-audit --no-fund 2>&1
$npmExit = $LASTEXITCODE

$npmOutput | Where-Object { $_ -is [string] -or $_.ToString() -notmatch '^\s*$' } | Select-Object -Last 3 | ForEach-Object { Write-Host $_.ToString() }

if ($npmExit -ne 0) {
    Write-Host "Error: npm install failed (exit code $npmExit)" -ForegroundColor Red
    exit 1
}
Write-Host ""

# ── 5. Build UI ─────────────────────────────────────────────────────────────

Write-Host "Building UI..." -ForegroundColor White

$buildOutput = & npx vite build 2>&1
$buildExit = $LASTEXITCODE

$buildOutput | ForEach-Object { $_.ToString() } | Select-String -Pattern '(built in|modules transformed)' | ForEach-Object { Write-Host $_.Line }

if ($buildExit -ne 0) {
    Write-Host "Error: UI build failed (exit code $buildExit)" -ForegroundColor Red
    exit 1
}
Write-Host ""

# ── 6. Initialize user directories ─────────────────────────────────────────

Write-Host "Initializing user directories..." -ForegroundColor White
& node src/cli/index.js init
ExitIfFailed "Initialization failed"
Write-Host ""

# ── 7. Run self-test ────────────────────────────────────────────────────────

Write-Host "Running self-test..." -ForegroundColor White
& node "$ScriptDir\scripts\selftest.js"
if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "Self-test passed." -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "Warning: Some self-tests failed. Run 'node src/cli/index.js doctor' for details." -ForegroundColor Yellow
}

# ── 8. Done ─────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "Installation complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Start the UI:"
Write-Host "  npm run dev" -ForegroundColor Cyan
Write-Host ""
Write-Host "CLI usage:"
Write-Host "  node src/cli/index.js build article.md --target wechat" -ForegroundColor Cyan
Write-Host "  node src/cli/index.js doctor" -ForegroundColor Cyan
Write-Host "  node src/cli/index.js version" -ForegroundColor Cyan
Write-Host ""
Write-Host "To update later, run this script again:" -ForegroundColor White
Write-Host "  .\install.ps1" -ForegroundColor Cyan
Write-Host ""
