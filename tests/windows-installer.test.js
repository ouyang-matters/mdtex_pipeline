import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, mkdtempSync, writeFileSync, rmSync, chmodSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';
import { quoteForCmd, buildCmdShimArgs } from '../src/core/exec/run.js';
import { resolveExecutable } from '../src/core/exec/which.js';

/**
 * Windows installer and native-command handling.
 *
 * The bug this guards against: PowerShell resolves a bare `npm` to **npm.ps1**,
 * not npm.cmd. npm.ps1 runs node.exe inside a PowerShell scope that inherits
 * the installer's `$ErrorActionPreference = 'Stop'`, and Windows PowerShell 5.1
 * converts a native command's stderr writes into ErrorRecords. A routine
 * deprecation warning therefore aborted the install with NativeCommandError,
 * even though npm exited 0.
 *
 * The static checks below run everywhere. The PowerShell suites run wherever a
 * PowerShell is available and are reported as skipped otherwise.
 */

const appRoot = resolve(import.meta.dirname, '..');
const installPs1 = readFileSync(join(appRoot, 'install.ps1'), 'utf-8');
const helperPs1 = readFileSync(join(appRoot, 'scripts', 'windows', 'NativeCommand.ps1'), 'utf-8');

/** Lines of install.ps1 that are actual script, not comments or strings. */
function codeLines(source) {
  return source
    .split('\n')
    .map((line, i) => ({ line, number: i + 1 }))
    .filter(({ line }) => line.trim() && !line.trim().startsWith('#'));
}

function findPowerShell() {
  if (process.env.MDTEX_PWSH && existsSync(process.env.MDTEX_PWSH)) return process.env.MDTEX_PWSH;
  return resolveExecutable('pwsh') || resolveExecutable('powershell');
}

describe('install.ps1 native command invocation', () => {
  it('never invokes npm, npx or git as a bare command', () => {
    // A bare `& npm` is what lets PowerShell pick npm.ps1.
    const offenders = codeLines(installPs1).filter(({ line }) =>
      /(^|[^\w.-])&\s*(npm|npx|git|node)\b/.test(line));

    expect(offenders.map(o => `${o.number}: ${o.line.trim()}`)).toEqual([]);
  });

  it('resolves npm, npx, git and node explicitly before running them', () => {
    for (const tool of ['npm', 'npx', 'git', 'node']) {
      expect(installPs1).toMatch(new RegExp(`Resolve-NativeCommand -Name "${tool}"`));
    }
  });

  it('routes every native call through the helper', () => {
    const invocations = (installPs1.match(/Invoke-NativeCommand|Invoke-ResolvedCommand/g) || []).length;
    expect(invocations).toBeGreaterThanOrEqual(8);
  });

  it('never merges native stderr into the pipeline with 2>&1', () => {
    // 2>&1 on a native command is what turns stderr lines into ErrorRecords,
    // which `Stop` then makes terminating. The helper does this once, in a
    // scope where the preference has been relaxed; the installer must not.
    const offenders = codeLines(installPs1).filter(({ line }) => line.includes('2>&1'));
    expect(offenders.map(o => `${o.number}: ${o.line.trim()}`)).toEqual([]);
  });

  it('never discards native stderr with 2>$null', () => {
    // Hiding stderr would also hide the reason a step failed.
    const offenders = codeLines(installPs1).filter(({ line }) => line.includes('2>$null'));
    expect(offenders.map(o => `${o.number}: ${o.line.trim()}`)).toEqual([]);
  });

  it('keeps strict error handling switched on globally', () => {
    // The fix must not be "turn off error checking".
    expect(installPs1).toMatch(/^\$ErrorActionPreference\s*=\s*"Stop"/m);

    const relaxations = codeLines(installPs1)
      .filter(({ line }) => /\$ErrorActionPreference\s*=\s*['"]?(Continue|SilentlyContinue|Ignore)/.test(line));
    // The only relaxation is inside the generated publisher.ps1 shim, where it
    // is scoped to that shim's own node call.
    expect(relaxations.length).toBeLessThanOrEqual(1);
  });

  it('decides success from the exit code, not from output', () => {
    expect(installPs1).toMatch(/\$npmInstall\.Success/);
    expect(installPs1).toMatch(/ExitCode/);
  });

  it('shows npm warnings rather than swallowing them', () => {
    expect(installPs1).toMatch(/Show-CommandDiagnostics/);
    expect(installPs1).toMatch(/deprecat/i);
  });

  it('fails the install only when a command exits non-zero', () => {
    // Every `exit 1` for a command step must be guarded by a Success check.
    const block = installPs1.slice(
      installPs1.indexOf('# ── 4. Install dependencies'),
      installPs1.indexOf('# ── 5. Build UI'),
    );
    expect(block).toMatch(/if \(-not \$npmInstall\.Success\)/);
    expect(block).toMatch(/exit 1/);
  });

  it('dot-sources the shared helper rather than duplicating it', () => {
    expect(installPs1).toMatch(/NativeCommand\.ps1/);
    expect(existsSync(join(appRoot, 'scripts', 'windows', 'NativeCommand.ps1'))).toBe(true);
  });
});

describe('NativeCommand.ps1 helper', () => {
  it('excludes .ps1 from the candidate extensions', () => {
    expect(helperPs1).toMatch(/-ne '\.ps1'/);
  });

  it('restricts resolution to Applications, so a script can never be picked', () => {
    expect(helperPs1).toMatch(/-CommandType Application/);
  });

  it('relaxes both PowerShell traps in function scope only', () => {
    expect(helperPs1).toMatch(/\$ErrorActionPreference = 'Continue'/);
    expect(helperPs1).toMatch(/PSNativeCommandUseErrorActionPreference = \$false/);
    // …and restores them.
    expect(helperPs1).toMatch(/\$ErrorActionPreference = \$previousEap/);
  });

  it('reads the exit code from the native process', () => {
    expect(helperPs1).toMatch(/\$exitCode = \$global:LASTEXITCODE/);
  });
});

describe('install.sh is unchanged in behaviour', () => {
  const installSh = readFileSync(join(appRoot, 'install.sh'), 'utf-8');

  it('still uses plain POSIX invocations', () => {
    expect(installSh).toMatch(/npm install --no-audit --no-fund/);
    expect(installSh).toMatch(/npx vite build/);
  });

  it('does not reference the Windows helper', () => {
    expect(installSh).not.toMatch(/NativeCommand\.ps1/);
    expect(installSh).not.toMatch(/Invoke-NativeCommand/);
  });

  it('keeps the same user-facing command contract', () => {
    for (const command of ['publisher start', 'publisher doctor', 'publisher update', 'publisher version']) {
      expect(installSh).toContain(command);
    }
  });
});

describe('Windows .cmd/.bat shim spawning', () => {
  // npm installs global binaries as .cmd shims, and CreateProcess cannot run
  // one. Without this, `claude.cmd` never starts on Windows.

  it('leaves ordinary tokens unquoted', () => {
    expect(quoteForCmd('install')).toBe('install');
    expect(quoteForCmd('--no-audit')).toBe('--no-audit');
  });

  it('quotes paths containing spaces', () => {
    expect(quoteForCmd('C:\\Program Files\\nodejs\\npm.cmd'))
      .toBe('"C:\\Program Files\\nodejs\\npm.cmd"');
  });

  it('quotes cmd.exe metacharacters so they cannot be interpreted', () => {
    for (const meta of ['a&b', 'a|b', 'a>b', 'a<b', 'a^b', 'a%b', 'a!b', 'a(b)']) {
      expect(quoteForCmd(meta)).toBe(`"${meta}"`);
    }
  });

  it('escapes embedded double quotes the way cmd.exe expects', () => {
    expect(quoteForCmd('say "hi"')).toBe('"say ""hi"""');
  });

  it('builds a fully quoted /d /s /c command line', () => {
    const args = buildCmdShimArgs('C:\\Program Files\\nodejs\\claude.cmd', ['--print', 'two words']);

    expect(args[0]).toBe('/d');
    expect(args[1]).toBe('/s');
    expect(args[2]).toBe('/c');
    // /s plus an outer-quoted remainder makes cmd strip exactly those quotes.
    expect(args[3]).toBe('""C:\\Program Files\\nodejs\\claude.cmd" --print "two words""');
  });

  it('quotes the program even when it needs no quoting, for a predictable shape', () => {
    // cmd /s strips exactly the outer pair of quotes, so both of these resolve
    // to the intended command line.
    expect(buildCmdShimArgs('C:\\tools\\latexmk.bat', [])[3])
      .toBe('""C:\\tools\\latexmk.bat""');
    expect(buildCmdShimArgs('latexmk.bat', ['-xelatex', 'my file.tex'])[3])
      .toBe('""latexmk.bat" -xelatex "my file.tex""');
  });
});

describe('PowerShell helper suite', () => {
  const shell = findPowerShell();

  it.skipIf(!shell)('passes on this machine', () => {
    const output = execFileSync(shell, [
      '-NoProfile', '-File', join(appRoot, 'tests', 'windows', 'NativeCommand.Tests.ps1'),
    ], { encoding: 'utf-8', cwd: appRoot });

    expect(output).toMatch(/0 failed/);
    expect(output).not.toMatch(/\[FAIL\]/);
  }, 120000);

  it.skipIf(!shell)('simulated installer survives a warning-producing dependency install', () => {
    const output = execFileSync(shell, [
      '-NoProfile', '-File', join(appRoot, 'tests', 'windows', 'Install.Simulation.Tests.ps1'),
    ], { encoding: 'utf-8', cwd: appRoot });

    expect(output).toMatch(/0 failed/);
    expect(output).not.toMatch(/\[FAIL\]/);
  }, 120000);

  it('reports whether a PowerShell was available', () => {
    // Not an assertion about the platform: just makes the skip visible.
    if (!shell) {
      console.warn('[windows-installer] no pwsh/powershell found — PowerShell suites skipped');
    }
    expect(true).toBe(true);
  });
});
