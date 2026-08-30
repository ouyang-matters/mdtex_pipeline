#!/usr/bin/env node
/**
 * Measure how big published formulas actually render, in a real browser.
 *
 * The bug this exists to catch: a very short inline formula such as `$K$`
 * becoming enormous after being pasted into WeChat, while longer formulas and
 * display equations look fine.
 *
 * The cause is not the formula. An inline `<svg>` that has lost its width and
 * height renders at its container's width — the SVG specification's default —
 * and scales its height by the viewBox aspect ratio. A single glyph has a
 * roughly square viewBox, so 768px of column width becomes 590px of height. A
 * long formula's viewBox is wide and short, so the same treatment leaves it
 * looking close to normal. That asymmetry is the whole reason the symptom
 * appears specific to short formulas, and appears intermittent: it depends on
 * how aggressively the paste target rewrites the markup.
 *
 * So the check is not "does it render correctly", which it always did. It is
 * "does it still render correctly once a hostile consumer has stripped the
 * parts it does not understand". Each mutation below is something a sanitizing
 * paste target plausibly does.
 *
 * Run: node scripts/math-sizing-check.js
 */

import { writeFileSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { launchChrome } from './lib/chrome.js';
import { Compiler } from '../src/core/compiler/index.js';
import { loadTheme } from '../src/core/themes/index.js';

const COLUMN_PX = 800;
const FONT_PX = 16;

/** A short formula's rendered width must stay close to its intrinsic size. */
const MAX_INLINE_WIDTH_PX = 60;

const SOURCE = `
Let $K$ be compact, with $n$ elements and parameter $\\alpha$.

A longer inline formula: $f(x) = \\sum_{i=1}^{n} \\alpha_i x_i$ in running text.

$$\\int_0^1 x^2 \\, dx = \\frac{1}{3}$$

Ending with $K$ once more.
`;

/** Themes whose rules leak onto anything that is an image or an svg. */
const THEMES = {
  'plain': '',
  'svg width:100%': '#nice svg { width: 100%; height: auto; display: block; }',
  'svg !important': '#nice svg { width: 100% !important; display: block !important; }',
  'generic image rule': '#nice img, #nice svg { max-width: 100%; width: 100%; display: block; margin: 1em auto; }',
  'universal selector': '#nice * { max-width: 100%; }',
  'span block': '#nice span { display: block; width: 100%; }',
};

/** What a sanitizing paste target does to markup it does not understand. */
const MUTATIONS = {
  'as published': h => h,
  'wrapper removed': h => unwrapInline(h),
  'svg dimensions removed': h => dropSvgDimensions(h),
  'svg style removed': h => dropSvgStyle(h),
  'data attributes removed': h => h.replace(/\sdata-[a-z-]+="[^"]*"/g, ''),
  'svg style and dimensions removed': h => dropSvgDimensions(dropSvgStyle(h)),
  'wrapper removed, dimensions removed': h => dropSvgDimensions(unwrapInline(h)),
};

const unwrapInline = h =>
  h.replace(/<span[^>]*data-mdtex-math="inline"[^>]*>([\s\S]*?)<\/span>/g, '$1');
const dropSvgStyle = h => h.replace(/(<svg\b[^>]*?)\sstyle="[^"]*"/g, '$1');
const dropSvgDimensions = h => h
  .replace(/(<svg\b[^>]*?)\s(?:width|height)="[^"]*"/g, '$1')
  .replace(/(<svg\b[^>]*?)\s(?:width|height)="[^"]*"/g, '$1');

const styleOfTag = tag => (tag.match(/style="([^"]*)"/) || [, ''])[1];

let failures = 0;
function check(label, passed, detail = '') {
  const mark = passed ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
  console.log(`  ${mark} ${label}${detail ? `  \x1b[90m${detail}\x1b[0m` : ''}`);
  if (!passed) failures++;
}

const scratch = mkdtempSync(join(tmpdir(), 'mdtex-math-sizing-'));
const chrome = await launchChrome({ headless: true });
const page = await chrome.browser.newPage();
await page.enable();
await page.cdp('Emulation.setDeviceMetricsOverride', {
  width: COLUMN_PX + 100, height: 1200, deviceScaleFactor: 1, mobile: false,
});

async function measure(html, name) {
  const file = join(scratch, `${name.replace(/[^a-z0-9]/gi, '_')}.html`);
  writeFileSync(file, '<!doctype html><meta charset="utf-8">'
    + `<body style="margin:0"><div style="width:${COLUMN_PX}px;font-size:${FONT_PX}px">${html}</div></body>`);
  await page.goto(`file://${file}`);
  return page.eval(`(() => {
    const box = el => { const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; };
    const inline = [...document.querySelectorAll('[data-latex]')]
      .filter(e => e.getAttribute('data-display') === 'false')
      .map(e => ({ latex: e.getAttribute('data-latex'), ...box(e.querySelector('svg') || e) }));
    const looseSvgs = [...document.querySelectorAll('svg')].map(box);
    const display = document.querySelector('[data-mdtex-math="display"] svg');
    return {
      inline,
      looseSvgs,
      display: display ? box(display) : null,
      pageScrollWidth: document.documentElement.scrollWidth,
    };
  })()`);
}

try {
  const base = loadTheme('default').css;

  console.log('Formula sizing\n');
  console.log(`  column ${COLUMN_PX}px, font ${FONT_PX}px\n`);

  // ── 1. Every theme, as published ──────────────────────────────────────────
  console.log('A theme cannot resize a formula');
  const intrinsic = {};
  for (const [themeName, extra] of Object.entries(THEMES)) {
    const { html } = await new Compiler().compile(SOURCE, {
      platform: 'wechat',
      themeCss: `${base}\n${extra}\n`,
    });
    const m = await measure(html, `theme-${themeName}`);

    const short = m.inline.filter(f => f.latex === 'K');
    const long = m.inline.find(f => (f.latex || '').includes('sum'));

    if (themeName === 'plain') {
      intrinsic.short = short[0]?.w;
      intrinsic.long = long?.w;
      intrinsic.display = m.display?.w;
    }

    const ok = short.length > 0
      && short.every(f => f.w > 0 && f.w <= MAX_INLINE_WIDTH_PX)
      && short.every(f => f.w === intrinsic.short)
      && long?.w === intrinsic.long
      && m.display?.w === intrinsic.display;

    check(themeName, ok,
      `$K$ ${short.map(f => `${f.w}px`).join(', ')} · long ${long?.w}px · display ${m.display?.w}px`);
  }

  // ── 2. Every occurrence of the same formula is sized independently ────────
  console.log('\nRepeated formulas do not share state');
  const { html: repeated } = await new Compiler().compile(SOURCE, { platform: 'wechat', themeCss: base });
  const repeatedMeasure = await measure(repeated, 'repeated');
  const ks = repeatedMeasure.inline.filter(f => f.latex === 'K');
  check('Both occurrences of $K$ are identical', ks.length === 2 && ks[0].w === ks[1].w && ks[0].h === ks[1].h,
    ks.map(k => `${k.w}x${k.h}`).join(' vs '));

  // ── 3. Survive a hostile consumer ─────────────────────────────────────────
  console.log('\nA sanitizing paste target cannot resize a formula');
  for (const [label, mutate] of Object.entries(MUTATIONS)) {
    const mutated = mutate(repeated);
    const m = await measure(mutated, `mutation-${label}`);
    // After the wrapper is stripped there is no [data-latex] to key on, so fall
    // back to the raw SVG list: the first is the first inline formula, $K$.
    const first = m.inline.find(f => f.latex === 'K') || m.looseSvgs[0];
    const ok = first && first.w > 0 && first.w <= MAX_INLINE_WIDTH_PX;
    check(label, ok, first ? `$K$ ${first.w}x${first.h}px` : 'not found');
  }

  // ── 4. Inline and display never share styling ─────────────────────────────
  console.log('\nInline and display stay distinct');
  const inlineEls = [...repeated.matchAll(/<(svg|span|img)\b[^>]*data-mdtex-math="inline"[^>]*>/g)].map(m => m[0]);
  const displayEls = [...repeated.matchAll(/<(svg|section|img)\b[^>]*data-mdtex-math="display"[^>]*>/g)].map(m => m[0]);

  check('Inline math is marked inline', inlineEls.length > 0, `${inlineEls.length} element(s)`);
  check('Display math is marked display', displayEls.length > 0, `${displayEls.length} element(s)`);
  // `width:100%` as its own declaration, not the tail of `max-width:100%`.
  const FULL_WIDTH = /(^|;|")\s*width\s*:\s*100%/;
  check('No inline element is full-width', !inlineEls.some(e => FULL_WIDTH.test(styleOfTag(e))));
  check('No inline element is a block', !inlineEls.some(e => /display:\s*block/.test(e)));
  check('No inline element has auto margins', !inlineEls.some(e => /margin:[^;"]*auto/.test(e)));
  check('Inline math opts out of max-width', inlineEls.filter(e => /<(svg|span|img)/.test(e))
    .every(e => /max-width:\s*none/.test(e)));
  check('Display math keeps its column cap', displayEls.filter(e => /<svg/.test(e))
    .every(e => /max-width:\s*100%/.test(e)));
  check('The page never scrolls sideways', repeatedMeasure.pageScrollWidth <= COLUMN_PX + 100,
    `${repeatedMeasure.pageScrollWidth}px`);
} finally {
  await chrome.close().catch(() => {});
  rmSync(scratch, { recursive: true, force: true });
}

console.log('');
if (failures) {
  console.error(`\x1b[31m${failures} check(s) failed.\x1b[0m`);
  process.exit(1);
}
console.log('\x1b[32mFormulas keep their intrinsic size in every theme and after sanitization.\x1b[0m');
// Exit explicitly, as the other browser-driving checks do. Closing Chrome does
// not always drain the CDP socket, and a check that reports success and then
// never returns is a check nothing can run unattended.
process.exit(0);
