#!/usr/bin/env node
/**
 * Prove that updating the application cannot touch the user's workspace.
 *
 * The test is deliberately hostile: it performs the update as the *worst*
 * plausible implementation — delete the entire installation directory and
 * replace it from scratch, which is precisely what an updater must never do,
 * and precisely what would destroy a workspace stored in the wrong place.
 *
 * Then it checks, byte for byte, that every category of user data is still
 * there: articles, nested folders, metadata, Markdown and LaTeX sources,
 * images, bibliographies, .sty/.cls files, custom themes, snippets, presets,
 * history, tags and series, AI profiles, preferences, publication settings,
 * blog-pipeline configuration, workspace state and secrets.
 *
 * Run: node scripts/update-safety-check.js
 */

import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, cpSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { tmpdir } from 'os';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

let failures = 0;
function check(label, passed, detail = '') {
  const mark = passed ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
  console.log(`  ${mark} ${label}${detail ? `  \x1b[90m${detail}\x1b[0m` : ''}`);
  if (!passed) failures++;
}
function section(title) { console.log(`\n${title}`); }

/** Hash every file under a directory, keyed by relative path. */
function fingerprint(dir) {
  const out = new Map();
  if (!existsSync(dir)) return out;
  const walk = (current) => {
    for (const item of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, item.name);
      if (item.isDirectory()) walk(full);
      else if (item.isFile()) {
        out.set(relative(dir, full), createHash('sha256').update(readFileSync(full)).digest('hex'));
      }
    }
  };
  walk(dir);
  return out;
}

function diff(before, after) {
  const missing = [];
  const changed = [];
  for (const [path, hash] of before) {
    if (!after.has(path)) missing.push(path);
    else if (after.get(path) !== hash) changed.push(path);
  }
  return { missing, changed };
}

const sandbox = mkdtempSync(join(tmpdir(), 'mdtex-update-safety-'));
const configHome = join(sandbox, 'config');
const dataHome = join(sandbox, 'data');
const cacheHome = join(sandbox, 'cache');
const installation = join(sandbox, 'installation');

process.env.MDTEX_CONFIG_HOME = configHome;
process.env.MDTEX_DATA_HOME = dataHome;
process.env.MDTEX_CACHE_HOME = cacheHome;

console.log('Update safety check');
console.log(`  installation : ${installation}`);
console.log(`  config       : ${configHome}`);
console.log(`  data         : ${dataHome}`);

try {
  // ── 1. A user with years of accumulated work ──────────────────────────────
  section('Given a populated installation');

  const { ensureUserDirs, paths } = await import('../src/core/paths.js');
  const { initConfig } = await import('../src/core/config/index.js');
  const { ArticleLibrary } = await import('../src/workspace/library.js');

  ensureUserDirs();
  initConfig();

  const library = new ArticleLibrary(paths.workspace);

  // A Markdown article with an image, in a nested Unicode folder.
  const article = library.create({ title: '一致可积性', folder: 'notes/probability' });
  article.writeSource('# 一致可积性\n\n![figure](assets/figure-01.png)\n\n$$\\int_0^1 x^2\\,dx$$\n');
  article.writeAsset('figure-01.png', Buffer.from('PNGDATA-not-a-real-png'));
  article.applyMetadata({ tags: ['probability', 'measure theory'], series: 'Inference Notes' });

  // A native LaTeX project with its own .sty and .bib.
  const paper = library.create({ title: 'A LaTeX Paper', folder: 'papers' });
  paper.writeSource('\\documentclass{article}\n\\usepackage{mystyle}\n\\begin{document}\\cite{knuth}\\end{document}\n');
  writeFileSync(join(paper.dir, 'mystyle.sty'), '\\ProvidesPackage{mystyle}\n');
  writeFileSync(join(paper.dir, 'refs.bib'), '@book{knuth, title={The TeXbook}}\n');

  // A generated build directory: regenerable, and inside persistent data.
  mkdirSync(join(paper.dir, 'dist', 'pdf'), { recursive: true });
  writeFileSync(join(paper.dir, 'dist', 'pdf', 'paper.pdf'), '%PDF-1.5 generated');

  // Everything else the user accumulates.
  writeFileSync(join(paths.userThemes, 'my-theme.css'), '#nice { color: rebeccapurple; }');
  writeFileSync(join(paths.userThemes, 'default.css'), '/* my customised built-in */');
  writeFileSync(join(paths.snippets, 'theorem.md'), '> **Theorem.** ');
  writeFileSync(join(paths.presets, 'wechat-dark.json'), '{"theme":"my-theme"}');
  writeFileSync(join(paths.history, 'published.jsonl'), '{"id":"a","at":"2024-01-01"}\n');
  writeFileSync(paths.secretsFile, 'ANTHROPIC_API_KEY=sk-ant-must-survive\n');
  writeFileSync(paths.aiProfilesFile, JSON.stringify({
    active: 'claw',
    profiles: [{ id: 'claw', kind: 'remote-claudeclaw', url: 'https://claw.example', model: 'claude-opus-5' }],
  }, null, 2));
  writeFileSync(paths.platformsFile, JSON.stringify({
    config_version: 1,
    wechat: { enabled: true, appId: 'wx-user-value' },
    blogPipeline: { enabled: true, cliPath: '/opt/blogpipe/bin/blogpipe', repo: '~/blog' },
  }, null, 2));
  writeFileSync(paths.preferencesFile, JSON.stringify({
    config_version: 1, editor_font_size: 17, dark_editor: false, my_unknown_key: 'keep me',
  }, null, 2));

  const articleCount = library.listAll().length;
  check('Articles created', articleCount === 2, `${articleCount} article(s)`);
  check('Nested folders created', existsSync(join(paths.workspace, 'notes', 'probability')));
  check('LaTeX project files present',
    existsSync(join(paper.dir, 'mystyle.sty')) && existsSync(join(paper.dir, 'refs.bib')));

  // Application installation, as if installed from git.
  cpSync(repoRoot, installation, {
    recursive: true,
    filter: src => !src.includes('node_modules') && !src.includes(`${'.'}git${'/'}`),
  });
  check('Application installed separately from user data',
    existsSync(join(installation, 'src')) && !existsSync(join(installation, 'workspace')));

  // ── 2. Fingerprint everything the user owns ───────────────────────────────
  const before = {
    workspace: fingerprint(paths.workspace),
    themes: fingerprint(paths.userThemes),
    snippets: fingerprint(paths.snippets),
    presets: fingerprint(paths.presets),
    history: fingerprint(paths.history),
    config: fingerprint(configHome),
  };
  const totalFiles = Object.values(before).reduce((n, m) => n + m.size, 0);

  // ── 3. The most destructive update imaginable ─────────────────────────────
  section('When the application is replaced by delete-and-reinstall');

  rmSync(installation, { recursive: true, force: true });
  check('Installation directory deleted entirely', !existsSync(installation));

  cpSync(repoRoot, installation, {
    recursive: true,
    filter: src => !src.includes('node_modules') && !src.includes(`${'.'}git${'/'}`),
  });
  check('Application reinstalled from scratch', existsSync(join(installation, 'src', 'cli', 'index.js')));

  // ── 4. Nothing of the user's may have moved ───────────────────────────────
  section('Then every category of user data survives unchanged');

  const after = {
    workspace: fingerprint(paths.workspace),
    themes: fingerprint(paths.userThemes),
    snippets: fingerprint(paths.snippets),
    presets: fingerprint(paths.presets),
    history: fingerprint(paths.history),
    config: fingerprint(configHome),
  };

  for (const [name, prev] of Object.entries(before)) {
    const { missing, changed } = diff(prev, after[name]);
    check(
      `${name} unchanged`,
      missing.length === 0 && changed.length === 0,
      `${prev.size} file(s)` + (missing.length ? `, MISSING ${missing.join(', ')}` : '')
        + (changed.length ? `, CHANGED ${changed.join(', ')}` : ''),
    );
  }
  check('Total user files preserved', totalFiles > 0, `${totalFiles} file(s) fingerprinted`);

  // ── 5. The reinstalled application still reads it all ─────────────────────
  section('And the reinstalled application reads it correctly');

  const freshPaths = await import(join(installation, 'src', 'core', 'paths.js'));
  const freshLibrary = new (await import(join(installation, 'src', 'workspace', 'library.js'))).ArticleLibrary(
    freshPaths.paths.workspace,
  );
  const reloaded = freshLibrary.listAll();
  check('Articles still listed', reloaded.length === 2, `${reloaded.length} article(s)`);

  const reloadedArticle = reloaded.find(a => a.article.title === '一致可积性')?.article;
  check('Article ID preserved', reloadedArticle?.id === article.id, reloadedArticle?.id);
  check('Tags preserved', JSON.stringify(reloadedArticle?.tags) === JSON.stringify(['probability', 'measure theory']));
  check('Series preserved', reloadedArticle?.series === 'Inference Notes');
  check('Source content preserved', reloadedArticle?.readSource().includes('一致可积性'));
  check('Imported image preserved', existsSync(join(reloadedArticle.dir, 'assets', 'figure-01.png')));
  check('Folder structure preserved', reloaded.some(a => a.folder === 'notes/probability'));

  const reloadedPaper = reloaded.find(a => a.article.title === 'A LaTeX Paper')?.article;
  check('.sty preserved', existsSync(join(reloadedPaper.dir, 'mystyle.sty')));
  check('.bib preserved', existsSync(join(reloadedPaper.dir, 'refs.bib')));

  const { getPreferences, getPlatforms } = await import(join(installation, 'src', 'core', 'config', 'index.js'));
  const prefs = getPreferences();
  check('Preferences preserved', prefs.editor_font_size === 17 && prefs.dark_editor === false);
  check('Unknown config keys preserved', prefs.my_unknown_key === 'keep me');

  const platforms = getPlatforms();
  check('Publication settings preserved', platforms.wechat?.appId === 'wx-user-value');
  check('Blog Pipeline configuration preserved',
    platforms.blogPipeline?.cliPath === '/opt/blogpipe/bin/blogpipe');

  const aiProfiles = JSON.parse(readFileSync(freshPaths.paths.aiProfilesFile, 'utf-8'));
  check('AI connection profiles preserved', aiProfiles.profiles?.[0]?.id === 'claw');
  check('Remote ClaudeClaw configuration preserved',
    aiProfiles.profiles?.[0]?.url === 'https://claw.example');
  check('Secrets preserved',
    readFileSync(freshPaths.paths.secretsFile, 'utf-8').includes('sk-ant-must-survive'));

  check('Custom theme preserved',
    readFileSync(join(freshPaths.paths.userThemes, 'my-theme.css'), 'utf-8').includes('rebeccapurple'));
  check('User copy of a built-in theme not overwritten',
    readFileSync(join(freshPaths.paths.userThemes, 'default.css'), 'utf-8').includes('my customised'));
  check('Snippets preserved', existsSync(join(freshPaths.paths.snippets, 'theorem.md')));
  check('Presets preserved', existsSync(join(freshPaths.paths.presets, 'wechat-dark.json')));
  check('History preserved', existsSync(join(freshPaths.paths.history, 'published.jsonl')));
  check('Generated build output preserved (not classified as removable)',
    existsSync(join(reloadedPaper.dir, 'dist', 'pdf', 'paper.pdf')));

  // ── 6. The updater refuses an unsafe layout ───────────────────────────────
  section('And an unsafe layout is refused rather than risked');

  const { checkUpdateSafety } = await import(join(installation, 'src', 'core', 'data-model.js'));
  const safe = checkUpdateSafety();
  check('A correct layout passes the safety gate', safe.safe);

  const unsafe = checkUpdateSafety({ workspaceRoot: join(installation, 'workspace') });
  check('A workspace inside the installation is refused', !unsafe.safe,
    unsafe.violations[0]?.reason || '');
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}

console.log('');
if (failures) {
  console.error(`\x1b[31m${failures} check(s) failed.\x1b[0m`);
  process.exit(1);
}
console.log('\x1b[32mUpdating the application does not touch the user\'s workspace.\x1b[0m');
