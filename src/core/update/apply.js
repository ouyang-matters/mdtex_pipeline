import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { execSync, execFileSync } from 'child_process';
import { pathToFileURL } from 'url';
import { paths, ensureUserDirs, getVersionSync } from '../paths.js';
import { checkUpdateSafety, inventory, compareInventories } from '../data-model.js';
import { migrateLegacyData, formatMigrationReport } from '../migrate/data.js';
import { migrateConfig } from '../config/index.js';
import { createBackup } from '../config/backup.js';

/**
 * Bring this installation up to date — the one procedure behind both
 * `publisher update` and the automatic update on start.
 *
 * The order is the safety argument, so it is fixed here rather than in each
 * caller: refuse if user data sits where git would overwrite it; refuse a
 * checkout with local changes; take a census and a backup of the user's data;
 * only then move the code; and afterwards prove the census still holds.
 *
 * `target` is a release tag (`v0.3.0`): the checkout fast-forwards to exactly
 * that commit, fetched by name. Without one it fast-forwards to its branch
 * head, which is what 0.2.0 and earlier always did.
 *
 * Nothing here calls process.exit. Every refusal is a returned result with a
 * reason, so an automatic update that cannot run leaves MDTeX starting as it
 * was, and says why.
 *
 * @returns {Promise<{ ok, stage, reason, oldVersion, newVersion, backupDir,
 *   intact, losses, configMigration, selftest }>}
 */
export async function performUpdate({
  appRoot = paths.appRoot,
  target = null,
  remoteName = 'origin',
  force = false,
  log = (line) => console.log(line),
  // npm and npx are batch files on Windows and need a shell; git never goes
  // through one, so no argument is ever reinterpreted (cmd.exe eats `^`).
  run = (cmd) => execSync(cmd, { cwd: appRoot, encoding: 'utf-8', stdio: 'pipe' }),
  git = (...args) => execFileSync('git', args, { cwd: appRoot, encoding: 'utf-8', stdio: 'pipe' }),
  selftest = true,
} = {}) {
  const oldVersion = getVersionSync();
  const refuse = (stage, reason, extra = {}) => ({ ok: false, stage, reason, oldVersion, newVersion: oldVersion, ...extra });

  // 0. User data where an update would destroy it. Checked before git runs:
  //    once a pull has started there is no safe way to find out.
  const safety = checkUpdateSafety();
  if (!safety.safe) {
    return refuse('safety', 'user data is stored where an update would destroy it', { violations: safety.violations });
  }

  // 1. Only a git checkout can be moved forward.
  if (!existsSync(join(appRoot, '.git'))) {
    return refuse('checkout', 'this installation is not a git checkout');
  }

  // 2. Local changes to the application are the user's work; never move under them.
  let status;
  try {
    status = git('status', '--porcelain').trim();
  } catch {
    return refuse('checkout', 'git is not available');
  }
  if (status && !force) {
    return refuse('dirty', 'the application source has uncommitted changes', { status });
  }

  // 3. Make what is missing, move anything in a legacy location out of harm's
  //    way (copies only), and count what the user has.
  ensureUserDirs();
  const migration = migrateLegacyData();
  if (migration.sources.length) {
    log('Migrating data out of legacy locations...');
    log(formatMigrationReport(migration));
  }
  const before = inventory();

  // 4. Back up user data.
  log('Backing up user data...');
  const backupDir = createBackup('pre-update');
  log(`  Backup: ${backupDir}`);
  const userThemesBefore = existsSync(paths.userThemes)
    ? readdirSync(paths.userThemes).filter(f => f.endsWith('.css')).length : 0;

  // 5. Move the code — fast-forward only, so history the user has is never rewritten.
  log(target ? `Fetching ${target}...` : 'Fetching updates...');
  try {
    if (target) {
      if (!/^v\d+\.\d+\.\d+$/.test(target)) throw new Error(`not a release tag: ${target}`);
      git('fetch', '--no-tags', remoteName, `refs/tags/${target}:refs/tags/${target}`);
      // The commit, not the tag: git always makes a merge commit for an
      // annotated tag, which --ff-only then refuses.
      const commit = git('rev-parse', `${target}^{commit}`).trim();
      git('merge', '--ff-only', commit);
    } else {
      git('pull', '--ff-only');
    }
  } catch (e) {
    return refuse('git', 'git could not fast-forward the checkout', { backupDir, detail: e.stderr || e.message });
  }

  // 6. Dependencies, configuration, UI.
  log('Updating dependencies...');
  try {
    run('npm install --no-audit --no-fund');
  } catch (e) {
    return refuse('npm', 'npm install failed', { backupDir, detail: e.stderr || e.message });
  }

  log('Running config migrations...');
  const configMigration = migrateConfig();
  if (configMigration.migrated) {
    log(`  Config migrated: v${configMigration.fromVersion} -> v${configMigration.toVersion}`);
    for (const c of configMigration.changes) log(`    ${c}`);
  }

  log('Rebuilding UI...');
  try {
    run('npx vite build');
  } catch (e) {
    return refuse('build', 'the UI build failed', { backupDir, detail: e.stderr || e.message });
  }

  // 7. Self-tests, from the *new* code.
  let selftestResult = null;
  if (selftest) {
    log('Running self-tests...');
    try {
      const url = pathToFileURL(join(appRoot, 'scripts', 'selftest.js')).href;
      const { runSelftest } = await import(url);
      selftestResult = await runSelftest();
      for (const r of selftestResult.results) log(`  ${r.passed ? '✓' : '✗'} ${r.label}`);
    } catch (e) {
      log(`  Self-test error: ${e.message}`);
    }
  }

  // 8. Prove the user's data survived, rather than asserting it did.
  const after = inventory();
  const comparison = compareInventories(before, after);
  const userThemesAfter = existsSync(paths.userThemes)
    ? readdirSync(paths.userThemes).filter(f => f.endsWith('.css')).length : 0;

  return {
    ok: comparison.intact,
    stage: 'done',
    reason: comparison.intact ? null : 'user data changed during the update',
    oldVersion,
    newVersion: versionOnDisk(appRoot) || oldVersion,
    backupDir,
    intact: comparison.intact,
    losses: comparison.losses,
    after,
    configMigration,
    selftest: selftestResult,
    userThemes: { before: userThemesBefore, after: userThemesAfter },
  };
}

/** The version now on disk — the running process still has the old one in memory. */
function versionOnDisk(appRoot) {
  try {
    return JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf-8')).version || null;
  } catch {
    return null;
  }
}
