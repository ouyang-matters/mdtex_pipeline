# MDTeX Pipeline Installer for Windows
# Run from PowerShell:  .\install.ps1
# Safe to run multiple times (idempotent).

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppName = "publisher"
$MinNodeMajor = 18

Write-Host ""
Write-Host "MDTeX Pipeline Installer" -ForegroundColor White
Write-Host "========================" -ForegroundColor White
Write-Host ""

# ── 1. Check Node.js ────────────────────────────────────────────────────────

try {
    $nodeVersion = & node -v 2>$null
} catch {
    Write-Host "Error: Node.js is not installed." -ForegroundColor Red
    Write-Host "Install Node.js >= $MinNodeMajor from https://nodejs.org/"
    exit 1
}

if (-not $nodeVersion) {
    Write-Host "Error: Node.js is not installed." -ForegroundColor Red
    exit 1
}

$nodeMajor = [int]($nodeVersion -replace '^v(\d+).*', '$1')
if ($nodeMajor -lt $MinNodeMajor) {
    Write-Host "Error: Node.js $nodeVersion is too old. Need >= v$MinNodeMajor." -ForegroundColor Red
    exit 1
}
Write-Host "Node.js: $nodeVersion"

# ── 2. Check npm ────────────────────────────────────────────────────────────

try {
    $npmVersion = & npm -v 2>$null
} catch {
    Write-Host "Error: npm is not installed." -ForegroundColor Red
    exit 1
}
Write-Host "npm: $npmVersion"

# ── 3. Check git ────────────────────────────────────────────────────────────

try {
    $gitVersion = & git --version 2>$null
    Write-Host "git: $gitVersion"
} catch {
    Write-Host "Warning: git not found. Update command will not work." -ForegroundColor Yellow
}

Write-Host ""

# ── 4. Install dependencies ────────────────────────────────────────────────

Write-Host "Installing dependencies..." -ForegroundColor White
Set-Location $ScriptDir
& npm install --no-audit --no-fund 2>&1 | Select-Object -Last 3
Write-Host ""

# ── 5. Build UI ─────────────────────────────────────────────────────────────

Write-Host "Building UI..." -ForegroundColor White
& npx vite build 2>&1 | Select-String -Pattern '(built in|✓)' | ForEach-Object { $_.Line }
Write-Host ""

# ── 6. Initialize user directories ─────────────────────────────────────────

Write-Host "Initializing user directories..." -ForegroundColor White
& node src/cli/index.js init
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
Write-Host "  cd $ScriptDir; npm run dev" -ForegroundColor Cyan
Write-Host ""
Write-Host "Or use the CLI:"
Write-Host "  node src/cli/index.js build article.md --target wechat" -ForegroundColor Cyan
Write-Host "  node src/cli/index.js themes list" -ForegroundColor Cyan
Write-Host "  node src/cli/index.js doctor" -ForegroundColor Cyan
Write-Host "  node src/cli/index.js version" -ForegroundColor Cyan
Write-Host ""
