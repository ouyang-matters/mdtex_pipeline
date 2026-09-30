import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { paths, ensureDir, getGitCommitSync } from '../paths.js';
import { runCommand } from '../exec/run.js';
import { resolveExecutable } from '../exec/which.js';

/**
 * Is there a newer MDTeX than the one running?
 *
 * "Newer" means a newer *release*: the highest `vX.Y.Z` tag on the remote,
 * compared with the version in package.json. Commits pushed between releases
 * are work in progress and are not offered. A remote with no release tags at
 * all falls back to comparing the branch head, which is how 0.2.0 and earlier
 * judged it.
 *
 * The question is answered without touching the repository. `git ls-remote`
 * asks the remote what its branch points at and writes nothing locally — no
 * fetch, no ref update, no objects downloaded — so a check that runs on every
 * launch cannot leave the checkout in a state the user did not ask for.
 *
 * The cost of that restraint is precision: without the remote's objects we can
 * see that the commit differs, not how far behind we are or what changed. So
 * this reports "there is a newer commit", never "you are 4 commits behind",
 * because the second would be a number nobody verified.
 *
 * Three failure modes are all treated the same way — not a git checkout, no
 * network, git not installed — because they mean the same thing to the user:
 * we could not find out. A launch is never blocked or slowed by any of them.
 */

const CHECK_TIMEOUT_MS = 6000;

/** Where the last answer is remembered, so a launch does not always hit the network. */
export function defaultStatePath() {
  return join(paths.configDir, 'update-check.json');
}

export function readUpdateState(file = defaultStatePath()) {
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

function writeUpdateState(file, state) {
  try {
    ensureDir(dirname(file));
    writeFileSync(file, JSON.stringify(state, null, 2) + '\n', 'utf-8');
  } catch { /* a cache that cannot be written is not a failure worth reporting */ }
}

/** `1.2.3` → [1, 2, 3], or null for anything that is not a plain release number. */
export function parseVersion(text) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(text ?? '').trim());
  return m ? m.slice(1).map(Number) : null;
}

export function compareVersions(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/** The version this checkout says it is, from its own package.json. */
export function localVersion(appRoot) {
  try {
    return JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf-8')).version || null;
  } catch {
    return null;
  }
}

/**
 * The release tags a remote advertises, highest first: [{ tag, version, sha }].
 * `sha` is the commit — for an annotated tag, ls-remote's peeled `^{}` line.
 */
export function parseReleaseTags(lsRemoteOutput) {
  const byTag = new Map();
  for (const line of String(lsRemoteOutput).split(/\r?\n/)) {
    const [sha, ref] = line.trim().split(/\s+/);
    const m = /^refs\/tags\/(v\d+\.\d+\.\d+)(\^\{\})?$/.exec(ref || '');
    if (!sha || !m) continue;
    const entry = byTag.get(m[1]) || { tag: m[1], version: m[1].slice(1), sha };
    if (m[2]) entry.sha = sha; // the peeled commit wins over the tag object
    byTag.set(m[1], entry);
  }
  return [...byTag.values()].sort((a, b) => compareVersions(b.version, a.version));
}

/** `origin` if the checkout has one, otherwise its first remote. */
async function defaultRemote(git, appRoot) {
  const result = await runCommand(git, ['remote'], { cwd: appRoot, timeout: CHECK_TIMEOUT_MS });
  const names = result.code === 0 ? result.stdout.split(/\s+/).filter(Boolean) : [];
  return names.includes('origin') ? 'origin' : (names[0] || 'origin');
}

/** The branch this checkout is on, or null when it is not on one. */
async function currentBranch(git, appRoot) {
  const result = await runCommand(git, ['rev-parse', '--abbrev-ref', 'HEAD'],
    { cwd: appRoot, timeout: CHECK_TIMEOUT_MS });
  if (result.code !== 0) return null;
  const name = result.stdout.trim();
  return name && name !== 'HEAD' ? name : null;
}

/**
 * Check whether the remote has moved on.
 *
 * @param {object} options
 * @param {number} options.maxAgeMs  reuse a cached answer younger than this
 * @param {boolean} options.force    ignore the cache
 * @returns {Promise<{
 *   checked, available, reason, local, remote, branch, remoteName, at, cached
 * }>}
 *   `checked: false` with a `reason` means we could not find out — never that
 *   the software is up to date.
 */
export async function checkForUpdate({
  appRoot = paths.appRoot,
  statePath = defaultStatePath(),
  maxAgeMs = 24 * 60 * 60 * 1000,
  force = false,
  remoteName: requestedRemote = null,
} = {}) {
  const local = headCommit(appRoot);
  const version = localVersion(appRoot);
  let remoteName = requestedRemote || 'origin';

  if (!force) {
    const cached = readUpdateState(statePath);
    // Only reuse an answer that was about *this* commit: after an update the
    // previous "an update is available" is stale by construction.
    if (cached?.at && cached.local === local && cached.localVersion === version
        && Date.now() - Date.parse(cached.at) < maxAgeMs) {
      return { ...cached, cached: true };
    }
  }

  const fail = (reason) => ({
    checked: false, available: false, reason, local, localVersion: version,
    remote: null, branch: null, remoteName, mode: null, target: null, latestVersion: null,
    at: new Date().toISOString(), cached: false,
  });

  if (!existsSync(join(appRoot, '.git'))) return fail('not-a-checkout');

  const git = resolveExecutable('git');
  if (!git) return fail('git-missing');

  if (!requestedRemote) remoteName = await defaultRemote(git, appRoot);

  const branch = await currentBranch(git, appRoot);
  if (!branch) return fail('detached-head');

  // Only genuine authentication signals mean "refused"; git also says
  // "could not read from remote repository" when the host simply is not
  // there, which is unreachable rather than denied.
  const failure = (result) => {
    if (result.timedOut) return fail('timeout');
    const denied = /permission denied|authentication failed|access denied|\b403\b|publickey/i
      .test(result.stderr);
    return fail(denied ? 'no-access' : 'unreachable');
  };

  const tags = await runCommand(git, ['ls-remote', '--tags', remoteName, 'refs/tags/v*'],
    { cwd: appRoot, timeout: CHECK_TIMEOUT_MS });
  if (tags.timedOut || tags.code !== 0) return failure(tags);

  const releases = parseReleaseTags(tags.stdout);
  let state;

  if (releases.length && parseVersion(version)) {
    const latest = releases[0];
    state = {
      checked: true,
      available: compareVersions(latest.version, version) > 0,
      reason: null,
      mode: 'release',
      local,
      localVersion: version,
      remote: latest.sha,
      target: latest.tag,
      latestVersion: latest.version,
      branch,
      remoteName,
      at: new Date().toISOString(),
    };
  } else {
    const remote = await runCommand(git, ['ls-remote', '--heads', remoteName, branch],
      { cwd: appRoot, timeout: CHECK_TIMEOUT_MS });
    if (remote.timedOut || remote.code !== 0) return failure(remote);

    const remoteSha = remote.stdout.trim().split(/\s+/)[0] || null;
    if (!remoteSha) return fail('no-such-branch');

    state = {
      checked: true,
      available: Boolean(local) && remoteSha !== local,
      reason: null,
      mode: 'branch',
      local,
      localVersion: version,
      remote: remoteSha,
      target: null,
      latestVersion: null,
      branch,
      remoteName,
      at: new Date().toISOString(),
    };
  }
  writeUpdateState(statePath, state);
  return { ...state, cached: false };
}

/** The full local HEAD sha, or null. `getGitCommitSync` gives the short form. */
function headCommit(appRoot) {
  try {
    const head = readFileSync(join(appRoot, '.git', 'HEAD'), 'utf-8').trim();
    if (head.startsWith('ref: ')) {
      return readFileSync(join(appRoot, '.git', head.slice(5)), 'utf-8').trim();
    }
    return head;
  } catch {
    return null;
  }
}

/** Why a check could not answer, in words rather than a code. */
export const REASONS = {
  'not-a-checkout': 'this installation is not a git checkout',
  'git-missing': 'git is not installed',
  'detached-head': 'the checkout is not on a branch',
  unreachable: 'the remote could not be reached',
  'no-access': 'the remote refused access',
  'no-such-branch': 'the branch does not exist on the remote',
  timeout: 'the remote did not answer in time',
};

export function describeReason(reason) {
  return REASONS[reason] || 'the check could not run';
}

export { getGitCommitSync };
