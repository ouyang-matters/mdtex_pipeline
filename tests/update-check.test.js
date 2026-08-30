import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  checkForUpdate, readUpdateState, describeReason, REASONS,
} from '../src/core/update/check.js';
import { box, rows, width, pad, colourEnabled } from '../src/cli/format.js';

/**
 * The rule under test: a check that could not run reports that it could not
 * run. It never reports "up to date", because being offline is not evidence
 * that there is nothing new.
 */

let root;
let statePath;

const git = (cwd, ...args) =>
  execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });

function makeRepo(name) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  writeFileSync(join(dir, 'file.txt'), 'one\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'first');
  return dir;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mdtex-update-'));
  statePath = join(root, 'state.json');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('checkForUpdate', () => {
  it('says it could not check, rather than up to date, outside a checkout', async () => {
    const plain = join(root, 'not-a-repo');
    mkdirSync(plain);

    const result = await checkForUpdate({ appRoot: plain, statePath, force: true });
    expect(result.checked).toBe(false);
    expect(result.available).toBe(false);
    expect(result.reason).toBe('not-a-checkout');
  });

  it('reports an unreachable remote as unreachable', async () => {
    const repo = makeRepo('offline');
    git(repo, 'remote', 'add', 'origin', join(root, 'does-not-exist.git'));

    const result = await checkForUpdate({ appRoot: repo, statePath, force: true });
    expect(result.checked).toBe(false);
    expect(result.reason).toBe('unreachable');
    expect(describeReason(result.reason)).toMatch(/could not be reached/);
  });

  it('finds nothing new when the remote is at the same commit', async () => {
    const origin = makeRepo('origin-same');
    const clone = join(root, 'clone-same');
    git(root, 'clone', '-q', origin, clone);

    const result = await checkForUpdate({ appRoot: clone, statePath, force: true });
    expect(result.checked).toBe(true);
    expect(result.available).toBe(false);
    expect(result.branch).toBe('main');
    expect(result.local).toBe(result.remote);
  });

  it('finds an update when the remote has moved on', async () => {
    const origin = makeRepo('origin-ahead');
    const clone = join(root, 'clone-behind');
    git(root, 'clone', '-q', origin, clone);

    writeFileSync(join(origin, 'file.txt'), 'two\n');
    git(origin, 'commit', '-qam', 'second');

    const result = await checkForUpdate({ appRoot: clone, statePath, force: true });
    expect(result.checked).toBe(true);
    expect(result.available).toBe(true);
    expect(result.remote).not.toBe(result.local);
  });

  it('never fetches: the clone learns nothing about the new commit', async () => {
    const origin = makeRepo('origin-untouched');
    const clone = join(root, 'clone-untouched');
    git(root, 'clone', '-q', origin, clone);

    writeFileSync(join(origin, 'file.txt'), 'two\n');
    git(origin, 'commit', '-qam', 'second');
    const newSha = git(origin, 'rev-parse', 'HEAD').trim();

    await checkForUpdate({ appRoot: clone, statePath, force: true });

    // The object would exist locally if anything had fetched it.
    let present = true;
    try {
      git(clone, 'cat-file', '-e', `${newSha}^{commit}`);
    } catch {
      present = false;
    }
    expect(present).toBe(false);
  });

  it('reuses a cached answer about the same commit', async () => {
    const origin = makeRepo('origin-cache');
    const clone = join(root, 'clone-cache');
    git(root, 'clone', '-q', origin, clone);

    const first = await checkForUpdate({ appRoot: clone, statePath, force: true });
    expect(first.cached).toBe(false);

    const second = await checkForUpdate({ appRoot: clone, statePath });
    expect(second.cached).toBe(true);
    expect(second.local).toBe(first.local);
  });

  it('ignores a cached answer once the local commit has changed', async () => {
    const origin = makeRepo('origin-moved');
    const clone = join(root, 'clone-moved');
    git(root, 'clone', '-q', origin, clone);

    await checkForUpdate({ appRoot: clone, statePath, force: true });

    // Simulate having updated: HEAD is now something the cache never saw.
    writeFileSync(join(clone, 'file.txt'), 'local change\n');
    git(clone, 'commit', '-qam', 'local');

    const after = await checkForUpdate({ appRoot: clone, statePath });
    expect(after.cached).toBe(false);
  });

  it('does not treat an expired cache as an answer', async () => {
    const origin = makeRepo('origin-expiry');
    const clone = join(root, 'clone-expiry');
    git(root, 'clone', '-q', origin, clone);

    await checkForUpdate({ appRoot: clone, statePath, force: true });
    const stored = JSON.parse(readFileSync(statePath, 'utf-8'));
    stored.at = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    writeFileSync(statePath, JSON.stringify(stored));

    const after = await checkForUpdate({ appRoot: clone, statePath, maxAgeMs: 60_000 });
    expect(after.cached).toBe(false);
  });

  it('writes its cache only where it was told to', async () => {
    const origin = makeRepo('origin-state');
    const clone = join(root, 'clone-state');
    git(root, 'clone', '-q', origin, clone);

    await checkForUpdate({ appRoot: clone, statePath, force: true });

    expect(existsSync(statePath)).toBe(true);
    expect(readUpdateState(statePath)?.checked).toBe(true);
  });

  it('has words for every reason it can return', () => {
    for (const reason of Object.keys(REASONS)) {
      expect(describeReason(reason)).toBeTruthy();
      expect(describeReason(reason)).not.toBe(reason);
    }
    expect(describeReason('something-new')).toBeTruthy();
  });
});

describe('terminal formatting', () => {
  it('measures CJK as two columns, so a framed box is not ragged', () => {
    expect(width('abc')).toBe(3);
    expect(width('中文')).toBe(4);
    expect(width('中文 abc')).toBe(8);
  });

  it('ignores colour codes when measuring', () => {
    expect(width('\x1b[31mred\x1b[0m')).toBe(3);
  });

  it('draws a frame whose right edge lines up whatever is inside it', () => {
    const lines = box(['short', '中文比較寬', 'a much longer line here']).split('\n');
    const widths = new Set(lines.map(width));
    expect(widths.size).toBe(1);
  });

  it('aligns a two-column list on the label width', () => {
    const out = rows([['Workspace', '/a'], ['Config', '/b']]).split('\n');
    expect(out[0].indexOf('/a')).toBe(out[1].indexOf('/b'));
  });

  it('emits no escape sequences when the output is not a terminal', () => {
    // vitest captures stdout, so this is the piped case by construction — the
    // one that ends up in a log file or a bug report.
    expect(colourEnabled).toBe(false);
    expect(box(['plain'])).not.toContain('\x1b[');
    expect(pad('x', 4)).toBe('x   ');
  });
});
