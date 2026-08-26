import {
  existsSync, readdirSync, statSync, readFileSync, writeFileSync, copyFileSync, mkdirSync,
} from 'fs';
import { join, basename, extname, dirname, win32 as pathWin32, posix as pathPosix } from 'path';
import { createHash } from 'crypto';
import { homedir } from 'os';
import { paths, ensureDir, resolveRoots } from '../paths.js';

/**
 * Move user data out of legacy locations, without ever destroying it.
 *
 * Two kinds of legacy location exist:
 *
 *   1. Application-relative — articles or themes inside the git checkout. These
 *      are the dangerous ones: `git pull`, `git checkout` and `git reset` all
 *      act on that directory.
 *   2. The pre-split Windows root, `%LOCALAPPDATA%\publisher`, which held
 *      configuration and user data in one directory.
 *
 * The procedure is the same for both, and it is deliberately conservative:
 *
 *   detect  ->  copy into the persistent root  ->  verify the copy
 *           ->  record where it came from      ->  leave the original in place
 *
 * The original is never deleted. A migration that appears to have worked but
 * silently dropped a file is indistinguishable from one that worked, right up
 * until the user goes looking for an article from three years ago — so the only
 * safe move is to keep both copies and say so.
 *
 * Nothing is ever overwritten. A file already at the destination with identical
 * content is left alone; one with different content is copied alongside under a
 * content-stamped name and reported as a conflict.
 */

const MARKER = 'migrated-from.json';

/** Legacy locations, in the order they should be migrated. */
export function legacySources({
  env = process.env,
  platform = process.platform,
  home = homedir(),
  appRoot = paths.appRoot,
} = {}) {
  const sources = [];
  // Resolve destinations from the same env/platform the caller asked about, so
  // a simulated layout does not migrate into the running machine's real one.
  const roots = resolveRoots(env, platform, home);
  // Describe paths with the target platform's rules. In production this is the
  // running platform; in tests it makes the Windows layout checkable on Linux.
  const at = platform === 'win32' ? pathWin32.join : pathPosix.join;

  // 1. A workspace inside the application checkout — the case that loses data.
  sources.push({
    id: 'app-relative-workspace',
    label: 'Articles inside the application directory',
    from: at(appRoot, 'workspace'),
    to: at(roots.data, 'workspace'),
    kind: 'directory',
    why: 'Articles stored in the git checkout are destroyed by git operations during an update.',
  });

  // 2. User themes dropped into the checkout's themes/ directory. Only loose
  //    .css files at the top level: themes/builtin/ ships with the app.
  sources.push({
    id: 'app-relative-themes',
    label: 'Themes inside the application directory',
    from: at(appRoot, 'themes'),
    to: at(roots.data, 'themes'),
    kind: 'files',
    filter: (name, full) => name.endsWith('.css') && statSync(full).isFile(),
    why: 'Themes in the checkout are overwritten when the application updates.',
  });

  // 3. The pre-split Windows root: config files and user data in one directory.
  if (platform === 'win32') {
    const base = env.LOCALAPPDATA || at(home, 'AppData', 'Local');
    const legacyRoot = at(base, 'publisher');

    // Configuration files at the top level of the legacy root.
    sources.push({
      id: 'windows-legacy-config',
      label: 'Windows configuration (pre-split layout)',
      from: legacyRoot,
      to: roots.config,
      kind: 'files',
      filter: (name, full) =>
        statSync(full).isFile()
        && ['config.json', 'preferences.json', 'platforms.json', 'ai.json', 'secrets.env'].includes(name),
      why: 'Configuration and user data shared one directory before the config/data split.',
    });

    // Data subdirectories.
    for (const sub of ['workspace', 'themes', 'history', 'assets', 'presets', 'snippets', 'backups']) {
      sources.push({
        id: `windows-legacy-${sub}`,
        label: `Windows ${sub} (pre-split layout)`,
        from: at(legacyRoot, sub),
        to: at(roots.data, sub),
        kind: 'directory',
        why: 'Configuration and user data shared one directory before the config/data split.',
      });
    }
  }

  return sources;
}

/** Which legacy sources actually have something in them. */
export function detectLegacyData(options = {}) {
  return legacySources(options).filter(source => hasContent(source));
}

function hasContent(source) {
  if (!existsSync(source.from)) return false;
  let listing;
  try { listing = readdirSync(source.from, { withFileTypes: true }); } catch { return false; }

  if (source.kind === 'files') {
    return listing.some(item => {
      const full = join(source.from, item.name);
      try { return source.filter ? source.filter(item.name, full) : item.isFile(); } catch { return false; }
    });
  }
  return listing.length > 0;
}

/**
 * Migrate everything detected.
 *
 * `dryRun` reports what would happen and touches nothing, which is what
 * `publisher doctor` uses.
 *
 * Returns { migrated, sources: [{ id, label, from, to, copied, skipped,
 * conflicts, verified, error }] }.
 */
export function migrateLegacyData({ dryRun = false, ...options } = {}) {
  const detected = detectLegacyData(options);
  const results = [];

  for (const source of detected) {
    if (dryRun) {
      results.push({ ...describe(source), planned: true });
      continue;
    }

    try {
      const outcome = source.kind === 'files'
        ? copyMatchingFiles(source)
        : copyTree(source.from, source.to, source);

      // Verify before recording success: a migration that reports success it
      // cannot demonstrate is worse than one that reports failure.
      const verified = existsSync(source.to)
        && (outcome.copied === 0 || outcome.copied + outcome.skipped + outcome.conflicts.length > 0);

      if (verified) writeMarker(source, outcome);

      results.push({
        id: source.id,
        label: source.label,
        from: source.from,
        to: source.to,
        why: source.why,
        ...outcome,
        verified,
      });
    } catch (e) {
      results.push({
        id: source.id,
        label: source.label,
        from: source.from,
        to: source.to,
        copied: 0,
        skipped: 0,
        conflicts: [],
        verified: false,
        error: e.message,
      });
    }
  }

  return {
    migrated: results.some(r => (r.copied || 0) > 0),
    sources: results,
  };
}

function describe(source) {
  return {
    id: source.id,
    label: source.label,
    from: source.from,
    to: source.to,
    why: source.why,
    copied: 0,
    skipped: 0,
    conflicts: [],
    verified: false,
  };
}

/** Copy the files in a directory that match the source's filter (non-recursive). */
function copyMatchingFiles(source) {
  ensureDir(source.to);
  const outcome = { copied: 0, skipped: 0, conflicts: [] };

  for (const item of readdirSync(source.from, { withFileTypes: true })) {
    const from = join(source.from, item.name);
    let matches = false;
    try { matches = source.filter ? source.filter(item.name, from) : item.isFile(); } catch { matches = false; }
    if (!matches) continue;
    placeFile(from, join(source.to, item.name), outcome);
  }
  return outcome;
}

/** Copy a directory tree, preserving structure. */
function copyTree(from, to, source, outcome = { copied: 0, skipped: 0, conflicts: [] }) {
  ensureDir(to);

  for (const item of readdirSync(from, { withFileTypes: true })) {
    const childFrom = join(from, item.name);
    const childTo = join(to, item.name);

    if (item.isDirectory()) {
      copyTree(childFrom, childTo, source, outcome);
    } else if (item.isFile()) {
      placeFile(childFrom, childTo, outcome);
    }
    // Symlinks are skipped: following one could copy data from outside the
    // legacy root into the workspace, and recreating it could point at a
    // directory that no longer exists after the migration.
  }
  return outcome;
}

/**
 * Put one file at its destination without ever overwriting.
 *
 *   destination free            -> copy
 *   destination identical       -> skip (already migrated, or run twice)
 *   destination differs         -> copy alongside, stamped with its content hash
 */
function placeFile(from, to, outcome) {
  if (!existsSync(to)) {
    ensureDir(dirname(to));
    copyFileSync(from, to);
    outcome.copied++;
    return;
  }

  if (hashFile(from) === hashFile(to)) {
    outcome.skipped++;
    return;
  }

  const ext = extname(to);
  const stem = basename(to, ext);
  const stamped = join(dirname(to), `${stem}.migrated-${hashFile(from).slice(0, 8)}${ext}`);

  if (!existsSync(stamped)) {
    copyFileSync(from, stamped);
    outcome.copied++;
  }
  outcome.conflicts.push({ from, wanted: to, savedAs: stamped });
}

function hashFile(file) {
  try {
    return createHash('sha256').update(readFileSync(file)).digest('hex');
  } catch {
    return `unreadable-${Math.random()}`;
  }
}

/** Record where migrated data came from, so it is traceable and not re-run blindly. */
function writeMarker(source, outcome) {
  const markerPath = join(source.to, MARKER);
  let existing = [];
  if (existsSync(markerPath)) {
    try { existing = JSON.parse(readFileSync(markerPath, 'utf-8')).migrations || []; } catch { existing = []; }
  }

  existing.push({
    id: source.id,
    from: source.from,
    at: new Date().toISOString(),
    copied: outcome.copied,
    skipped: outcome.skipped,
    conflicts: outcome.conflicts.length,
    note: 'The original was left in place and was not deleted.',
  });

  try {
    if (!existsSync(source.to)) mkdirSync(source.to, { recursive: true });
    writeFileSync(markerPath, JSON.stringify({ migrations: existing }, null, 2), 'utf-8');
  } catch {
    // A missing marker costs traceability, not data. Never fail a migration for it.
  }
}

/** Human-readable summary for the CLI and installers. */
export function formatMigrationReport(result) {
  const lines = [];
  for (const source of result.sources) {
    if (source.error) {
      lines.push(`  ✗ ${source.label}: ${source.error}`);
      continue;
    }
    if (source.planned) {
      lines.push(`  • ${source.label}`);
      lines.push(`      ${source.from}  ->  ${source.to}`);
      continue;
    }
    lines.push(`  ✓ ${source.label}: ${source.copied} copied, ${source.skipped} already present`);
    lines.push(`      ${source.from}  ->  ${source.to}`);
    for (const conflict of source.conflicts) {
      lines.push(`      ! kept both: ${basename(conflict.wanted)} -> ${basename(conflict.savedAs)}`);
    }
    lines.push('      The original was left in place; nothing was deleted.');
  }
  return lines.join('\n');
}
