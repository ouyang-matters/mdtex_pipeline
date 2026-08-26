/**
 * Minimal Chrome DevTools Protocol driver.
 *
 * Used by the benchmark and the end-to-end smoke test so both measure the real
 * browser main thread rather than a DOM emulation. Deliberately dependency
 * free: Node 22 ships a global WebSocket, which is all CDP needs.
 */

import { spawn } from 'child_process';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { setTimeout as delay } from 'timers/promises';

const CHROME_CANDIDATES = process.platform === 'win32'
  ? [
      `${process.env['ProgramFiles']}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env['ProgramFiles']}\\Microsoft\\Edge\\Application\\msedge.exe`,
    ]
  : process.platform === 'darwin'
    ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
    : [
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/snap/bin/chromium',
      ];

export function findChrome() {
  if (process.env.MDTEX_CHROME && existsSync(process.env.MDTEX_CHROME)) return process.env.MDTEX_CHROME;
  return CHROME_CANDIDATES.find(p => p && existsSync(p)) || null;
}

export async function launchChrome({ headless = true, port = 0 } = {}) {
  const bin = findChrome();
  if (!bin) throw new Error('No Chrome/Chromium binary found (set MDTEX_CHROME to override).');

  const userDataDir = mkdtempSync(join(tmpdir(), 'mdtex-chrome-'));
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--disable-gpu',
    '--no-sandbox',
    'about:blank',
  ];
  if (headless) args.unshift('--headless=new');

  const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });

  // Chrome prints the actual DevTools endpoint on stderr when port=0.
  const endpoint = await new Promise((resolvePromise, rejectPromise) => {
    let buf = '';
    const onData = (chunk) => {
      buf += chunk.toString();
      const m = buf.match(/ws:\/\/[^\s]+/);
      if (m) {
        child.stderr.off('data', onData);
        resolvePromise(m[0]);
      }
    };
    child.stderr.on('data', onData);
    child.on('exit', (code) => rejectPromise(new Error(`Chrome exited early (code ${code})\n${buf}`)));
    setTimeout(() => rejectPromise(new Error(`Timed out waiting for Chrome DevTools endpoint:\n${buf}`)), 30000);
  });

  const browser = await connect(endpoint);

  return {
    browser,
    async close() {
      try { await browser.close(); } catch {}
      try { child.kill('SIGTERM'); } catch {}
      await delay(150);
      try { child.kill('SIGKILL'); } catch {}
      try { rmSync(userDataDir, { recursive: true, force: true }); } catch {}
    },
  };
}

async function connect(endpoint) {
  const ws = new WebSocket(endpoint);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', () => rej(new Error('CDP connect failed')), { once: true });
  });

  let nextId = 1;
  const pending = new Map();
  const listeners = new Map();

  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve: res, reject: rej } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) rej(new Error(`${msg.error.message}${msg.error.data ? ': ' + msg.error.data : ''}`));
      else res(msg.result);
    } else if (msg.method) {
      for (const fn of listeners.get(msg.method) || []) fn(msg.params, msg.sessionId);
    }
  });

  function send(method, params = {}, sessionId) {
    const id = nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    ws.send(JSON.stringify(payload));
    return new Promise((res, rej) => pending.set(id, { resolve: res, reject: rej }));
  }

  function on(method, fn) {
    if (!listeners.has(method)) listeners.set(method, []);
    listeners.get(method).push(fn);
    return () => {
      const arr = listeners.get(method) || [];
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    };
  }

  return {
    send,
    on,
    async newPage(url = 'about:blank') {
      const { targetId } = await send('Target.createTarget', { url });
      const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
      return makePage(send, on, sessionId, targetId);
    },
    async close() { ws.close(); },
  };
}

function makePage(send, on, sessionId, targetId) {
  const consoleLines = [];
  const pageErrors = [];

  const page = {
    sessionId,
    targetId,
    consoleLines,
    pageErrors,

    cdp: (method, params = {}) => send(method, params, sessionId),

    async enable() {
      await send('Page.enable', {}, sessionId);
      await send('Runtime.enable', {}, sessionId);
      await send('Log.enable', {}, sessionId);
      on('Runtime.consoleAPICalled', (params, sid) => {
        if (sid !== sessionId) return;
        consoleLines.push(params.args.map(a => a.value ?? a.description ?? a.unserializableValue ?? '').join(' '));
      });
      on('Runtime.exceptionThrown', (params, sid) => {
        if (sid !== sessionId) return;
        const d = params.exceptionDetails;
        pageErrors.push(d.exception?.description || d.text || 'Unknown page error');
      });
      on('Log.entryAdded', (params, sid) => {
        if (sid !== sessionId) return;
        if (params.entry.level === 'error') pageErrors.push(params.entry.text);
      });
    },

    async goto(url, { waitUntil = 'load', timeout = 30000 } = {}) {
      const loaded = new Promise((res) => {
        const off = on(waitUntil === 'load' ? 'Page.loadEventFired' : 'Page.domContentEventFired', (_p, sid) => {
          if (sid !== sessionId) return;
          off();
          res();
        });
      });
      await send('Page.navigate', { url }, sessionId);
      await Promise.race([loaded, delay(timeout).then(() => { throw new Error(`Navigation to ${url} timed out`); })]);
    },

    async eval(expression, { awaitPromise = true, returnByValue = true, timeout = 600000 } = {}) {
      const result = await Promise.race([
        send('Runtime.evaluate', {
          expression,
          awaitPromise,
          returnByValue,
          userGesture: true,
        }, sessionId),
        delay(timeout).then(() => { throw new Error('Runtime.evaluate timed out'); }),
      ]);
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      }
      return result.result?.value;
    },

    /** Evaluate a function in the page, passing JSON-serialisable arguments. */
    async call(fn, ...args) {
      const expr = `(${fn.toString()}).apply(null, ${JSON.stringify(args)})`;
      return page.eval(expr);
    },

    async waitFor(predicateExpression, { timeout = 30000, interval = 100, label = '' } = {}) {
      const deadline = Date.now() + timeout;
      for (;;) {
        let ok = false;
        try { ok = await page.eval(`Boolean(${predicateExpression})`, { awaitPromise: false }); } catch { ok = false; }
        if (ok) return true;
        if (Date.now() > deadline) {
          throw new Error(`Timed out waiting for ${label || predicateExpression}`);
        }
        await delay(interval);
      }
    },

    async screenshot(path) {
      const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
      const { writeFileSync } = await import('fs');
      writeFileSync(path, Buffer.from(data, 'base64'));
      return path;
    },

    async setExtraHeaders(headers) {
      await send('Network.enable', {}, sessionId);
      await send('Network.setExtraHTTPHeaders', { headers }, sessionId);
    },

    async grantClipboard(origin) {
      await send('Browser.grantPermissions', {
        origin,
        permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
      });
    },

    async close() {
      try { await send('Target.closeTarget', { targetId }); } catch {}
    },
  };

  return page;
}
