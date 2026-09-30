import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  checkForUpdate, parseReleaseTags, compareVersions, parseVersion,
} from '../src/core/update/check.js';
import { performUpdate } from '../src/core/update/apply.js';

/**
 * The rules under test: an installation is offered *releases*, not whatever
 * the branch head happens to be; an update moves it to exactly the release it
 * was offered; and an update that cannot run safely changes nothing.
 */

let root;
const git = (cwd, ...args) =>
  execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function writeVersion(dir, version) {
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'mdtex-pipeline', version }, null, 2) + '\n');
}

/**
 * origin.git with v0.2.0 and v0.3.0 released, and one unreleased commit on
 * main after v0.3.0. Returns a clone sitting at v0.2.0, whose remote is named
 * `remoteName`.
 */
function setup(remoteName = 'origin') {
  const work = join(root, 'work');
  const bare = join(root, 'origin.git');
  git(root, 'init', '-q', '--bare', '-b', 'main', bare);
  git(root, 'init', '-q', '-b', 'main', work);
  git(work, 'config', 'user.email', 'test@example.com');
  git(work, 'config', 'user.name', 'Test');
  git(work, 'remote', 'add', 'origin', bare);

  writeVersion(work, '0.2.0');
  git(work, 'add', '.'); git(work, 'commit', '-qm', 'Release 0.2.0'); git(work, 'tag', 'v0.2.0');
  const v020 = git(work, 'rev-parse', 'HEAD');

  const clone = join(root, 'installed');
  git(root, 'clone', '-q', '-o', remoteName, bare, clone);
  git(work, 'push', '-q', 'origin', 'main', '--tags');
  git(clone, 'fetch', '-q', remoteName);
  git(clone, 'reset', '-q', '--hard', v020);

  writeVersion(work, '0.3.0');
  git(work, 'commit', '-qam', 'Release 0.3.0'); git(work, 'tag', '-a', 'v0.3.0', '-m', 'MDTeX 0.3.0');
  const v030 = git(work, 'rev-parse', 'HEAD');
  writeFileSync(join(work, 'next.txt'), 'work in progress\n');
  git(work, 'add', '.'); git(work, 'commit', '-qm', 'Unreleased work');
  const head = git(work, 'rev-parse', 'HEAD');
  git(work, 'push', '-q', 'origin', 'main', '--tags');

  return { clone, v030, head };
}

// npm and the UI build are the installer's business, not this test's.
const quietRun = () => () => '';

beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'mdtex-release-')); });
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('release versions', () => {
  it('orders release numbers numerically', () => {
    expect(compareVersions('0.10.0', '0.9.9')).toBeGreaterThan(0);
    expect(compareVersions('v1.0.0', '1.0.0')).toBe(0);
    expect(parseVersion('0.3.0-beta')).toBeNull();
  });

  it('reads the commit of an annotated tag from its peeled line', () => {
    const tags = parseReleaseTags('aaa\trefs/tags/v0.3.0\nbbb\trefs/tags/v0.3.0^{}\nccc\trefs/tags/v0.2.0\nddd\trefs/tags/latest');
    expect(tags.map(t => [t.tag, t.sha])).toEqual([['v0.3.0', 'bbb'], ['v0.2.0', 'ccc']]);
  });
});

describe('checkForUpdate against releases', () => {
  it('offers the newest release, not the branch head', async () => {
    const { clone, v030, head } = setup();
    const r = await checkForUpdate({ appRoot: clone, statePath: join(root, 's.json'), force: true });
    expect(r).toMatchObject({ checked: true, available: true, mode: 'release', target: 'v0.3.0', latestVersion: '0.3.0', localVersion: '0.2.0' });
    expect(r.remote).toBe(v030);
    expect(r.remote).not.toBe(head);
  });

  it('finds the remote whatever it is called', async () => {
    const { clone } = setup('github');
    const r = await checkForUpdate({ appRoot: clone, statePath: join(root, 's.json'), force: true });
    expect(r).toMatchObject({ checked: true, available: true, remoteName: 'github' });
  });

  it('is up to date on the newest release, even with newer commits on the branch', async () => {
    const { clone, v030 } = setup();
    git(clone, 'fetch', '-q', '--tags', 'origin');
    git(clone, 'merge', '-q', '--ff-only', v030);
    const r = await checkForUpdate({ appRoot: clone, statePath: join(root, 's.json'), force: true });
    expect(r).toMatchObject({ checked: true, available: false, mode: 'release', localVersion: '0.3.0' });
  });
});

describe('performUpdate', () => {
  it('moves the checkout to exactly the release it was offered', async () => {
    const { clone, v030 } = setup();
    const result = await performUpdate({
      appRoot: clone, target: 'v0.3.0', run: quietRun(clone), selftest: false, log: () => {},
    });
    expect({ ok: result.ok, stage: result.stage, reason: result.reason, detail: result.detail, losses: result.losses })
      .toMatchObject({ ok: true, stage: 'done' });
    expect(result.newVersion).toBe('0.3.0');
    expect(git(clone, 'rev-parse', 'HEAD')).toBe(v030);
    expect(JSON.parse(readFileSync(join(clone, 'package.json'), 'utf-8')).version).toBe('0.3.0');
    expect(result.backupDir).toBeTruthy();
  });

  it('changes nothing in a checkout with local changes', async () => {
    const { clone } = setup();
    writeFileSync(join(clone, 'package.json'), '{"name":"mine","version":"0.2.0"}\n');
    const before = git(clone, 'rev-parse', 'HEAD');
    const result = await performUpdate({
      appRoot: clone, target: 'v0.3.0', run: quietRun(clone), selftest: false, log: () => {},
    });
    expect(result).toMatchObject({ ok: false, stage: 'dirty' });
    expect(git(clone, 'rev-parse', 'HEAD')).toBe(before);
    expect(readFileSync(join(clone, 'package.json'), 'utf-8')).toContain('"mine"');
  });

  it('does not count npm\'s rewrite of the lockfile as a local change', async () => {
    // Every real installation had this: `npm install` pruned a stale tree from
    // the committed package-lock.json, so the checkout always looked modified
    // and every update refused. Here the release also changes the lockfile, so
    // the rewrite has to be put back before git can move it.
    const work = join(root, 'lock-work');
    const bare = join(root, 'lock.git');
    git(root, 'init', '-q', '--bare', '-b', 'main', bare);
    git(root, 'init', '-q', '-b', 'main', work);
    git(work, 'config', 'user.email', 'test@example.com');
    git(work, 'config', 'user.name', 'Test');
    git(work, 'remote', 'add', 'origin', bare);
    writeVersion(work, '0.2.0');
    writeFileSync(join(work, 'package-lock.json'), '{"lockfileVersion":3,"stale":true}\n');
    git(work, 'add', '.'); git(work, 'commit', '-qm', '0.2.0'); git(work, 'tag', 'v0.2.0');
    git(work, 'push', '-q', 'origin', 'main', '--tags');
    const clone = join(root, 'lock-installed');
    git(root, 'clone', '-q', bare, clone);
    writeVersion(work, '0.3.0');
    writeFileSync(join(work, 'package-lock.json'), '{"lockfileVersion":3,"version":"0.3.0"}\n');
    git(work, 'commit', '-qam', '0.3.0'); git(work, 'tag', '-a', 'v0.3.0', '-m', '0.3.0');
    git(work, 'push', '-q', 'origin', 'main', '--tags');

    writeFileSync(join(clone, 'package-lock.json'), '{"lockfileVersion":3}\n'); // what npm install left behind

    const result = await performUpdate({ appRoot: clone, target: 'v0.3.0', run: quietRun(clone), selftest: false, log: () => {} });
    expect({ ok: result.ok, stage: result.stage, detail: result.detail }).toMatchObject({ ok: true, stage: 'done' });
    expect(result.newVersion).toBe('0.3.0');
    expect(readFileSync(join(clone, 'package-lock.json'), 'utf-8')).toContain('"version":"0.3.0"');
  });

  it('still refuses a lockfile change mixed with the user\'s own edits', async () => {
    const { clone } = setup();
    writeFileSync(join(clone, 'mine.js'), 'x\n');
    git(clone, 'add', 'mine.js');
    const result = await performUpdate({ appRoot: clone, target: 'v0.3.0', run: quietRun(clone), selftest: false, log: () => {} });
    expect(result).toMatchObject({ ok: false, stage: 'dirty' });
    expect(result.status).toContain('mine.js');
  });

  it('refuses a target that is not a release tag', async () => {
    const { clone } = setup();
    const result = await performUpdate({
      appRoot: clone, target: 'main; rm -rf /', run: quietRun(clone), selftest: false, log: () => {},
    });
    expect(result).toMatchObject({ ok: false, stage: 'git' });
  });
});
