#!/usr/bin/env node
/**
 * WeChat compilation benchmark.
 *
 * Runs both paths in a real browser against a real backend:
 *
 *   legacy  — the original browser main-thread path, preserved verbatim in
 *             bench/legacy-wechat-path.js
 *   backend — the current path, where the browser asks the local backend to
 *             compile and the heavy work happens off the UI thread
 *
 * The numbers that matter are wall-clock time AND the worst main-thread gap:
 * a compile that takes a second but never blocks the editor is a different
 * experience from one that takes the same second with the window frozen.
 *
 *   node scripts/bench-wechat.js [--json] [--markdown] [--fixture <path>]
 */

import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve, basename } from 'path';
import { execFileSync } from 'child_process';
import { launchChrome } from './lib/chrome.js';

const appRoot = resolve(import.meta.dirname, '..');
const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const asMarkdown = argv.includes('--markdown');
const fixtureArg = argv.indexOf('--fixture');
const fixturePath = fixtureArg >= 0
  ? resolve(argv[fixtureArg + 1])
  : join(appRoot, 'tests', 'fixtures', 'long_technical_article.md');
const scaleArg = argv.indexOf('--scale');
// Repeat the fixture body N times, to show how each path scales with article
// length rather than only reporting one size.
const scale = scaleArg >= 0 ? Math.max(1, Number(argv[scaleArg + 1]) || 1) : 1;

const BENCH_DIR = join(appRoot, 'dist', 'bench');

function buildBenchPage() {
  execFileSync('npx', ['vite', 'build', '--config', 'vite.bench.config.js'], {
    cwd: appRoot,
    stdio: asJson ? 'ignore' : 'inherit',
  });
}

async function main() {
  if (!existsSync(join(BENCH_DIR, 'index.html')) || argv.includes('--rebuild')) {
    if (!asJson) console.log('Building the benchmark page…\n');
    buildBenchPage();
  }

  // The page fetches its fixture and theme from its own directory.
  const base = readFileSync(fixturePath, 'utf-8');
  const source = scale > 1 ? scaleFixture(base, scale) : base;
  writeFileSync(join(BENCH_DIR, 'fixture.md'), source, 'utf-8');
  copyFileSync(join(appRoot, 'themes', 'builtin', 'default.css'), join(BENCH_DIR, 'theme.css'));

  // A private cache directory, so "cold" really is cold.
  const cacheHome = mkdtempSync(join(tmpdir(), 'mdtex-bench-cache-'));
  const workspace = mkdtempSync(join(tmpdir(), 'mdtex-bench-ws-'));
  process.env.XDG_CACHE_HOME = cacheHome;

  const { startServer } = await import('../src/server/index.js');
  const server = await startServer({
    port: 0,
    serveUi: true,
    uiDir: BENCH_DIR,
    writeRuntime: false,
    workspaceRoot: workspace,
    quiet: true,
  });

  const chrome = await launchChrome({ headless: true });
  const page = await chrome.browser.newPage();
  await page.enable();

  let report;
  try {
    // The benchmark writes to the clipboard, which headless Chrome refuses
    // without permission and without a focused document.
    await page.grantClipboard(server.url);
    await page.cdp('Emulation.setFocusEmulationEnabled', { enabled: true });
    await page.goto(`${server.url}/index.html?token=${encodeURIComponent(server.token)}`);
    await page.waitFor('window.__BENCH_RESULT__ !== undefined', {
      timeout: 20 * 60 * 1000,
      interval: 500,
      label: 'benchmark completion',
    });
    report = await page.eval('window.__BENCH_RESULT__');
  } finally {
    await page.close().catch(() => {});
    await chrome.close();
    await server.stop();
    rmSync(cacheHome, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
  }

  if (report.error) {
    console.error('Benchmark failed inside the page:\n', report.error);
    process.exit(1);
  }

  report.fixture = scale > 1 ? `${basename(fixturePath)} x${scale}` : basename(fixturePath);
  report.scale = scale;
  report.formulaCount = countFormulas(source);
  report.node = process.version;

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else if (asMarkdown) {
    console.log(renderMarkdownReport(report));
  } else {
    console.log(renderTextReport(report));
  }

  process.exit(0);
}

/**
 * Repeat an article body, renumbering headings so the result reads as one long
 * document rather than N copies stacked on top of each other.
 */
function scaleFixture(source, times) {
  const [head, ...rest] = source.split(/^## /m);
  const body = rest.map(s => `## ${s}`).join('');
  let out = head;
  for (let i = 0; i < times; i++) {
    out += body.replace(/^## (\d+)\./gm, (_, n) => `## ${Number(n) + i * 100}.`)
               .replace(/^### (\d+)\.(\d+)/gm, (_, a, b) => `### ${Number(a) + i * 100}.${b}`);
  }
  return out;
}

function countFormulas(source) {
  const display = (source.match(/^\$\$$/gm) || []).length / 2;
  const inline = (source.match(/(?<!\$)\$([^$\n]+?)\$(?!\$)/g) || []).length;
  return { display, inline, total: display + inline };
}

function renderTextReport(r) {
  const lines = [];
  lines.push(`Fixture: ${r.fixture} — ${r.fixtureBytes} bytes, ${r.formulaCount.total} formulas `
    + `(${r.formulaCount.display} display, ${r.formulaCount.inline} inline)`);
  lines.push(`Browser: ${r.userAgent.match(/Chrome\/[\d.]+/)?.[0] || r.userAgent}`);
  lines.push(`Node: ${r.node}`);
  lines.push('');

  lines.push('Legacy browser main-thread path');
  for (const s of r.legacy.stages) {
    lines.push(`  ${String(s.ms).padStart(9)} ms  ${s.label}`);
  }
  lines.push(`  ${String(r.legacy.totalMs).padStart(9)} ms  TOTAL`);
  lines.push(`  worst main-thread gap: ${r.legacy.worstGapMs} ms`);
  lines.push(`  output: ${formatBytes(r.legacy.outputBytes)}`);
  lines.push('');

  lines.push('Current path (local backend), cold formula cache');
  lines.push(`  ${String(r.backendCold.totalMs).padStart(9)} ms  TOTAL`);
  if (r.backendCold.timings) {
    for (const [phase, ms] of Object.entries(r.backendCold.timings)) {
      lines.push(`  ${String(ms).padStart(9)} ms    ${phase}`);
    }
  }
  lines.push(`  worst main-thread gap: ${r.backendCold.worstGapMs} ms`);
  lines.push(`  output: ${formatBytes(r.backendCold.bytes || 0)}`);
  lines.push('');

  lines.push('Current path, warm cache');
  lines.push(`  ${String(r.backendWarm.totalMs).padStart(9)} ms  TOTAL${r.backendWarm.cached ? ' (cache hit)' : ''}`);
  lines.push(`  worst main-thread gap: ${r.backendWarm.worstGapMs} ms`);
  lines.push('');

  if (r.copy) {
    lines.push('Pressing Copy on prepared output (fetch stored bytes + clipboard write)');
    lines.push(`  ${String(r.copy.ms).padStart(9)} ms  TOTAL`);
    if (r.copy.clip) {
      lines.push(`  ${String(r.copy.clip.ms ?? '?').padStart(9)} ms    clipboard write of ${formatBytes(r.copy.clip.bytes)}`);
    }
    lines.push(`  worst main-thread gap: ${r.copy.worstGapMs} ms`);
    lines.push('');
  }

  if (r.legacy.clipboard) {
    lines.push('Legacy clipboard write');
    lines.push(r.legacy.clipboard.error
      ? `  failed: ${r.legacy.clipboard.error}`
      : `  ${String(r.legacy.clipboard.ms).padStart(9)} ms  writing ${formatBytes(r.legacy.clipboard.bytes)}`);
    lines.push('');
  }

  const legacyPerCopy = r.legacy.totalMs + (r.legacy.clipboard?.ms || 0);
  const newPerCopy = r.copy ? r.copy.ms : r.backendWarm.totalMs;
  lines.push(`Every press of Copy used to cost ${legacyPerCopy} ms of blocked main thread `
    + `(worst stall ${r.legacy.worstGapMs} ms) and produce ${formatBytes(r.legacy.outputBytes)}.`);
  lines.push(`It now costs ${newPerCopy} ms with a worst stall of ${r.copy ? r.copy.worstGapMs : r.backendWarm.worstGapMs} ms, `
    + `on ${formatBytes(r.backendCold.bytes || 0)} of output.`);

  return lines.join('\n');
}

function renderMarkdownReport(r) {
  const lines = [];
  lines.push(`Fixture: \`${r.fixture}\` — ${r.fixtureBytes} bytes, ${r.formulaCount.total} formulas `
    + `(${r.formulaCount.display} display, ${r.formulaCount.inline} inline).`);
  lines.push('');
  lines.push('| Path | Total | Worst main-thread gap | Output |');
  lines.push('| --- | ---: | ---: | ---: |');
  lines.push(`| Legacy browser main thread | ${r.legacy.totalMs} ms | ${r.legacy.worstGapMs} ms | ${formatBytes(r.legacy.outputBytes)} |`);
  lines.push(`| Local backend, cold cache | ${r.backendCold.totalMs} ms | ${r.backendCold.worstGapMs} ms | ${formatBytes(r.backendCold.bytes || 0)} |`);
  lines.push(`| Local backend, warm cache | ${r.backendWarm.totalMs} ms | ${r.backendWarm.worstGapMs} ms | — |`);
  lines.push('');
  lines.push('Legacy stage breakdown:');
  lines.push('');
  lines.push('| Stage | Time |');
  lines.push('| --- | ---: |');
  for (const s of r.legacy.stages) lines.push(`| ${s.label} | ${s.ms} ms |`);
  if (r.backendCold.timings) {
    lines.push('');
    lines.push('Backend stage breakdown (cold cache):');
    lines.push('');
    lines.push('| Stage | Time |');
    lines.push('| --- | ---: |');
    for (const [phase, ms] of Object.entries(r.backendCold.timings)) lines.push(`| ${phase} | ${ms} ms |`);
  }
  return lines.join('\n');
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

main().catch((e) => {
  console.error('Benchmark failed:', e);
  process.exit(1);
});
