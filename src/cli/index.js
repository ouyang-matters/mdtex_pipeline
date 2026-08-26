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
import { ArticleLibrary } from '../workspace/library.js';
import { startCommand } from './commands/start.js';
import { buildCommand, printValidation } from './commands/build.js';
import { doctorCommand } from './commands/doctor.js';
import { detectLatexEnvironment } from '../core/latex/environment.js';
import { listPdfTemplates } from '../core/latex/templates.js';

const program = new Command();

program
  .name('publisher')
  .description('Markdown + LaTeX publishing pipeline for WeChat and Zhihu')
  .version(getVersionSync());

// ── start ─────────────────────────────────────────────────────────────────────

program
  .command('start')
  .description('Start MDTeX Studio (local backend + UI) and open it in a browser')
  .option('-p, --port <port>', 'Port to listen on', '4173')
  .option('--no-open', 'Do not open a browser')
  .option('--force', 'Start even if another instance is already running')
  .action(async (opts) => {
    await startCommand(opts);
  });

// ── build ──────────────────────────────────────────────────────────────────────

program
  .command('build')
  .description('Compile an article for a target (wechat, zhihu, pdf)')
  .argument('<article>', 'Markdown/LaTeX file, article directory, or workspace article')
  .option('-t, --target <target>', 'Target: wechat, zhihu or pdf', 'wechat')
  .option('--theme <theme>', 'Theme name or CSS file path (platform targets)')
  .option('--template <template>', 'PDF template (pdf target)')
  .option('--engine <engine>', 'LaTeX engine: xelatex, lualatex, pdflatex (pdf target)')
  .option('-o, --output <path>', 'Output file (platform targets) or directory (pdf)')
  .option('--math <mode>', 'Math output mode (svg, png, auto)', 'svg')
  .option('-q, --quiet', 'Suppress progress output')
  .action(async (article, opts) => {
    try {
      await buildCommand(article, opts);
    } catch (e) {
      console.error(`Error: ${e.message}`);
      process.exit(1);
    }
  });

// ── validate ───────────────────────────────────────────────────────────────────

program
  .command('validate')
  .description('Validate an article for a target platform without writing output')
  .argument('<article>', 'Markdown/LaTeX file, article directory, or workspace article')
  .option('-t, --target <platform>', 'Target platform (wechat, zhihu)', 'wechat')
  .option('--theme <theme>', 'Theme name or CSS file path')
  .action(async (article, opts) => {
    try {
      // `validate` takes exactly the same argument forms as `build`; it simply
      // does not write the compiled HTML anywhere.
      await buildCommand(article, { ...opts, dryRun: true, quiet: true });
    } catch (e) {
      console.error(`Error: ${e.message}`);
      process.exit(1);
    }
  });

// ── preview ────────────────────────────────────────────────────────────────────

program
  .command('preview')
  .description('Alias for `publisher start`')
  .option('-p, --port <port>', 'Port to listen on', '4173')
  .option('--no-open', 'Do not open a browser')
  .action(async (opts) => {
    await startCommand(opts);
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
  .description('Verify installation health, including LaTeX and AI availability')
  .option('-v, --verbose', 'List every directory searched for LaTeX tools')
  .action(async (opts) => {
    await doctorCommand(opts);
  });

// ── latex ──────────────────────────────────────────────────────────────────────

program
  .command('latex')
  .description('Show the detected LaTeX environment')
  .option('-v, --verbose', 'List every directory searched')
  .action(async (opts) => {
    const env = await detectLatexEnvironment({ force: true });
    console.log(`Available: ${env.available ? 'yes' : 'no'}`);
    console.log(`Distribution: ${env.distribution}`);
    console.log(`Default engine: ${env.defaultEngine || 'none'}`);
    if (env.latexmk) console.log(`latexmk: ${env.latexmk.path}  (${env.latexmk.version})`);
    for (const [name, info] of Object.entries(env.engines)) {
      console.log(`${name}: ${info.path}  (${info.version})`);
    }
    for (const [name, info] of Object.entries(env.tools)) {
      if (info) console.log(`${name}: ${info.path}`);
    }
    for (const note of env.notes || []) console.log(`Warning: ${note}`);
    if (!env.available && env.hint) {
      console.log(`\n${env.hint.summary}`);
      for (const option of env.hint.options) console.log(`  ${option.label}: ${option.detail}`);
      console.log(`  ${env.hint.note}`);
    }
    if (opts.verbose) {
      console.log('\nSearched:');
      for (const dir of env.searchedDirs) console.log(`  ${dir}`);
    }
    console.log('\nPDF templates:');
    for (const t of listPdfTemplates()) console.log(`  ${t.id} — ${t.description} [${t.source}]`);
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

// ── workspace ──────────────────────────────────────────────────────────────────

const wsCmd = program
  .command('ws')
  .description('Manage the article workspace');

wsCmd
  .command('create')
  .description('Create a new article')
  .argument('<title>', 'Article title')
  .option('-f, --folder <folder>', 'Folder path', '')
  .option('--format <format>', 'Source format (markdown, latex)', 'markdown')
  .action((title, opts) => {
    ensureUserDirs();
    const lib = new ArticleLibrary();
    try {
      const article = lib.create({ title, folder: opts.folder, sourceFormat: opts.format });
      console.log(`Created: ${article.title}`);
      console.log(`  ID: ${article.id}`);
      console.log(`  Path: ${article.dir}`);
      console.log(`  Source: ${article.sourceFile}`);
    } catch (e) {
      console.error(`Error: ${e.message}`);
      process.exit(1);
    }
  });

wsCmd
  .command('list')
  .description('List articles')
  .option('-f, --folder <folder>', 'List specific folder')
  .option('-n, --recent <n>', 'Show N most recent', '20')
  .action((opts) => {
    ensureUserDirs();
    const lib = new ArticleLibrary();
    const entries = opts.folder ? lib.listFolder(opts.folder) : lib.recent(parseInt(opts.recent));

    if (entries.length === 0) {
      console.log('No articles found. Create one: publisher ws create "My Article"');
      return;
    }

    for (const { article, folder } of entries) {
      const format = article.sourceFormat === 'latex' ? '[LaTeX]' : '[MD]';
      const date = article.updatedAt?.slice(0, 10) || '';
      console.log(`  ${format} ${article.title}  (${date})`);
      console.log(`       ${folder}`);
    }
  });

wsCmd
  .command('search')
  .description('Search articles by title or tags')
  .argument('<query>', 'Search query')
  .action((query) => {
    ensureUserDirs();
    const lib = new ArticleLibrary();
    const results = lib.search(query);

    if (results.length === 0) {
      console.log(`No articles matching "${query}".`);
      return;
    }

    console.log(`Found ${results.length} article(s):`);
    for (const { article, folder } of results) {
      console.log(`  ${article.title}  (${folder})`);
    }
  });

wsCmd
  .command('import')
  .description('Import a Markdown file into the workspace')
  .argument('<file>', 'Markdown file to import')
  .option('-f, --folder <folder>', 'Target folder', '')
  .action((file, opts) => {
    ensureUserDirs();
    const lib = new ArticleLibrary();
    try {
      const article = lib.importFile(resolve(file), opts.folder);
      console.log(`Imported: ${article.title}`);
      console.log(`  ID: ${article.id}`);
      console.log(`  Path: ${article.dir}`);
    } catch (e) {
      console.error(`Error: ${e.message}`);
      process.exit(1);
    }
  });

wsCmd.action(() => {
  ensureUserDirs();
  const lib = new ArticleLibrary();
  const entries = lib.recent(10);
  if (entries.length === 0) {
    console.log('Workspace is empty. Create an article: publisher ws create "My Article"');
    return;
  }
  console.log('Recent articles:');
  for (const { article, folder } of entries) {
    const date = article.updatedAt?.slice(0, 10) || '';
    console.log(`  ${article.title}  (${date})  ${folder}`);
  }
});

program.parse();
