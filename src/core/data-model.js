import { join } from 'path';
import { existsSync, statSync, readdirSync } from 'fs';
import { paths, isInside } from './paths.js';

/**
 * The authoritative classification of every location MDTeX touches.
 *
 * One invariant governs this file:
 *
 *   Updating MDTeX changes the application, not the user's workspace.
 *
 * Everything else follows from knowing, for any given path, which of five
 * categories it belongs to. The updater asks this module what it is allowed to
 * replace; `publisher doctor` asks it what to report; the tests assert the
 * categories never overlap.
 */

export const Kind = {
  /** The git checkout. An update replaces it wholesale. */
  APPLICATION: 'application',
  /** Themes and templates shipped with the app. An update replaces them. */
  BUILTIN: 'builtin',
  /** User configuration and secrets. Merged on update, never replaced. */
  CONFIG: 'config',
  /** Articles, assets, user themes. Never touched by an update. */
  PERSISTENT: 'persistent',
  /** Derived from persistent data. Safe to delete; regenerated on demand. */
  CACHE: 'cache',
};

/** The categories an update is permitted to replace. */
export const REPLACEABLE_KINDS = [Kind.APPLICATION, Kind.BUILTIN];

/** The categories an update must never replace or delete. */
export const PROTECTED_KINDS = [Kind.CONFIG, Kind.PERSISTENT];

/**
 * Every location, in most-specific-first order.
 *
 * Order matters: `classifyPath` returns the first entry that contains the path,
 * so `themes/builtin` must precede the application root that contains it.
 */
export function dataModel() {
  return [
    // ── Built-in resources: inside the checkout, replaced with it ────────────
    {
      id: 'builtin-themes',
      label: 'Built-in themes',
      path: paths.builtinThemes,
      kind: Kind.BUILTIN,
      regenerable: true,
      description: 'Shipped themes. Replaced on update; user themes of the same name win.',
    },

    // ── Application code ────────────────────────────────────────────────────
    {
      id: 'app-root',
      label: 'Application',
      path: paths.appRoot,
      kind: Kind.APPLICATION,
      regenerable: true,
      description: 'Source, dependencies and the built UI bundle. Replaced on update.',
    },

    // ── Persistent user data ────────────────────────────────────────────────
    {
      id: 'workspace',
      label: 'Article workspace',
      path: paths.workspace,
      kind: Kind.PERSISTENT,
      regenerable: false,
      description: 'Articles, folders, metadata, sources, assets, LaTeX projects.',
    },
    {
      id: 'user-themes',
      label: 'User themes',
      path: paths.userThemes,
      kind: Kind.PERSISTENT,
      regenerable: false,
      description: 'Custom and customised CSS themes.',
    },
    {
      id: 'snippets',
      label: 'User snippets',
      path: paths.snippets,
      kind: Kind.PERSISTENT,
      regenerable: false,
      description: 'User-created snippets and templates.',
    },
    {
      id: 'presets',
      label: 'Presets',
      path: paths.presets,
      kind: Kind.PERSISTENT,
      regenerable: false,
      description: 'Saved compilation presets.',
    },
    {
      id: 'history',
      label: 'Publication history',
      path: paths.history,
      kind: Kind.PERSISTENT,
      regenerable: false,
      description: 'Export and publication history.',
    },
    {
      id: 'assets',
      label: 'Shared assets',
      path: paths.assets,
      kind: Kind.PERSISTENT,
      regenerable: false,
      description: 'Assets not owned by a single article.',
    },
    {
      id: 'backups',
      label: 'Backups',
      path: paths.backups,
      kind: Kind.PERSISTENT,
      regenerable: false,
      description: 'Pre-update and manual backups.',
    },

    // ── User configuration ──────────────────────────────────────────────────
    {
      id: 'config',
      label: 'Configuration',
      path: paths.configDir,
      kind: Kind.CONFIG,
      regenerable: false,
      description: 'Preferences, platform settings, AI profiles, secrets. Merged, never replaced.',
    },

    // ── Cache ───────────────────────────────────────────────────────────────
    {
      id: 'cache',
      label: 'Cache',
      path: paths.cacheDir,
      kind: Kind.CACHE,
      regenerable: true,
      description: 'Rendered output, processed images, PDF scratch. Safe to delete.',
    },
  ];
}

/** The entry governing a path, or null when it is outside everything we manage. */
export function classifyPath(target) {
  if (!target) return null;
  for (const entry of dataModel()) {
    if (isInside(entry.path, target)) return entry;
  }
  return null;
}

/** Whether an update is allowed to replace this path. */
export function isReplaceableByUpdate(target) {
  const entry = classifyPath(target);
  return Boolean(entry) && REPLACEABLE_KINDS.includes(entry.kind);
}

/** Whether this path holds user data that an update must preserve. */
export function isProtected(target) {
  const entry = classifyPath(target);
  return Boolean(entry) && PROTECTED_KINDS.includes(entry.kind);
}

export const protectedEntries = () => dataModel().filter(e => PROTECTED_KINDS.includes(e.kind));
export const regenerableEntries = () => dataModel().filter(e => e.regenerable);

/**
 * Check that no protected location sits inside a location an update replaces.
 *
 * This is the guard that makes the invariant enforceable rather than merely
 * intended. If a future change — or a user pointing the workspace at the
 * checkout — puts articles under `appRoot`, every updater refuses to run
 * instead of letting `git` decide what happens to them.
 *
 * Returns { safe, violations: [{ entry, container, reason }] }.
 */
export function checkUpdateSafety({ workspaceRoot = null } = {}) {
  const violations = [];
  const replaceable = dataModel().filter(e => REPLACEABLE_KINDS.includes(e.kind));

  const candidates = protectedEntries();
  if (workspaceRoot) {
    candidates.push({
      id: 'workspace-override',
      label: 'Article workspace (configured)',
      path: workspaceRoot,
      kind: Kind.PERSISTENT,
    });
  }

  for (const entry of candidates) {
    for (const container of replaceable) {
      if (isInside(container.path, entry.path)) {
        violations.push({
          entry,
          container,
          reason: `${entry.label} is inside ${container.label}, which an update replaces.`,
        });
      }
    }
  }

  return { safe: violations.length === 0, violations };
}

/**
 * A census of the user's data, for comparing before and after an update.
 *
 * Counts and total bytes rather than hashes: the point is to prove nothing
 * disappeared, cheaply enough to run on every update regardless of how many
 * years of articles are in there.
 */
export function inventory() {
  const entries = {};
  for (const entry of protectedEntries()) {
    entries[entry.id] = measure(entry.path);
  }
  return { at: new Date().toISOString(), entries };
}

function measure(dir) {
  if (!existsSync(dir)) return { exists: false, files: 0, bytes: 0 };

  let files = 0;
  let bytes = 0;
  const walk = (current) => {
    let listing;
    try { listing = readdirSync(current, { withFileTypes: true }); } catch { return; }
    for (const item of listing) {
      const full = join(current, item.name);
      if (item.isDirectory()) {
        walk(full);
      } else if (item.isFile()) {
        files++;
        try { bytes += statSync(full).size; } catch { /* raced with a write */ }
      }
    }
  };
  walk(dir);
  return { exists: true, files, bytes };
}

/**
 * Compare two inventories.
 *
 * Anything that lost files or bytes is a regression — an update should only
 * ever leave user data equal or larger.
 */
export function compareInventories(before, after) {
  const losses = [];
  for (const [id, prev] of Object.entries(before.entries || {})) {
    const next = after.entries?.[id];
    if (!next) {
      losses.push({ id, reason: 'no longer reported' });
      continue;
    }
    if (prev.exists && !next.exists) {
      losses.push({ id, reason: 'directory disappeared' });
      continue;
    }
    if (next.files < prev.files) {
      losses.push({ id, reason: `${prev.files - next.files} file(s) lost`, before: prev, after: next });
    } else if (next.bytes < prev.bytes) {
      losses.push({ id, reason: `${prev.bytes - next.bytes} byte(s) lost`, before: prev, after: next });
    }
  }
  return { intact: losses.length === 0, losses };
}
