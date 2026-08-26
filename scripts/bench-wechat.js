#!/usr/bin/env node
/**
 * WeChat compilation benchmark.
 *
 * Stage-by-stage timings for:
 *   legacy  — the original browser main-thread path (DOM CSS inlining +
 *             per-formula foreignObject SVG data URIs), reproduced under jsdom
 *   backend — the current local-backend path (MathJax path-only SVG + juice)
 *
 * jsdom cannot reproduce Chrome's layout/reflow cost, so the legacy numbers
 * here are a LOWER BOUND on what the browser actually did. The point of the
 * benchmark is the shape of the cost, not an exact wall-clock match.
 *
 *   node scripts/bench-wechat.js [--json] [--fixture <path>]
 */

import { readFileSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { performance } from 'perf_hooks';

const appRoot = resolve(import.meta.dirname, '..');

const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const fixtureArg = argv.indexOf('--fixture');
const fixturePath = fixtureArg >= 0
  ? resolve(argv[fixtureArg + 1])
  : join(appRoot, 'tests', 'fixtures', 'long_technical_article.md');

const source = readFileSync(fixturePath, 'utf-8');
const themeCss = readFileSync(join(appRoot, 'themes', 'builtin', 'default.css'), 'utf-8');

function ms(t) { return Math.round(t * 10) / 10; }

async function time(label, fn) {
  const t0 = performance.now();
  const value = await fn();
  return { label, ms: ms(performance.now() - t0), value };
}

// ── Legacy browser path (reproduced under jsdom) ─────────────────────────────

async function benchLegacy() {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    pretendToBeVisual: true,
  });
  const { window } = dom;

  // jsdom has no layout engine: every rect is 0x0, which would make the legacy
  // formula converter bail out before doing its work. Stub in plausible boxes so
  // the serialization cost we are measuring actually runs.
  window.Element.prototype.getBoundingClientRect = function () {
    const display = this.closest?.('.katex-display') || this.classList?.contains('katex-display');
    const w = display ? 320 : 48;
    const h = display ? 42 : 18;
    return { x: 0, y: 0, top: 0, left: 0, right: w, bottom: h, width: w, height: h };
  };

  const g = globalThis;
  const saved = {};
  for (const k of ['window', 'document', 'DOMParser', 'CSSRule', 'Element', 'Node', 'btoa', 'getComputedStyle']) {
    saved[k] = g[k];
  }
  g.window = window;
  g.document = window.document;
  g.DOMParser = window.DOMParser;
  g.CSSRule = window.CSSRule;
  g.Element = window.Element;
  g.Node = window.Node;
  g.btoa = window.btoa ? window.btoa.bind(window) : (s) => Buffer.from(s, 'binary').toString('base64');
  g.getComputedStyle = window.getComputedStyle.bind(window);

  try {
    const legacy = await import('./legacy-browser-path.js');
    const stages = [];

    const render = await time('markdown + KaTeX render', () => legacy.renderMarkdown(source));
    stages.push(render);
    const rawHtml = render.value;

    const css = await time('resolve CSS variables', () => legacy.resolveCssVariables(themeCss));
    stages.push(css);
    const resolvedCss = css.value;

    const math = await time('formula → foreignObject data URI', () =>
      legacy.replaceKatexWithImagesInBrowser(rawHtml, resolvedCss));
    stages.push(math);
    const mathHtml = math.value;

    const inline = await time('CSS inlining (getComputedStyle per element)', () =>
      legacy.inlineCssSimple(mathHtml, resolvedCss));
    stages.push(inline);
    const inlinedHtml = inline.value;

    const sanitize = await time('platform sanitize', () =>
      legacy.sanitizeForPlatform(inlinedHtml, 'wechat'));
    stages.push(sanitize);

    return {
      stages,
      totalMs: ms(stages.reduce((a, s) => a + s.ms, 0)),
      outputBytes: sanitize.value.length,
    };
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete g[k]; else g[k] = v;
    }
    window.close();
  }
}

// ── Current backend path ─────────────────────────────────────────────────────

async function benchBackend({ warmCache }) {
  const { Compiler } = await import('../src/core/compiler/index.js');
  const { FormulaCache } = await import('../src/core/math/formula-cache.js');
  const { mkdtempSync, rmSync } = await import('fs');
  const { tmpdir } = await import('os');

  // A private formula cache dir so "cold" really means cold.
  const cacheDir = mkdtempSync(join(tmpdir(), 'mdtex-bench-'));
  try {
    const compiler = new Compiler();
    compiler.formulaCache = new FormulaCache(cacheDir);

    if (warmCache) {
      await compiler.compile(source, { theme: 'default', platform: 'wechat', baseDir: dirname(fixturePath) });
    }

    const stages = [];
    const run = await time('full compile (MathJax SVG + juice + adapter)', () =>
      compiler.compile(source, { theme: 'default', platform: 'wechat', baseDir: dirname(fixturePath) }));
    stages.push(run);

    const result = run.value;
    return {
      stages,
      totalMs: run.ms,
      outputBytes: result.html.length,
      formulas: result.mathResult.inlineRendered + result.mathResult.displayRendered,
      cachedFormulas: result.mathResult.cached,
    };
  } finally {
    rmSync(cacheDir, { recursive: true, force: true });
  }
}

// ── Run ──────────────────────────────────────────────────────────────────────

const legacy = await benchLegacy();
const backendCold = await benchBackend({ warmCache: false });
const backendWarm = await benchBackend({ warmCache: true });

const report = {
  fixture: fixturePath.replace(appRoot + '/', ''),
  sourceBytes: source.length,
  formulas: backendCold.formulas,
  node: process.version,
  legacy,
  backendCold,
  backendWarm,
};

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`Fixture: ${report.fixture} (${report.sourceBytes} bytes, ${report.formulas} formulas)`);
  console.log(`Node ${report.node}\n`);

  console.log('Legacy browser main-thread path (jsdom lower bound):');
  for (const s of legacy.stages) console.log(`  ${String(s.ms).padStart(8)} ms  ${s.label}`);
  console.log(`  ${String(legacy.totalMs).padStart(8)} ms  TOTAL   → ${legacy.outputBytes} bytes of HTML\n`);

  console.log('Local backend path, cold formula cache:');
  for (const s of backendCold.stages) console.log(`  ${String(s.ms).padStart(8)} ms  ${s.label}`);
  console.log(`  ${String(backendCold.totalMs).padStart(8)} ms  TOTAL   → ${backendCold.outputBytes} bytes of HTML\n`);

  console.log('Local backend path, warm formula cache:');
  console.log(`  ${String(backendWarm.totalMs).padStart(8)} ms  TOTAL   → ${backendWarm.outputBytes} bytes of HTML`);
  console.log(`            (${backendWarm.cachedFormulas}/${backendWarm.formulas} formulas served from cache)`);
}
