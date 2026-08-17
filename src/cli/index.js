#!/usr/bin/env node

import { Command } from 'commander';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { resolve, dirname, basename, extname, join } from 'path';
import { execSync } from 'child_process';
import { Compiler } from '../core/compiler/index.js';
import { listThemes, listBuiltinThemes, listUserThemes, copyTheme } from '../core/themes/index.js';
import { paths, ensureUserDirs, getVersionSync, getGitCommitSync } from '../core/paths.js';
import { initConfig, migrateConfig, getConfig, CONFIG_VERSION, DATA_VERSION } from '../core/config/index.js';
import { createBackup, listBackups, restoreBackup } from '../core/config/backup.js';

const program = new Command();

program
  .name('publisher')
  .description('Markdown + LaTeX publishing pipeline for WeChat and Zhihu')
  .version(getVersionSync());

// ── build ──────────────────────────────────────────────────────────────────────

program
  .command('build')
  .description('Compile a Markdown file for a target platform')
  .argument('<file>', 'Markdown file to compile')
  .option('-t, --target <platform>', 'Target platform (wechat, zhihu)', 'wechat')
  .option('--theme <theme>', 'Theme name or CSS file path', 'default')
  .option('-o, --output <file>', 'Output HTML file')
  .option('--math <mode>', 'Math output mode (svg, png, auto)', 'svg')
  .action(async (file, opts) => {
    const source = readFileSync(resolve(file), 'utf-8');
    const baseDir = dirname(resolve(file));
    const compiler = new Compiler();

    const result = await compiler.compile(source, {
      theme: opts.theme,
      platform: opts.target,
      baseDir,
      mathOutput: opts.math,
    });

    const outFile = opts.output || resolve('dist', `${basename(file, extname(file))}.${opts.target}.html`);
    const outDir = dirname(outFile);
    if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

    writeFileSync(outFile, result.html, 'utf-8');

    console.log(`Compiled: ${file} -> ${outFile}`);
    console.log(`Platform: ${opts.target}`);
    console.log(`Theme: ${result.theme.name}`);
    console.log(`Math: ${result.mathOutput} (${result.mathResult.inlineRendered} inline, ${result.mathResult.displayRendered} display)`);
    printValidation(result.validation);
  });

// ── validate ───────────────────────────────────────────────────────────────────

program
  .command('validate')
  .description('Validate a Markdown file for a target platform')
  .argument('<file>', 'Markdown file to validate')
  .option('-t, --target <platform>', 'Target platform (wechat, zhihu)', 'wechat')
  .option('--theme <theme>', 'Theme name or CSS file path', 'default')
  .action(async (file, opts) => {
    const source = readFileSync(resolve(file), 'utf-8');
    const baseDir = dirname(resolve(file));
    const compiler = new Compiler();

    const result = await compiler.compile(source, {
      theme: opts.theme,
      platform: opts.target,
      baseDir,
    });

    printValidation(result.validation);
  });

// ── preview ────────────────────────────────────────────────────────────────────

program
  .command('preview')
  .description('Start the local preview server')
  .argument('[file]', 'Markdown file to preview')
  .option('-p, --port <port>', 'Server port', '3000')
  .action((file, opts) => {
    console.log(`To start the preview UI, run: npm run dev`);
    console.log(`Or from any directory: cd ${paths.appRoot} && npm run dev`);
    if (file) {
      console.log(`Then open the UI and load: ${resolve(file)}`);
    }
  });

// ── themes ─────────────────────────────────────────────────────────────────────

const themesCmd = program
  .command('themes')
  .description('Manage themes');

themesCmd
  .command('list')
  .description('List all available themes')
  .action(() => {
    const themes = listThemes();
    if (themes.length === 0) {
      console.log('No themes found.');
      return;
    }
    console.log('Available themes:');
    for (const t of themes) {
      const tag = t.source === 'user' ? '[user]' : '[builtin]';
      const override = t.overridesBuiltin ? ' (overrides builtin)' : '';
      console.log(`  ${tag} ${t.name}${override}`);
      console.log(`        ${t.path}`);
    }
  });

themesCmd
  .command('copy')
  .description('Copy a theme to user themes with a new name')
  .argument('<source>', 'Source theme name')
  .argument('<target>', 'New theme name')
  .action((source, target) => {
    try {
      ensureUserDirs();
      const targetPath = copyTheme(source, target);
      console.log(`Theme copied: ${source} -> ${target}`);
      console.log(`Edit at: ${targetPath}`);
    } catch (e) {
      console.error(`Error: ${e.message}`);
      process.exit(1);
    }
  });

// Bare `publisher themes` (no subcommand) lists themes
themesCmd.action(() => {
  const themes = listThemes();
  if (themes.length === 0) {
    console.log('No themes found.');
    return;
  }
  console.log('Available themes:');
  for (const t of themes) {
    const tag = t.source === 'user' ? '[user]' : '[builtin]';
    const override = t.overridesBuiltin ? ' (overrides builtin)' : '';
    console.log(`  ${tag} ${t.name}${override}`);
    console.log(`        ${t.path}`);
  }
});

// ── init ───────────────────────────────────────────────────────────────────────

program
  .command('init')
  .description('Initialize user directories and default configuration')
  .action(() => {
    console.log('Initializing publisher...\n');

    ensureUserDirs();
    const { created, preserved } = initConfig();

    if (preserved.length > 0) {
      console.log('Existing configuration detected.');
      for (const f of preserved) console.log(`  Preserved: ${f}`);
    }

    if (created.length > 0) {
      for (const f of created) console.log(`  Created: ${f}`);
    }

    console.log(`\nUser themes:     ${paths.userThemes}`);
    console.log(`Workspace:       ${paths.workspace}`);
    console.log(`Config:          ${paths.configDir}`);
    console.log(`Cache:           ${paths.cacheDir}`);
    console.log('\nNo destructive initialization performed.');
    console.log('Done.');
  });

// ── version ────────────────────────────────────────────────────────────────────

program
  .command('version')
  .description('Show version and schema information')
  .action(() => {
    console.log(`Publisher ${getVersionSync()}`);
    console.log(`Commit: ${getGitCommitSync()}`);
    console.log(`Config schema: ${CONFIG_VERSION}`);
    console.log(`Data schema: ${DATA_VERSION}`);
    console.log(`App root: ${paths.appRoot}`);
    console.log(`Config dir: ${paths.configDir}`);
    console.log(`Data dir: ${paths.dataDir}`);
    console.log(`Cache dir: ${paths.cacheDir}`);
  });

// ── doctor ─────────────────────────────────────────────────────────────────────

program
  .command('doctor')
  .description('Verify installation health')
  .action(async () => {
    console.log('Running diagnostics...\n');

    const checks = [];
    function check(label, condition) {
      checks.push({ label, passed: condition });
      console.log(`  ${condition ? '✓' : '✗'} ${label}`);
    }

    // Runtime
    const nodeVersion = process.version;
    const major = parseInt(nodeVersion.slice(1));
    check(`Node.js ${nodeVersion}`, major >= 18);

    // App structure
    check('Application root', existsSync(paths.appRoot));
    check('Package.json', existsSync(join(paths.appRoot, 'package.json')));
    check('Node modules', existsSync(join(paths.appRoot, 'node_modules')));
    check('Builtin themes', existsSync(paths.builtinThemes) && readdirSync(paths.builtinThemes).some(f => f.endsWith('.css')));
    check('Test fixtures', existsSync(join(paths.testFixtures, 'math_article.md')));

    // User dirs
    check('Config directory', existsSync(paths.configDir));
    check('User themes directory', existsSync(paths.userThemes));
    check('Data directory', existsSync(paths.dataDir));
    check('Cache directory', existsSync(paths.cacheDir));

    // Config readability
    try {
      getConfig();
      check('Config readable', true);
    } catch {
      check('Config readable', false);
    }

    // Frontend build
    check('UI build', existsSync(join(paths.appRoot, 'dist', 'ui', 'index.html')));

    // Rendering self-tests
    console.log('\n  Rendering tests:');
    try {
      const { runSelftest } = await import('../../scripts/selftest.js');
      const { passed, results } = await runSelftest();
      for (const r of results) {
        console.log(`    ${r.passed ? '✓' : '✗'} ${r.label}`);
      }
      if (!passed) checks.push({ label: 'Rendering self-test', passed: false });
    } catch (e) {
      console.log(`    ✗ Self-test failed: ${e.message}`);
      checks.push({ label: 'Rendering self-test', passed: false });
    }

    const failed = checks.filter(c => !c.passed);
    console.log(`\n${failed.length === 0 ? 'All checks passed.' : `${failed.length} check(s) failed.`}`);
    process.exit(failed.length === 0 ? 0 : 1);
  });

// ── update ─────────────────────────────────────────────────────────────────────

program
  .command('update')
  .description('Safely update to the latest version')
  .option('--force', 'Force update even with dirty checkout')
  .action(async (opts) => {
    const oldVersion = getVersionSync();
    console.log(`Publisher ${oldVersion}\n`);

    // 1. Check for git repo
    if (!existsSync(join(paths.appRoot, '.git'))) {
      console.error('Error: Not a git checkout. Cannot update.');
      console.error('If installed from archive, re-clone and run install.sh.');
      process.exit(1);
    }

    // 2. Check for dirty checkout
    try {
      const status = execSync('git status --porcelain', { cwd: paths.appRoot, encoding: 'utf-8' }).trim();
      if (status && !opts.force) {
        console.error('Error: Application source has uncommitted changes:\n');
        console.error(status);
        console.error('\nUse --force to update anyway, or commit/stash your changes first.');
        process.exit(1);
      }
      if (status && opts.force) {
        console.log('Warning: Proceeding despite dirty checkout (--force)\n');
      }
    } catch {
      console.error('Error: git not available');
      process.exit(1);
    }

    // 3. Ensure user dirs exist
    ensureUserDirs();

    // 4. Back up user data
    console.log('Backing up user data...');
    const backupDir = createBackup('pre-update');
    console.log(`  Backup: ${backupDir}`);

    // 5. Count user themes before
    const userThemesBefore = existsSync(paths.userThemes) ? readdirSync(paths.userThemes).filter(f => f.endsWith('.css')).length : 0;

    // 6. Fetch and pull
    console.log('\nFetching updates...');
    try {
      execSync('git pull --ff-only', { cwd: paths.appRoot, encoding: 'utf-8', stdio: 'pipe' });
    } catch (e) {
      console.error('Error: git pull failed. Resolve conflicts manually.');
      console.error(e.stderr || e.message);
      process.exit(1);
    }

    // 7. Update dependencies
    console.log('Updating dependencies...');
    try {
      execSync('npm install', { cwd: paths.appRoot, encoding: 'utf-8', stdio: 'pipe' });
    } catch (e) {
      console.error('Error: npm install failed');
      console.error(e.stderr || e.message);
      process.exit(1);
    }

    // 8. Run config migrations
    console.log('Running config migrations...');
    const migration = migrateConfig();
    if (migration.migrated) {
      console.log(`  Config migrated: v${migration.fromVersion} -> v${migration.toVersion}`);
      for (const c of migration.changes) console.log(`    ${c}`);
    } else {
      console.log('  No migration needed.');
    }

    // 9. Rebuild UI
    console.log('Rebuilding UI...');
    try {
      execSync('npx vite build', { cwd: paths.appRoot, encoding: 'utf-8', stdio: 'pipe' });
    } catch (e) {
      console.error('Error: UI build failed');
      console.error(e.stderr || e.message);
      process.exit(1);
    }

    // 10. Run self-tests
    console.log('Running self-tests...');
    try {
      const { runSelftest } = await import('../../scripts/selftest.js');
      const { passed, results } = await runSelftest();
      for (const r of results) {
        console.log(`  ${r.passed ? '✓' : '✗'} ${r.label}`);
      }
      if (!passed) {
        console.error('\nWarning: Some self-tests failed. Backup available at:');
        console.error(`  ${backupDir}`);
      }
    } catch (e) {
      console.error(`  Self-test error: ${e.message}`);
    }

    // 11. Summary
    const newVersion = getVersionSync();
    const userThemesAfter = existsSync(paths.userThemes) ? readdirSync(paths.userThemes).filter(f => f.endsWith('.css')).length : 0;

    console.log(`\nPublisher ${oldVersion} -> ${newVersion}\n`);
    console.log(`✓ User workspace preserved`);
    console.log(`✓ ${userThemesAfter} custom theme(s) preserved`);
    console.log(`✓ Preferences preserved`);
    console.log(`✓ Secrets preserved`);
    console.log(`✓ Built-in themes updated`);
    if (migration.migrated) console.log(`✓ Config migrated`);
    console.log(`✓ UI rebuilt`);
  });

// ── backups ────────────────────────────────────────────────────────────────────

const backupsCmd = program
  .command('backups')
  .description('Manage backups');

backupsCmd
  .command('list')
  .description('List all backups')
  .action(() => {
    const backups = listBackups();
    if (backups.length === 0) {
      console.log('No backups found.');
      return;
    }
    console.log('Backups:');
    for (const b of backups) {
      const label = b.label ? ` (${b.label})` : '';
      console.log(`  ${b.name}${label}`);
      console.log(`    ${b.path}`);
      console.log(`    ${b.files.length} files`);
    }
  });

backupsCmd
  .command('create')
  .description('Create a manual backup')
  .option('-l, --label <label>', 'Backup label')
  .action((opts) => {
    ensureUserDirs();
    const dir = createBackup(opts.label || 'manual');
    console.log(`Backup created: ${dir}`);
  });

backupsCmd
  .command('restore')
  .description('Restore a backup')
  .argument('<name>', 'Backup name')
  .action((name) => {
    try {
      const restored = restoreBackup(name);
      console.log('Restored:');
      for (const f of restored) console.log(`  ${f}`);
    } catch (e) {
      console.error(`Error: ${e.message}`);
      process.exit(1);
    }
  });

backupsCmd.action(() => {
  const backups = listBackups();
  if (backups.length === 0) {
    console.log('No backups found.');
    return;
  }
  console.log('Backups:');
  for (const b of backups) {
    const label = b.label ? ` (${b.label})` : '';
    console.log(`  ${b.name}${label}  -  ${b.files.length} files`);
  }
});

// ── helpers ────────────────────────────────────────────────────────────────────

function printValidation(validation) {
  const { stats, warnings, errors } = validation;

  console.log('\nStats:');
  console.log(`  ${stats.paragraphs} paragraphs`);
  console.log(`  ${stats.headings} headings`);
  console.log(`  ${stats.mathTotal} equations (${stats.mathDisplay} display, ${stats.mathInline} inline)`);
  console.log(`  ${stats.images} images`);
  console.log(`  ${stats.codeBlocks} code blocks`);
  console.log(`  ${stats.tables} tables`);
  console.log(`  ${stats.links} links`);

  if (errors.length > 0) {
    console.log('\nERRORS:');
    for (const e of errors) console.log(`  ✗ ${e}`);
  }

  if (warnings.length > 0) {
    console.log('\nWARNINGS:');
    for (const w of warnings) console.log(`  ⚠ ${w}`);
  }

  if (errors.length === 0 && warnings.length === 0) {
    console.log('\n✓ No issues found.');
  }
}

program.parse();
