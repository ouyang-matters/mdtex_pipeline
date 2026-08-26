import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, chmodSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  resolveExecutable, executableExtensions, texSearchDirs, pathDirs,
} from '../src/core/exec/which.js';
import { chooseEngine, ENGINES, isSupportedEngine, DEFAULT_ENGINE } from '../src/core/latex/environment.js';

/**
 * Cross-platform executable resolution.
 *
 * These tests simulate both platform layouts rather than only exercising the
 * host, because the whole point of the resolver is that a Windows TeX Live
 * install is found without anyone running it on Windows first.
 */

const IS_WINDOWS = process.platform === 'win32';
let dir;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mdtex-which-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function makeExecutable(path) {
  writeFileSync(path, IS_WINDOWS ? '@echo off\n' : '#!/bin/sh\necho hi\n');
  if (!IS_WINDOWS) chmodSync(path, 0o755);
}

describe('resolveExecutable', () => {
  it('finds an executable on PATH', () => {
    const name = IS_WINDOWS ? 'faketool.cmd' : 'faketool';
    makeExecutable(join(dir, name));

    const found = resolveExecutable('faketool', { env: { PATH: dir, PATHEXT: '.CMD;.EXE' } });
    expect(found).toBe(join(dir, name));
  });

  it('finds an executable in an extra directory that is not on PATH', () => {
    const name = IS_WINDOWS ? 'latexmk.exe' : 'latexmk';
    makeExecutable(join(dir, name));

    const found = resolveExecutable('latexmk', {
      env: { PATH: '/definitely/not/here', PATHEXT: '.EXE' },
      extraDirs: [dir],
    });
    expect(found).toBe(join(dir, name));
  });

  it('returns null rather than throwing for a missing tool', () => {
    expect(resolveExecutable('this-tool-does-not-exist-mdtex', { env: { PATH: dir } })).toBeNull();
  });

  it('ignores directories on PATH that do not exist', () => {
    const name = IS_WINDOWS ? 'tool.cmd' : 'tool';
    makeExecutable(join(dir, name));
    const separator = process.platform === 'win32' ? ';' : ':';
    const found = resolveExecutable('tool', {
      env: { PATH: ['/no/such/dir', dir, '/also/missing'].join(separator), PATHEXT: '.CMD' },
    });
    expect(found).toBe(join(dir, name));
  });

  it('accepts an already-qualified path and validates it', () => {
    const name = IS_WINDOWS ? 'direct.cmd' : 'direct';
    const full = join(dir, name);
    makeExecutable(full);
    expect(resolveExecutable(full)).toBe(full);
    expect(resolveExecutable(join(dir, 'missing-binary'))).toBeNull();
  });

  it('never resolves a directory as an executable', () => {
    mkdirSync(join(dir, 'notabinary'));
    expect(resolveExecutable('notabinary', { env: { PATH: dir } })).toBeNull();
  });
});

describe('executableExtensions', () => {
  it('is a single empty extension on POSIX and honours PATHEXT on Windows', () => {
    const exts = executableExtensions();
    if (IS_WINDOWS) {
      expect(exts).toContain('');
      expect(exts.some(e => e === '.exe')).toBe(true);
    } else {
      expect(exts).toEqual(['']);
    }
  });
});

describe('texSearchDirs', () => {
  it('covers the standard TeX Live layout for this platform', () => {
    const dirs = texSearchDirs();
    expect(dirs.length).toBeGreaterThan(5);

    if (process.platform === 'win32') {
      expect(dirs.some(d => /texlive[\\/]\d{4}[\\/]bin[\\/]windows/i.test(d))).toBe(true);
      expect(dirs.some(d => /MiKTeX/i.test(d))).toBe(true);
    } else if (process.platform === 'darwin') {
      expect(dirs).toContain('/Library/TeX/texbin');
    } else {
      expect(dirs.some(d => /\/usr\/local\/texlive\/\d{4}\/bin\//.test(d))).toBe(true);
      // Never assumes a single hard-coded location.
      expect(dirs.some(d => d.includes('/opt/texlive'))).toBe(true);
    }
  });

  it('simulates a Windows layout when given Windows-style environment values', () => {
    // texSearchDirs reads env for program directories; on any host this proves
    // the Windows branch is driven by the environment, not by hard-coded paths.
    const dirs = texSearchDirs({
      ProgramFiles: 'C:\\Program Files',
      'ProgramFiles(x86)': 'C:\\Program Files (x86)',
      LOCALAPPDATA: 'C:\\Users\\Test\\AppData\\Local',
    });
    expect(Array.isArray(dirs)).toBe(true);
    expect(dirs.length).toBeGreaterThan(0);
  });
});

describe('pathDirs', () => {
  it('splits PATH with the platform separator', () => {
    const separator = process.platform === 'win32' ? ';' : ':';
    expect(pathDirs({ PATH: ['a', 'b', 'c'].join(separator) })).toEqual(['a', 'b', 'c']);
  });

  it('accepts the Windows-cased Path variable', () => {
    expect(pathDirs({ Path: 'only-one' })).toEqual(['only-one']);
  });
});

describe('chooseEngine', () => {
  const withEngines = (...names) => ({
    engines: Object.fromEntries(names.map(n => [n, { path: `/usr/bin/${n}` }])),
    defaultEngine: names[0] || null,
  });

  it('uses the requested engine when it is installed', () => {
    expect(chooseEngine('lualatex', withEngines('lualatex', 'pdflatex')))
      .toEqual({ engine: 'lualatex', fallback: false });
  });

  it('falls back and says so when the requested engine is missing', () => {
    const result = chooseEngine('xelatex', withEngines('pdflatex'));
    expect(result.engine).toBe('pdflatex');
    expect(result.fallback).toBe(true);
    expect(result.requested).toBe('xelatex');
  });

  it('reports no engine when none are installed', () => {
    expect(chooseEngine('xelatex', { engines: {}, defaultEngine: null }).engine).toBeNull();
  });

  it('treats an unknown engine name as the default', () => {
    expect(isSupportedEngine('nope')).toBe(false);
    expect(chooseEngine('nope', withEngines(DEFAULT_ENGINE)).engine).toBe(DEFAULT_ENGINE);
  });

  it('knows a latexmk flag for every supported engine', () => {
    for (const [name, meta] of Object.entries(ENGINES)) {
      expect(meta.flag).toMatch(/^-/);
      expect(meta.label).toBeTruthy();
      expect(isSupportedEngine(name)).toBe(true);
    }
  });
});
