<#
.SYNOPSIS
    Simulated installer run: the reported failure, reproduced and prevented.

.DESCRIPTION
    Replays the shape of install.ps1 -- strict error handling, then a sequence
    of native command steps -- against stub tools that behave the way npm, npx
    and git actually behave: they write warnings and progress to stderr and
    exit 0.

    The first test deliberately reproduces the ORIGINAL failure so the fix is
    demonstrated rather than asserted. The rest run the real helper and require
    the simulated install to complete.

.EXAMPLE
    pwsh -NoProfile -File tests/windows/Install.Simulation.Tests.ps1
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

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$helper = Join-Path $repoRoot ("scripts" + [IO.Path]::DirectorySeparatorChar + "windows" + [IO.Path]::DirectorySeparatorChar + "NativeCommand.ps1")
. $helper

$isWindowsHost = ($PSVersionTable.PSVersion.Major -lt 6) -or $IsWindows

# ── Stub toolchain ───────────────────────────────────────────────────────────

$stubDir = Join-Path ([IO.Path]::GetTempPath()) ("mdtex-install-sim-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $stubDir | Out-Null

function New-Stub {
    param([string]$Name, [string]$CmdBody, [string]$ShBody)
    if ($isWindowsHost) {
        $path = Join-Path $stubDir "$Name.cmd"
        Set-Content -LiteralPath $path -Value $CmdBody -Encoding ASCII
    } else {
        $path = Join-Path $stubDir $Name
        Set-Content -LiteralPath $path -Value $ShBody -Encoding UTF8
        & /bin/chmod +x $path
    }
    return $path
}

# `npm install` as it really behaves: deprecation warnings on stderr, exit 0.
$npmStub = New-Stub -Name "npm-sim" `
    -CmdBody @"
@echo off
if "%~1"=="-v" ( echo 10.9.4 & exit /b 0 )
echo npm warn deprecated whatwg-encoding@3.1.1: Use your platform's native TextDecoder 1>&2
echo npm warn deprecated abab@2.0.6: Use your platform's native atob() 1>&2
echo npm warn deprecated domexception@4.0.0: Use your platform's native DOMException 1>&2
echo.
echo added 37 packages, and audited 512 packages in 3s
exit /b 0
"@ `
    -ShBody @'
#!/bin/sh
if [ "$1" = "-v" ]; then echo "10.9.4"; exit 0; fi
echo "npm warn deprecated whatwg-encoding@3.1.1: Use your platform native TextDecoder" >&2
echo "npm warn deprecated abab@2.0.6: Use your platform native atob()" >&2
echo "npm warn deprecated domexception@4.0.0: Use your platform native DOMException" >&2
echo ""
echo "added 37 packages, and audited 512 packages in 3s"
exit 0
'@

# `npx vite build`: writes its banner to stderr, exit 0.
$npxStub = New-Stub -Name "npx-sim" `
    -CmdBody @"
@echo off
echo vite v8.2.1 building for production... 1>&2
echo 213 modules transformed.
echo built in 236ms
exit /b 0
"@ `
    -ShBody @'
#!/bin/sh
echo "vite v8.2.1 building for production..." >&2
echo "213 modules transformed."
echo "built in 236ms"
exit 0
'@

# `git pull`: progress on stderr, exit 0.
$gitStub = New-Stub -Name "git-sim" `
    -CmdBody @"
@echo off
echo remote: Enumerating objects: 42, done. 1>&2
echo Already up to date.
exit /b 0
"@ `
    -ShBody @'
#!/bin/sh
echo "remote: Enumerating objects: 42, done." >&2
echo "Already up to date."
exit 0
'@

Write-Host ""
Write-Host "Simulated installer run"
Write-Host "PowerShell $($PSVersionTable.PSVersion) on $(if ($isWindowsHost) { 'Windows' } else { $PSVersionTable.Platform })"
Write-Host ""

# ── The original failure, reproduced ─────────────────────────────────────────

Test-Case "the original pattern is still unsafe on Windows PowerShell (documented, not fixed in place)" {
    # `& npm install 2>&1` under 'Stop' is what broke. On Windows PowerShell 5.1
    # this raises NativeCommandError; on PowerShell 7 stderr no longer becomes
    # ErrorRecords, so the throw does not happen there.
    #
    # Either way the point stands: the installer must not depend on which
    # PowerShell the user happens to be running. Assert the *outcome* the
    # installer needs, and record which engine we observed.
    $ErrorActionPreference = 'Stop'
    $threw = $false
    try {
        $null = & $npmStub install 2>&1
    } catch {
        $threw = $true
    }

    if ($isWindowsHost -and $PSVersionTable.PSVersion.Major -lt 6) {
        Assert-True $threw "Windows PowerShell 5.1 was expected to raise NativeCommandError here"
    }
    # No assertion on PS7: the absence of a throw there is exactly why the bug
    # was invisible to anyone testing with pwsh.
    Write-Host ("         (raw invocation threw: " + $threw + ")")
}

# ── The simulated install ────────────────────────────────────────────────────

Test-Case "a full simulated install completes despite stderr warnings" {
    $ErrorActionPreference = 'Stop'

    $steps = @()
    $stepsCompleted = 0

    # Step: git pull (warnings on stderr, exit 0)
    $pull = Invoke-NativeCommand -FilePath $gitStub -Arguments @("pull", "--ff-only") -Capture
    Assert-True $pull.Success "git pull must be treated as successful"
    $steps += "git"
    $stepsCompleted++

    # Step: npm install (deprecation warnings on stderr, exit 0)
    $install = Invoke-NativeCommand -FilePath $npmStub -Arguments @("install", "--no-audit", "--no-fund") -Capture
    Assert-True $install.Success "npm install must be treated as successful"
    $steps += "npm"
    $stepsCompleted++

    # Step: npx vite build (banner on stderr, exit 0)
    $build = Invoke-NativeCommand -FilePath $npxStub -Arguments @("vite", "build") -Capture
    Assert-True $build.Success "the UI build must be treated as successful"
    $steps += "npx"
    $stepsCompleted++

    Assert-True ($stepsCompleted -eq 3) "the installer must reach the end: got $stepsCompleted of 3 steps ($($steps -join ', '))"
}

Test-Case "npm's deprecation warnings survive into the installer's output" {
    $ErrorActionPreference = 'Stop'
    $install = Invoke-NativeCommand -FilePath $npmStub -Arguments @("install") -Capture
    $text = $install.Output -join "`n"

    Assert-True ($text -match 'whatwg-encoding') "the warning the user reported must still be visible"
    Assert-True ($text -match 'abab') "and the rest of them"
    Assert-True ($text -match 'added 37 packages') "alongside npm's own summary"
}

Test-Case "the installer's warning filter surfaces deprecations" {
    # Mirrors Show-CommandDiagnostics in install.ps1.
    $install = Invoke-NativeCommand -FilePath $npmStub -Arguments @("install") -Capture
    $warnings = @($install.Output | Where-Object { $_ -match '(?i)\b(warn|warning|deprecat|vulnerabilit)' })
    Assert-True ($warnings.Count -ge 3) "all three deprecation warnings must be selected for display"
}

Test-Case "a genuinely failing dependency install does stop the installer" {
    $ErrorActionPreference = 'Stop'
    $failing = New-Stub -Name "npm-broken" `
        -CmdBody "@echo off`r`necho npm error code ENOSPC 1>&2`r`nexit /b 217" `
        -ShBody "#!/bin/sh`necho 'npm error code ENOSPC' >&2`nexit 217"

    $install = Invoke-NativeCommand -FilePath $failing -Arguments @("install") -Capture

    Assert-True (-not $install.Success) "a real npm failure must abort the install"
    Assert-True ($install.ExitCode -eq 217) "and report npm's own exit code"
    Assert-True (($install.Output -join "`n") -match 'ENOSPC') "with npm's diagnostics available to print"
}

Test-Case "strict error handling is still in force after every step" {
    $ErrorActionPreference = 'Stop'
    $null = Invoke-NativeCommand -FilePath $npmStub -Arguments @("install") -Capture
    $null = Invoke-NativeCommand -FilePath $npxStub -Arguments @("vite", "build") -Capture

    Assert-True ($ErrorActionPreference -eq 'Stop') "the installer must not have been left with error checking disabled"

    # And a genuine PowerShell error still terminates.
    $stillStrict = $false
    try { Get-Item -LiteralPath (Join-Path $stubDir "definitely-not-here") | Out-Null }
    catch { $stillStrict = $true }
    Assert-True $stillStrict "a real error must still terminate under 'Stop'"
}

Test-Case "install.ps1 itself parses" {
    $installScript = Join-Path $repoRoot "install.ps1"
    $errors = $null
    $null = [System.Management.Automation.Language.Parser]::ParseFile($installScript, [ref]$null, [ref]$errors)
    Assert-True ($null -eq $errors -or $errors.Count -eq 0) `
        ("install.ps1 has parse errors: " + (($errors | ForEach-Object { $_.Message }) -join '; '))
}

Test-Case "install.ps1 resolves npm before running it" {
    $installScript = Get-Content -LiteralPath (Join-Path $repoRoot "install.ps1") -Raw
    Assert-True ($installScript -match 'Resolve-NativeCommand -Name "npm"') "npm must be resolved explicitly"
    Assert-True ($installScript -notmatch '&\s*npm\s') "npm must never be invoked as a bare command"
}

# ── Cleanup ──────────────────────────────────────────────────────────────────

Remove-Item -LiteralPath $stubDir -Recurse -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host ("  " + $script:Passed + " passed, " + $script:Failed + " failed")
Write-Host ""

if ($script:Failed -gt 0) { exit 1 }
exit 0
