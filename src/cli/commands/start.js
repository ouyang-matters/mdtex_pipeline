import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { paths, getVersionSync, getGitCommitSync } from '../../core/paths.js';
import { startServer } from '../../server/index.js';
import { readRuntimeFile, isRuntimeAlive } from '../../server/runtime.js';
import { getConfig } from '../../core/config/index.js';
import { checkForUpdate, describeReason } from '../../core/update/check.js';
import { box, rows, bold, dim, grey, cyan, green, yellow, ARROW } from '../format.js';

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
  if (existing && isRuntimeAlive(existing) && !options.force) {
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

  console.log(box([
    `${yellow('A newer version is available')}`,
    `${grey('installed')}  ${result.local?.slice(0, 7)}${grey(`  ${ARROW}  `)}${green(result.remote.slice(0, 7))}  ${grey(`on ${result.remoteName}/${result.branch}`)}`,
    '',
    `Update with  ${bold('publisher update')}`,
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
