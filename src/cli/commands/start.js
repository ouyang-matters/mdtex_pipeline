import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { paths, getVersionSync, getGitCommitSync } from '../../core/paths.js';
import { startServer } from '../../server/index.js';
import { readRuntimeFile, isRuntimeAlive } from '../../server/runtime.js';
import { getConfig } from '../../core/config/index.js';
import { checkForUpdate, describeReason, readUpdateState, compareVersions } from '../../core/update/check.js';
import { performUpdate } from '../../core/update/apply.js';
import { box, rows, bold, dim, grey, cyan, green, yellow, ARROW, TICK } from '../format.js';

/**
 * `publisher start` — launch MDTeX.
 *
 * Identical on Windows and Linux: one command starts the local backend, serves
 * the built UI from the same origin, and opens a browser. Nothing about the
 * user-facing contract differs between platforms; only the "open a browser"
 * call underneath does.
 */
export async function startCommand(options = {}) {
  const uiDir = join(paths.appRoot, 'dist', 'ui');

  if (!existsSync(uiDir)) {
    console.error('The MDTeX UI has not been built yet.');
    console.error('');
    console.error('  Run:  npm run build        (from ' + paths.appRoot + ')');
    console.error('  Or reinstall: ./install.sh   /   .\\install.ps1');
    process.exit(1);
  }

  const existing = readRuntimeFile();
  const alreadyRunning = existing && isRuntimeAlive(existing) && !options.force;

  // Install a release the previous launch found, before anything is served.
  // Only the remembered answer is consulted — no network — so a launch never
  // waits on one; the background check below refreshes it for next time.
  if (!alreadyRunning && options.updateCheck !== false && process.env.MDTEX_UPDATED !== '1') {
    const config = getConfig();
    if (config.update_check !== false && config.update_auto !== false) {
      const restarted = await autoUpdate();
      if (restarted) return;
    }
  }

  if (alreadyRunning) {
    console.log(`MDTeX is already running: ${existing.url}`);
    console.log('Opening the existing session. Use --force to start a second instance.');
    if (options.open !== false) openBrowser(existing.url);
    return;
  }

  const port = options.port ? Number(options.port) : 4173;

  let instance;
  try {
    instance = await startServer({ port, host: '127.0.0.1', serveUi: true, uiDir });
  } catch (e) {
    if (e.code === 'EADDRINUSE') {
      console.error(`Port ${port} is already in use. Pick another with --port.`);
      process.exit(1);
    }
    throw e;
  }

  console.log('');
  console.log(box([
    `${bold('MDTeX Studio')}  ${dim(getVersionSync())}  ${grey(getGitCommitSync())}`,
    cyan(instance.url),
  ]));
  console.log('');
  console.log(rows([
    ['Workspace', paths.workspace],
    ['Config', paths.configDir],
  ]));
  console.log('');
  console.log(grey('  Bound to 127.0.0.1, and every request carries a per-session token.'));
  console.log(grey('  Press Ctrl+C to stop.'));
  console.log('');

  if (options.open !== false) openBrowser(instance.url);

  // After the server is up and the browser is opening, never before: an update
  // check is a network round trip, and nothing about starting should wait on
  // one. If it never answers, the only thing lost is the notice.
  if (options.updateCheck !== false && getConfig().update_check !== false) {
    reportUpdate().catch(() => {});
  }

  const shutdown = async (signal) => {
    console.log(`\nStopping MDTeX (${signal})…`);
    await instance.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Keep the process alive for the server.
  await new Promise(() => {});
}

/**
 * If the last check found a newer release, install it and hand over to it.
 *
 * Returns true when the new version has been started in this process's place
 * (the caller must then do nothing more), false when MDTeX should start as it
 * is — up to date, nothing known, or an update that could not run. A refusal
 * is reported and never stops the launch.
 */
async function autoUpdate() {
  const known = readUpdateState();
  const current = getVersionSync();
  if (!known?.checked || !known.available || known.mode !== 'release') return false;
  // The answer must be about this installation; after any update it is stale.
  if (known.localVersion !== current || compareVersions(known.latestVersion, current) <= 0) return false;

  console.log('');
  console.log(box([
    `${yellow('Updating MDTeX')}  ${current}${grey(`  ${ARROW}  `)}${green(known.latestVersion)}`,
    grey('Turn automatic installation off:  publisher update --auto-install off'),
  ], { colour: yellow }));
  console.log('');

  const result = await performUpdate({
    target: known.target,
    remoteName: known.remoteName || 'origin',
    log: (line) => console.log(grey(`  ${line}`)),
  });

  if (!result.ok) {
    console.log('');
    console.log(yellow(`  Not updated: ${result.reason}.`));
    if (result.stage === 'dirty') console.log(grey('  The checkout has local changes; `publisher update --force` updates anyway.'));
    if (result.backupDir) console.log(grey(`  Backup of your data: ${result.backupDir}`));
    console.log(grey(`  Starting ${current}.`));
    console.log('');
    return false;
  }

  console.log('');
  console.log(green(`  ${TICK} Updated to ${result.newVersion}. Starting it…`));
  console.log('');

  // The new code is on disk but this process still runs the old one: start
  // the new version in its place, with the same arguments, and exit with it.
  const child = spawn(process.execPath, process.argv.slice(1), {
    stdio: 'inherit',
    env: { ...process.env, MDTEX_UPDATED: '1' },
  });
  child.on('exit', (code) => process.exit(code ?? 0));
  await new Promise(() => {});
  return true;
}

/**
 * Print the update notice, if there is one to print.
 *
 * Only "there is a newer version" is worth interrupting for. Being up to date
 * is the expected case and says nothing; a check that could not run says
 * nothing either, because "we could not reach the remote" is not news to
 * someone who is offline — `publisher update --check` asks explicitly and
 * reports either way.
 */
async function reportUpdate() {
  const result = await checkForUpdate();
  if (!result.checked || !result.available) return;

  const release = result.mode === 'release';
  const auto = release && getConfig().update_auto !== false;
  console.log(box([
    `${yellow('A newer version is available')}`,
    release
      ? `${grey('installed')}  ${result.localVersion}${grey(`  ${ARROW}  `)}${green(result.latestVersion)}`
      : `${grey('installed')}  ${result.local?.slice(0, 7)}${grey(`  ${ARROW}  `)}${green(result.remote.slice(0, 7))}  ${grey(`on ${result.remoteName}/${result.branch}`)}`,
    '',
    auto
      ? `It will be installed the next time MDTeX starts, or now with  ${bold('publisher update')}`
      : `Update with  ${bold('publisher update')}`,
    grey('Turn this check off:  publisher update --auto off'),
  ], { colour: yellow }));
  console.log('');
}

/**
 * Open a URL in the user's default browser.
 * The command differs per platform; the CLI contract does not.
 */
export function openBrowser(url) {
  try {
    if (process.platform === 'win32') {
      // `start` is a cmd builtin, and the empty string is the window title.
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch {
    console.log(`Open this URL in your browser: ${url}`);
  }
}
