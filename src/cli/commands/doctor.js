import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { paths } from '../../core/paths.js';
import { getConfig } from '../../core/config/index.js';
import { detectLatexEnvironment, ENGINES } from '../../core/latex/environment.js';
import { findClaudeCli } from '../../ai/backends/local-claude.js';
import { listProfiles, getActiveProfile } from '../../ai/registry.js';
import { BlogPipelineIntegration } from '../../workspace/blogpipe.js';
import { ArticleLibrary } from '../../workspace/library.js';
import { readRuntimeFile, isRuntimeAlive } from '../../server/runtime.js';
import { resolveExecutable } from '../../core/exec/which.js';

/**
 * `publisher doctor` — verify the installation, including everything the UI
 * needs in order to offer PDF compilation and AI editing.
 *
 * A failing LaTeX check is reported with the directories that were searched and
 * platform-specific install guidance, because "not found" on its own is not
 * actionable.
 */
export async function doctorCommand(options = {}) {
  console.log('MDTeX diagnostics\n');

  const checks = [];
  const warnings = [];

  function check(label, passed, detail = '') {
    checks.push({ label, passed });
    console.log(`  ${passed ? '✓' : '✗'} ${label}${detail ? `  ${detail}` : ''}`);
  }
  function note(label, detail = '') {
    console.log(`    ${label}${detail ? `  ${detail}` : ''}`);
  }
  function warn(message) {
    warnings.push(message);
    console.log(`  ⚠ ${message}`);
  }

  // ── Runtime ────────────────────────────────────────────────────────────────
  console.log('Runtime');
  const major = parseInt(process.version.slice(1), 10);
  check(`Node.js ${process.version}`, major >= 18);
  note(`Platform: ${process.platform} ${process.arch}`);

  // ── Application ────────────────────────────────────────────────────────────
  console.log('\nApplication');
  check('Application root', existsSync(paths.appRoot), paths.appRoot);
  check('Dependencies installed', existsSync(join(paths.appRoot, 'node_modules')));
  check('Built-in themes', existsSync(paths.builtinThemes)
    && readdirSync(paths.builtinThemes).some(f => f.endsWith('.css')));
  const uiBuilt = existsSync(join(paths.appRoot, 'dist', 'ui', 'index.html'));
  check('UI build', uiBuilt, uiBuilt ? '' : '(run: npm run build)');

  // ── Command availability ───────────────────────────────────────────────────
  console.log('\nCommand');
  const publisherOnPath = resolveExecutable('publisher');
  check('`publisher` on PATH', Boolean(publisherOnPath), publisherOnPath || '(re-run the installer)');
  if (!publisherOnPath) {
    note(process.platform === 'win32'
      ? 'Windows: run .\\install.ps1 again, then open a new terminal.'
      : 'Linux/macOS: run ./install.sh again, then open a new shell.');
  }

  const runtime = readRuntimeFile();
  if (runtime) {
    const alive = isRuntimeAlive(runtime);
    note(alive ? `Backend running at ${runtime.url} (pid ${runtime.pid})` : 'A stale runtime file was found; the backend is not running.');
  } else {
    note('Backend is not running. Start it with: publisher start');
  }

  // ── User data ──────────────────────────────────────────────────────────────
  console.log('\nUser data');
  check('Config directory', existsSync(paths.configDir), paths.configDir);
  check('Data directory', existsSync(paths.dataDir), paths.dataDir);
  check('Cache directory', existsSync(paths.cacheDir), paths.cacheDir);
  try {
    getConfig();
    check('Config readable', true);
  } catch (e) {
    check('Config readable', false, e.message);
  }

  try {
    const lib = new ArticleLibrary();
    const all = lib.listAll();
    note(`Workspace: ${all.length} article(s), ${lib.listFolders().length} folder(s), ${lib.listTrash().length} in trash`);
  } catch (e) {
    warn(`Workspace could not be read: ${e.message}`);
  }

  // ── LaTeX ──────────────────────────────────────────────────────────────────
  console.log('\nLaTeX (PDF compilation)');
  const latex = await detectLatexEnvironment({ force: true });
  check('latexmk', Boolean(latex.latexmk), latex.latexmk ? `${latex.latexmk.path}` : '');
  if (latex.latexmk?.version) note(latex.latexmk.version);

  for (const [name, meta] of Object.entries(ENGINES)) {
    const found = latex.engines[name];
    check(`${meta.label}`, Boolean(found), found ? found.path : '(not installed)');
  }

  for (const [name, tool] of Object.entries(latex.tools)) {
    if (tool) note(`${name}: ${tool.path}`);
  }

  if (latex.available) {
    note(`Distribution: ${latex.distribution}`);
    note(`Default engine: ${latex.defaultEngine}`);
  }
  for (const message of latex.notes || []) warn(message);

  if (!latex.available) {
    console.log('');
    console.log(`  PDF compilation is unavailable: missing ${latex.missing.join(', ')}.`);
    if (latex.hint) {
      console.log(`  ${latex.hint.summary}`);
      for (const option of latex.hint.options) {
        console.log(`    ${option.label}: ${option.detail}`);
      }
      console.log(`  ${latex.hint.note}`);
    }
    if (options.verbose) {
      console.log('\n  Directories searched:');
      for (const dir of latex.searchedDirs) console.log(`    ${dir}`);
    } else {
      console.log(`  (${latex.searchedDirs.length} directories searched — re-run with --verbose to list them)`);
    }
  }

  // ── AI ─────────────────────────────────────────────────────────────────────
  console.log('\nAI');
  const claudePath = findClaudeCli();
  check('Claude Code CLI', Boolean(claudePath), claudePath || '(optional — install for Local Claude Code)');
  const profiles = listProfiles();
  const active = getActiveProfile();
  note(`Connections configured: ${profiles.length}${active ? `, active: ${active.name}` : ', none active'}`);
  for (const profile of profiles) {
    note(`- ${profile.name} (${profile.typeLabel})${profile.secretConfigured ? ` key ${profile.secretFingerprint}` : ''}${profile.active ? '  [active]' : ''}`);
  }

  // ── Blog pipeline ──────────────────────────────────────────────────────────
  console.log('\nBlog pipeline');
  const blogpipe = new BlogPipelineIntegration().detect();
  check('blogpipe CLI', blogpipe.available, blogpipe.available ? blogpipe.version : '(optional)');

  // ── Rendering self-test ────────────────────────────────────────────────────
  console.log('\nRendering self-test');
  try {
    const { runSelftest } = await import('../../../scripts/selftest.js');
    const { passed, results } = await runSelftest();
    for (const r of results) console.log(`  ${r.passed ? '✓' : '✗'} ${r.label}`);
    if (!passed) checks.push({ label: 'Rendering self-test', passed: false });
  } catch (e) {
    console.log(`  ✗ Self-test failed: ${e.message}`);
    checks.push({ label: 'Rendering self-test', passed: false });
  }

  const failed = checks.filter(c => !c.passed);
  console.log('');
  if (failed.length === 0) {
    console.log(warnings.length ? `All checks passed, with ${warnings.length} warning(s).` : 'All checks passed.');
  } else {
    console.log(`${failed.length} check(s) failed:`);
    for (const f of failed) console.log(`  ✗ ${f.label}`);
  }

  process.exit(failed.length === 0 ? 0 : 1);
}
