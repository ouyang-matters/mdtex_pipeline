import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { paths, ensureDir, getGitCommitSync } from '../paths.js';
import { runCommand } from '../exec/run.js';
import { resolveExecutable } from '../exec/which.js';

/**
 * Is there a newer MDTeX than the one running?
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
  remoteName = 'origin',
} = {}) {
  const local = headCommit(appRoot);

  if (!force) {
    const cached = readUpdateState(statePath);
    // Only reuse an answer that was about *this* commit: after an update the
    // previous "an update is available" is stale by construction.
    if (cached?.at && cached.local === local && Date.now() - Date.parse(cached.at) < maxAgeMs) {
      return { ...cached, cached: true };
    }
  }

  const fail = (reason) => ({
    checked: false, available: false, reason, local,
    remote: null, branch: null, remoteName, at: new Date().toISOString(), cached: false,
  });

  if (!existsSync(join(appRoot, '.git'))) return fail('not-a-checkout');

  const git = resolveExecutable('git');
  if (!git) return fail('git-missing');

  const branch = await currentBranch(git, appRoot);
  if (!branch) return fail('detached-head');

  const remote = await runCommand(git, ['ls-remote', '--heads', remoteName, branch],
    { cwd: appRoot, timeout: CHECK_TIMEOUT_MS });

  if (remote.timedOut) return fail('timeout');
  if (remote.code !== 0) {
    // Only genuine authentication signals mean "refused"; git also says
    // "could not read from remote repository" when the host simply is not
    // there, which is unreachable rather than denied.
    const denied = /permission denied|authentication failed|access denied|\b403\b|publickey/i
      .test(remote.stderr);
    return fail(denied ? 'no-access' : 'unreachable');
  }

  const remoteSha = remote.stdout.trim().split(/\s+/)[0] || null;
  if (!remoteSha) return fail('no-such-branch');

  const state = {
    checked: true,
    available: Boolean(local) && remoteSha !== local,
    reason: null,
    local,
    remote: remoteSha,
    branch,
    remoteName,
    at: new Date().toISOString(),
  };
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
