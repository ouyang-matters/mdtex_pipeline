<#
.SYNOPSIS
    Safe invocation of native commands from PowerShell.

.DESCRIPTION
    Running a native command from a PowerShell script that uses
    `$ErrorActionPreference = 'Stop'` has two traps, and npm walks into both:

    1. PowerShell's command discovery prefers an ExternalScript over an
       Application, so a bare `& npm install` runs **npm.ps1**, not npm.cmd.
       npm.ps1 invokes node.exe, and in Windows PowerShell 5.1 a native
       command's stderr writes are converted into ErrorRecords. Under
       'Stop' the first one becomes terminating, and a routine deprecation
       warning aborts the install with:

           node.exe : npm warn deprecated whatwg-encoding@3.1.1 ...
           At C:\Program Files\nodejs\npm.ps1:29 char:3
           ... FullyQualifiedErrorId : NativeCommandError

    2. PowerShell 7.3+ can additionally turn a non-zero *exit code* into a
       terminating error when $PSNativeCommandUseErrorActionPreference is on,
       which robs the caller of the chance to report a useful message.

    Neither trap has anything to do with whether the command succeeded. The
    only reliable success signal from a native process is its exit code.

    These helpers therefore:
      - resolve to a .exe/.cmd/.bat, never to a .ps1 wrapper
      - relax both preferences for the duration of the call *only*, in function
        scope, so the caller's strict error handling is untouched
      - report the exit code back and let the caller decide what it means
      - keep stdout and stderr intact so warnings stay visible

.NOTES
    Dot-source this file:  . "$PSScriptRoot\NativeCommand.ps1"
#>

# Windows PowerShell 5.1 has no $IsWindows; it only ever runs on Windows.
$script:MdtexIsWindows = ($PSVersionTable.PSVersion.Major -lt 6) -or $IsWindows

<#
.SYNOPSIS
    The filenames to try when looking for a native command.

.DESCRIPTION
    Mirrors the platform's PATHEXT order so resolution matches what cmd.exe
    would do, with one deliberate exception: .PS1 is never a candidate. That
    exclusion is the whole point — npm, npx, yarn and pnpm all ship both a
    .cmd and a .ps1, and only the .ps1 drags PowerShell's error semantics into
    the child process.

    Exposed separately from Resolve-NativeCommand so the ordering can be
    asserted on any platform.
#>
function Get-NativeCommandCandidateName {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Name,
        [bool]$ForWindows = $script:MdtexIsWindows
    )

    # The comma operator keeps a one-element result an array: PowerShell
    # unwraps @('npm') to the bare string 'npm' on return, and then $result[0]
    # is the character 'n'.
    if (-not $ForWindows) { return ,@($Name) }

    # An explicit extension is honoured as given.
    if ($Name -match '\.[A-Za-z0-9]+$') { return ,@($Name) }

    $pathExt = if ($env:PATHEXT) { $env:PATHEXT -split ';' } else { @('.COM', '.EXE', '.BAT', '.CMD') }

    $extensions = $pathExt |
        Where-Object { $_ } |
        ForEach-Object { $_.Trim().ToLowerInvariant() } |
        Where-Object { $_ -and $_ -ne '.ps1' }

    # Guarantee .cmd is tried even on a machine with an unusual PATHEXT: it is
    # the form npm and npx actually ship.
    foreach ($required in @('.exe', '.cmd', '.bat')) {
        if ($extensions -notcontains $required) { $extensions += $required }
    }

    return ,(@($extensions | ForEach-Object { "$Name$_" }) + @($Name))
}

<#
.SYNOPSIS
    Find a native command on PATH, never resolving to a PowerShell script.

.OUTPUTS
    The full path to the executable, or $null when -Optional was given and
    nothing was found. Throws otherwise.
#>
function Resolve-NativeCommand {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Name,
        [switch]$Optional,
        [bool]$ForWindows = $script:MdtexIsWindows
    )

    foreach ($candidate in (Get-NativeCommandCandidateName -Name $Name -ForWindows $ForWindows)) {
        # -CommandType Application is the second line of defence: it excludes
        # ExternalScript, so a .ps1 cannot be selected even by accident.
        $found = Get-Command -Name $candidate -CommandType Application -ErrorAction SilentlyContinue |
                 Select-Object -First 1
        if ($found) { return $found.Source }
    }

    if ($Optional) { return $null }
    throw "Required command not found on PATH: $Name"
}

<#
.SYNOPSIS
    Run a native command and report its exit code.

.DESCRIPTION
    Never throws because of output. Warnings on stderr are output, not failure.

.PARAMETER FilePath
    Full path to the executable. Paths containing spaces — the usual
    C:\Program Files\nodejs\npm.cmd — are handled: the path is passed as a
    single argument, not through a shell.

.PARAMETER Arguments
    Argument array. Each element is passed as one argv entry, so arguments
    containing spaces survive without manual quoting.

.PARAMETER Capture
    Collect stdout and stderr as strings instead of streaming them to the host.
    Without it, output flows to the console as the command produces it.

.OUTPUTS
    [pscustomobject] with ExitCode, Success, Output and Error.
#>
function Invoke-NativeCommand {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$FilePath,
        [string[]]$Arguments = @(),
        [string]$WorkingDirectory,
        [switch]$Capture
    )

    # Relax both traps for the duration of this call. Assigning to a preference
    # variable inside a function creates a *function-scoped* copy, so the
    # caller's $ErrorActionPreference = 'Stop' is left completely intact — this
    # is not a global disable.
    $previousEap = $ErrorActionPreference
    $hasNativePref = Test-Path -Path 'variable:PSNativeCommandUseErrorActionPreference'
    $previousNativePref = if ($hasNativePref) { $PSNativeCommandUseErrorActionPreference } else { $null }

    $previousLocation = $null
    if ($WorkingDirectory) {
        $previousLocation = (Get-Location).Path
        Set-Location -LiteralPath $WorkingDirectory
    }

    $output = @()
    $exitCode = -1
    $failure = $null

    try {
        $ErrorActionPreference = 'Continue'
        if ($hasNativePref) { $PSNativeCommandUseErrorActionPreference = $false }

        # Reset so a stale value cannot be mistaken for this call's result.
        $global:LASTEXITCODE = 0

        if ($Capture) {
            # 2>&1 folds stderr into the pipeline; ErrorRecords are flattened to
            # plain strings so the caller gets lines, not error objects.
            $output = @(& $FilePath @Arguments 2>&1 | ForEach-Object { [string]$_ })
        } else {
            & $FilePath @Arguments
        }

        $exitCode = $global:LASTEXITCODE
    } catch {
        # A command that could not be launched at all, or a terminating error
        # from a stricter host. Report it; do not let it escape and abort the
        # caller before it can print something useful.
        $failure = $_
        $exitCode = if ($global:LASTEXITCODE) { $global:LASTEXITCODE } else { 1 }
    } finally {
        $ErrorActionPreference = $previousEap
        if ($hasNativePref) { $PSNativeCommandUseErrorActionPreference = $previousNativePref }
        if ($previousLocation) { Set-Location -LiteralPath $previousLocation }
    }

    return [pscustomobject]@{
        FilePath  = $FilePath
        Arguments = $Arguments
        ExitCode  = $exitCode
        Success   = (($null -eq $failure) -and ($exitCode -eq 0))
        Output    = $output
        Error     = if ($failure) { $failure.Exception.Message } else { $null }
    }
}

<#
.SYNOPSIS
    Resolve and run a command in one step.

.DESCRIPTION
    Convenience wrapper. Returns a failed result rather than throwing when the
    command is not installed, so callers can report it in their own words.
#>
function Invoke-ResolvedCommand {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Name,
        [string[]]$Arguments = @(),
        [string]$WorkingDirectory,
        [switch]$Capture
    )

    $path = Resolve-NativeCommand -Name $Name -Optional
    if (-not $path) {
        return [pscustomobject]@{
            FilePath = $Name; Arguments = $Arguments; ExitCode = -1
            Success = $false; Output = @(); Error = "Command not found on PATH: $Name"
        }
    }

    $invokeArgs = @{ FilePath = $path; Arguments = $Arguments }
    if ($WorkingDirectory) { $invokeArgs.WorkingDirectory = $WorkingDirectory }
    if ($Capture) { $invokeArgs.Capture = $true }

    return Invoke-NativeCommand @invokeArgs
}
