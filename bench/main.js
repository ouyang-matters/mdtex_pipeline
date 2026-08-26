/**
 * Browser-side benchmark harness.
 *
 * Measures the two WeChat compilation paths in a real browser, on the same
 * fixture, in the same engine:
 *
 *   legacy  — the original main-thread path (per-formula foreignObject data
 *             URIs, DOM CSS inlining), preserved in ./legacy-wechat-path.js
 *   backend — the current path: one call to the local backend, which runs
 *             MathJax and juice off the UI thread
 *
 * Also samples main-thread responsiveness during each run, because the point of
 * the change was that the editor stays usable while a build is happening.
 */

import katexCssUrl from 'katex/dist/katex.min.css?url';
import * as legacy from './legacy-wechat-path.js';

const status = document.getElementById('status');
const output = document.getElementById('output');

function log(text) {
  status.textContent = text;
}

/**
 * Run `fn` while sampling how long the main thread is blocked between frames.
 *
 * The sampler must keep running for one frame AFTER `fn` resolves: while the
 * main thread is blocked no rAF callback can fire, so the gap only becomes
 * observable on the first frame after the block ends. Stopping at `fn`'s
 * resolution — which happens in a microtask, before any frame — would report a
 * blocked run as zero.
 *
 * Returns { ms, worstGapMs, frames }.
 */
async function measure(fn) {
  let worstGap = 0;
  let frames = 0;
  let last = performance.now();
  let running = true;

  const tick = () => {
    const now = performance.now();
    worstGap = Math.max(worstGap, now - last);
    last = now;
    frames++;
    if (running) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  const started = performance.now();
  const value = await fn();
  const elapsed = performance.now() - started;

  // Let one more frame land so a block that spanned the whole run is recorded.
  running = false;
  await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));

  return { ms: Math.round(elapsed), worstGapMs: Math.round(worstGap), frames, value };
}

async function runLegacy({ source, themeCss, katexCss }) {
  const stages = [];
  const stage = async (label, fn) => {
    const r = await measure(fn);
    stages.push({ label, ms: r.ms, worstGapMs: r.worstGapMs });
    return r.value;
  };

  const total = await measure(async () => {
    const rawHtml = await stage('markdown + KaTeX render', () => legacy.renderMarkdown(source));
    const resolvedCss = await stage('resolve CSS variables', () => legacy.resolveCssVariables(themeCss));
    const mathHtml = await stage('formula → foreignObject data URI',
      () => legacy.replaceKatexWithImagesInBrowser(rawHtml, resolvedCss, katexCss));
    const inlined = await stage('CSS inlining (getComputedStyle per element)',
      () => legacy.inlineCssSimple(mathHtml, resolvedCss));
    return await stage('platform sanitize', () => legacy.sanitizeForPlatform(inlined, 'wechat'));
  });

  const clipboard = await measureClipboard(total.value);

  return {
    stages,
    totalMs: total.ms,
    worstGapMs: total.worstGapMs,
    outputBytes: total.value.length,
    clipboard,
  };
}

/**
 * Time the rich-text clipboard write itself. On the legacy path this is handed
 * several megabytes of HTML, so it is a meaningful part of the cost.
 */
async function measureClipboard(html) {
  try {
    const r = await measure(() => navigator.clipboard.write([new ClipboardItem({
      'text/html': new Blob([html], { type: 'text/html' }),
      'text/plain': new Blob([''], { type: 'text/plain' }),
    })]));
    return { ms: r.ms, worstGapMs: r.worstGapMs, bytes: html.length };
  } catch (e) {
    return { error: String(e.message || e), bytes: html.length };
  }
}

async function runBackend({ source, themeCss, token, force }) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers['x-mdtex-token'] = token;

  const result = await measure(async () => {
    const response = await fetch('/api/build/target', {
      method: 'POST',
      headers,
      body: JSON.stringify({ source, themeCss, themeName: 'default', platform: 'wechat', force }),
    });
    const body = await response.json();

    if (body.cached) return { cached: true, bytes: body.bytes, key: body.key };

    // Follow the job the same way the application does.
    const url = `/api/jobs/${body.jobId}/events${token ? `?token=${encodeURIComponent(token)}` : ''}`;
    const source$ = new EventSource(url);
    const marks = [];
    await new Promise((res) => {
      source$.onmessage = (e) => {
        const data = JSON.parse(e.data);
        if (data.kind === 'progress' && data.message) marks.push(data.message);
      };
      source$.addEventListener('end', () => { source$.close(); res(); });
      source$.onerror = () => { source$.close(); res(); };
    });

    const job = await (await fetch(`/api/jobs/${body.jobId}`, { headers })).json();
    return { cached: false, marks, ...job.job.result };
  });

  return {
    totalMs: result.ms,
    worstGapMs: result.worstGapMs,
    ...result.value,
  };
}

async function main() {
  log('Loading fixture…');
  const params = new URLSearchParams(location.search);
  const token = params.get('token');

  const [source, themeCss, katexCss] = await Promise.all([
    fetch('./fixture.md').then(r => r.text()),
    fetch('./theme.css').then(r => r.text()),
    fetch(katexCssUrl).then(r => r.text()),
  ]);

  const report = {
    fixtureBytes: source.length,
    katexCssBytes: katexCss.length,
    userAgent: navigator.userAgent,
  };

  log('Running the current backend path (cold cache)…');
  report.backendCold = await runBackend({ source, themeCss, token, force: true });

  log('Running the current backend path (warm cache)…');
  report.backendWarm = await runBackend({ source, themeCss, token, force: false });

  // What pressing Copy actually costs once the target is prepared: fetch the
  // stored bytes and write them to the clipboard.
  log('Measuring the prepared copy path…');
  report.copy = await measure(async () => {
    const headers = token ? { 'x-mdtex-token': token } : {};
    const payload = await (await fetch(`/api/build/target/${report.backendWarm.key}`, { headers })).json();
    const clip = await measureClipboard(payload.html);
    return { bytes: payload.html.length, clip };
  }).then(r => ({ ms: r.ms, worstGapMs: r.worstGapMs, ...r.value }));

  log('Running the legacy main-thread path…');
  report.legacy = await runLegacy({ source, themeCss, katexCss });

  window.__BENCH_RESULT__ = report;
  output.textContent = JSON.stringify(report, null, 2);
  log('Done.');
}

main().catch((e) => {
  window.__BENCH_RESULT__ = { error: String(e.stack || e) };
  log(`Failed: ${e.message}`);
  output.textContent = String(e.stack || e);
});
