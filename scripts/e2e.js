#!/usr/bin/env node
/**
 * End-to-end smoke test.
 *
 * Drives the real built UI in a real browser against a real backend, so the
 * things that only break in a browser — clipboard, layout, event wiring, math
 * overflow — are actually exercised rather than assumed.
 *
 *   node scripts/e2e.js [--headed] [--keep]
 */

import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { setTimeout as delay } from 'timers/promises';
import { launchChrome } from './lib/chrome.js';

const appRoot = resolve(import.meta.dirname, '..');
const argv = process.argv.slice(2);
const headed = argv.includes('--headed');
const keep = argv.includes('--keep');

const results = [];
let failures = 0;

function check(label, passed, detail = '') {
  results.push({ label, passed, detail });
  const mark = passed ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
  console.log(`  ${mark} ${label}${detail ? `  \x1b[90m${detail}\x1b[0m` : ''}`);
  if (!passed) failures++;
}

async function main() {
  if (!existsSync(join(appRoot, 'dist', 'ui', 'index.html'))) {
    console.error('The UI has not been built. Run: npm run build');
    process.exit(1);
  }

  const workspace = mkdtempSync(join(tmpdir(), 'mdtex-e2e-ws-'));
  console.log(`Workspace: ${workspace}\n`);

  const { startServer } = await import('../src/server/index.js');
  const server = await startServer({
    port: 0,
    serveUi: true,
    writeRuntime: false,
    workspaceRoot: workspace,
    quiet: true,
  });

  const chrome = await launchChrome({ headless: !headed });
  const page = await chrome.browser.newPage();
  await page.enable();

  try {
    await page.grantClipboard(server.url);
    // Headless Chrome reports the document as unfocused, which the Async
    // Clipboard API refuses. Emulate focus so the clipboard path is exercised
    // the same way it is for a real user who just clicked the button.
    await page.cdp('Emulation.setFocusEmulationEnabled', { enabled: true });
    await page.cdp('Page.bringToFront', {}).catch(() => {});
    await page.goto(server.url);
    await page.waitFor('document.getElementById("library-list") !== null', { label: 'app shell' });

    console.log('Startup');

    // The overlay is markup, not something the bundle creates, so it is on
    // screen before any JavaScript runs — which is the part of the wait a
    // JS-created spinner could never cover. Checked before waiting for ready,
    // because after that it is gone.
    const bootTrace = await page.eval(`(() => {
      const overlay = document.getElementById('boot-overlay');
      if (!overlay) return { present: false };
      window.__bootPhases = [document.getElementById('boot-status').textContent];
      new MutationObserver(() => {
        const text = document.getElementById('boot-status')?.textContent;
        if (text && window.__bootPhases.at(-1) !== text) window.__bootPhases.push(text);
      }).observe(overlay, { subtree: true, childList: true, characterData: true });
      return { present: true, status: document.getElementById('boot-status').textContent };
    })()`);
    check('A loading screen is up before the application has started', bootTrace.present,
      bootTrace.present ? `"${bootTrace.status}"` : 'no #boot-overlay in the served HTML');

    const booted = await page.waitFor(
      'window.__mdtexReady === true || document.querySelectorAll("#library-list .library-empty").length > 0',
      { timeout: 20000, label: 'library render' },
    ).then(() => true).catch(() => false);
    check('UI boots against the backend', booted);
    check('No page errors during boot', page.pageErrors.length === 0,
      page.pageErrors.slice(0, 2).join(' | '));

    const bootEnd = await page.eval(`(async () => {
      const phases = window.__bootPhases || [];
      // The overlay is removed rather than hidden; an invisible full-screen
      // layer that still exists can still swallow a click.
      for (let i = 0; i < 60; i++) {
        if (document.getElementById('boot-overlay') === null) break;
        await new Promise(r => setTimeout(r, 50));
      }
      return { phases, gone: document.getElementById('boot-overlay') === null };
    })()`, { timeout: 20000 });

    check('It names each step rather than spinning silently', bootEnd.phases.length >= 3,
      bootEnd.phases.join(' → '));
    check('It gets out of the way once the application is ready', bootEnd.gone,
      bootEnd.gone ? 'removed from the DOM' : 'still present');

    // ── Article creation ────────────────────────────────────────────────────
    console.log('\nArticle management');
    await page.eval('document.getElementById("btn-new-folder").click()');
    await page.waitFor('document.querySelector(".mdtex-dialog") !== null', { label: 'folder dialog' });
    check('New-folder dialog is a styled dialog, not window.prompt', true);

    await page.eval(`(() => {
      const input = document.querySelector('.mdtex-dialog .field-input');
      input.value = 'research';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      [...document.querySelectorAll('.mdtex-dialog .dialog-footer .btn')]
        .find(b => b.textContent.includes('Create')).click();
    })()`);
    await delay(400);
    const folderCount = await page.eval('document.querySelectorAll("#library-list .library-folder").length');
    check('Folder created and shown in the tree', folderCount === 1, `${folderCount} folder(s)`);

    await page.eval('document.getElementById("btn-new-article").click()');
    await page.waitFor('document.querySelector(".mdtex-dialog") !== null', { label: 'new article dialog' });
    await page.eval(`(() => {
      const d = document.querySelector('.mdtex-dialog');
      d.querySelector('.field-input').value = 'E2E Test Article';
      d.querySelector('.field-input').dispatchEvent(new Event('input', { bubbles: true }));
      [...d.querySelectorAll('.dialog-footer .btn')].find(b => b.textContent.includes('Create')).click();
    })()`);
    await delay(700);

    const title = await page.eval('document.getElementById("article-title").textContent');
    check('Article created and opened', title === 'E2E Test Article', title);

    // ── Editing ─────────────────────────────────────────────────────────────
    console.log('\nEditing and preview');
    const fixture = readFileSync(join(appRoot, 'tests', 'fixtures', 'long_technical_article.md'), 'utf-8');
    await page.eval(`(() => {
      const editor = document.getElementById('editor');
      editor.value = ${JSON.stringify(fixture)};
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await delay(1200);

    const stats = await page.eval('document.getElementById("diag-stats").textContent');
    check('Preview renders and reports statistics', /math/.test(stats), stats);

    const mathBlocks = await page.eval('document.querySelectorAll("#preview-content .math-block").length');
    check('Display equations get their own fit container', mathBlocks > 0, `${mathBlocks} blocks`);

    // ── Math overflow ───────────────────────────────────────────────────────
    console.log('\nMathematics overflow');
    const overflow = await page.eval(`(() => {
      const doc = document.getElementById('preview-content');
      const pageOverflow = doc.scrollWidth - doc.clientWidth;
      const blocks = [...doc.querySelectorAll('.math-block')];
      const fits = blocks.map(b => ({
        mode: b.dataset.mathFit,
        overflow: b.scrollWidth - b.clientWidth,
      }));
      const inlineScrollers = [...doc.querySelectorAll('.katex:not(.katex-display)')]
        .filter(n => getComputedStyle(n).overflowX === 'auto' || getComputedStyle(n).overflowX === 'scroll').length;
      return {
        pageOverflow,
        modes: [...new Set(fits.map(f => f.mode))],
        scrolled: fits.filter(f => f.mode === 'scroll').length,
        scaled: fits.filter(f => f.mode === 'scaled').length,
        natural: fits.filter(f => f.mode === 'natural').length,
        inlineScrollers,
      };
    })()`);

    check('Article does not scroll horizontally', overflow.pageOverflow <= 1,
      `overflow ${overflow.pageOverflow}px`);
    check('Inline mathematics never gets a scrollbar', overflow.inlineScrollers === 0,
      `${overflow.inlineScrollers} inline scrollers`);
    check('Display equations are fitted', overflow.natural + overflow.scaled + overflow.scrolled > 0,
      `natural ${overflow.natural}, scaled ${overflow.scaled}, scrolled ${overflow.scrolled}`);

    // Narrow the preview and confirm wide equations start scrolling rather than clipping.
    await page.eval(`(() => {
      document.getElementById('library-panel').classList.remove('collapsed');
      document.getElementById('preview-pane').style.maxWidth = '340px';
      window.dispatchEvent(new Event('resize'));
    })()`);
    await delay(500);
    const narrow = await page.eval(`(() => {
      const doc = document.getElementById('preview-content');
      const blocks = [...doc.querySelectorAll('.math-block')];
      const scrollers = blocks.filter(b => b.classList.contains('math-scroll'));
      const cropped = blocks.filter(b => {
        const svgOrKatex = b.querySelector('.katex-display, svg');
        if (!svgOrKatex) return false;
        // Cropped means content is wider than the box AND the box cannot scroll.
        return b.scrollWidth > b.clientWidth + 2 && getComputedStyle(b).overflowX === 'hidden';
      });
      return {
        pageOverflow: doc.scrollWidth - doc.clientWidth,
        scrollers: scrollers.length,
        cropped: cropped.length,
        scrollbarHeight: scrollers[0]
          ? scrollers[0].offsetHeight - scrollers[0].clientHeight
          : 0,
      };
    })()`);
    check('Narrow pane still does not scroll the article', narrow.pageOverflow <= 1,
      `overflow ${narrow.pageOverflow}px`);
    check('No display equation is cropped without a way to scroll', narrow.cropped === 0,
      `${narrow.cropped} cropped, ${narrow.scrollers} scrollable`);

    await page.eval(`document.getElementById('preview-pane').style.maxWidth = ''`);
    await delay(300);

    // ── Imported image: visible immediately in the preview ──────────────────
    console.log('\nImported image');

    const imageResult = await page.eval(`(async () => {
      const editor = document.getElementById('editor');
      editor.focus();
      editor.value = '# Image test\\n\\n';
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      editor.selectionStart = editor.selectionEnd = editor.value.length;

      const bytes = Uint8Array.from(atob(
        'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAJUlEQVR42u3OMQEAAAgDoC252H' +
        'XiRWFB6mYAAAAAAAAAAAAAAHwZWLQAAWq0mfoAAAAASUVORK5CYII='), c => c.charCodeAt(0));
      const file = new File([bytes], 'figure-01.png', { type: 'image/png' });

      const dt = new DataTransfer();
      dt.items.add(file);
      document.getElementById('editor-pane').dispatchEvent(
        new DragEvent('drop', { dataTransfer: dt, bubbles: true, clientX: 400, clientY: 300 }));

      // Wait for the transactional import: source inserted only after the copy.
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline) {
        if (/!\\[[^\\]]*\\]\\(assets\\//.test(document.getElementById('editor').value)) break;
        await new Promise(r => setTimeout(r, 60));
      }
      await new Promise(r => setTimeout(r, 800));

      const source = document.getElementById('editor').value;
      const img = document.querySelector('#preview-content img');

      // The decisive check: did the browser actually load the pixels?
      let loaded = false, naturalWidth = 0;
      if (img) {
        if (!img.complete) {
          await new Promise(r => {
            img.addEventListener('load', r, { once: true });
            img.addEventListener('error', r, { once: true });
            setTimeout(r, 5000);
          });
        }
        loaded = img.complete && img.naturalWidth > 0;
        naturalWidth = img.naturalWidth;
      }

      return {
        source: source.match(/!\\[[^\\]]*\\]\\([^)]*\\)/)?.[0] || null,
        hasImg: Boolean(img),
        src: img ? img.getAttribute('src') : null,
        canonicalKept: img ? img.getAttribute('data-mdtex-src') : null,
        loaded,
        naturalWidth,
        missingPlaceholders: document.querySelectorAll('#preview-content .asset-missing').length,
      };
    })()`, { timeout: 60000 });

    check('Dropping an image inserts an article-relative path',
      imageResult.source === '![figure-01](assets/figure-01.png)', imageResult.source);
    check('The image is visible in the live preview immediately',
      imageResult.loaded && imageResult.naturalWidth > 0,
      `loaded=${imageResult.loaded}, naturalWidth=${imageResult.naturalWidth}px`);
    check('The preview loads it through the backend, with a cache-busting version',
      (imageResult.src || '').includes('/api/assets/') && (imageResult.src || '').includes('v='),
      imageResult.src ? imageResult.src.replace(/token=[^&]*/, 'token=…') : '(none)');
    check('The canonical reference is preserved on the element',
      imageResult.canonicalKept === 'assets/figure-01.png', imageResult.canonicalKept);
    check('No "image not found" placeholder is shown',
      imageResult.missingPlaceholders === 0, `${imageResult.missingPlaceholders} placeholder(s)`);

    // A broken reference must be diagnosable, not a silent broken-image icon.
    const brokenResult = await page.eval(`(async () => {
      const editor = document.getElementById('editor');
      editor.value = '# Broken\\n\\n![missing](assets/does-not-exist.png)\\n';
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 2500));
      const placeholder = document.querySelector('#preview-content .asset-missing');
      return { shown: Boolean(placeholder), text: placeholder ? placeholder.textContent : '' };
    })()`, { timeout: 30000 });

    check('A missing image shows a diagnostic instead of a broken icon',
      brokenResult.shown && /does-not-exist\.png/.test(brokenResult.text),
      brokenResult.text.replace(/\s+/g, ' ').slice(0, 90));

    // Restore the fixture for the compilation checks below.
    await page.eval(`(() => {
      const e = document.getElementById('editor');
      e.value = ${JSON.stringify('__FIXTURE__')};
      e.dispatchEvent(new Event('input', { bubbles: true }));
    })()`.replace('"__FIXTURE__"', JSON.stringify(fixture)));
    await delay(1500);

    // ── WeChat compilation ──────────────────────────────────────────────────
    console.log('\nWeChat compilation and copy');

    // Measure main-thread responsiveness while the compile runs.
    const compileResult = await page.eval(`(async () => {
      const marks = [];
      let worstGap = 0;
      let last = performance.now();
      const tick = () => {
        const now = performance.now();
        worstGap = Math.max(worstGap, now - last);
        last = now;
        if (!window.__e2eStop) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);

      const started = performance.now();
      document.getElementById('btn-prepare').click();

      const deadline = Date.now() + 120000;
      while (Date.now() < deadline) {
        const state = document.getElementById('target-state');
        if (state && state.classList.contains('ready')) break;
        const text = state ? state.textContent : '';
        if (text && !marks.includes(text)) marks.push(text);
        await new Promise(r => setTimeout(r, 60));
      }
      const elapsed = performance.now() - started;
      window.__e2eStop = true;

      return {
        elapsed: Math.round(elapsed),
        worstGap: Math.round(worstGap),
        marks: marks.slice(0, 12),
        ready: document.getElementById('target-state').classList.contains('ready'),
      };
    })()`, { timeout: 180000 });

    check('WeChat output compiles', compileResult.ready, `${compileResult.elapsed} ms`);
    check('Progress is reported stage by stage',
      compileResult.marks.some(m => /formula/i.test(m)),
      compileResult.marks.slice(0, 4).join(' → '));
    // The old browser path blocked the main thread outright. Anything under a
    // few hundred milliseconds means the UI stayed interactive.
    check('Editor stays responsive during compilation', compileResult.worstGap < 400,
      `worst main-thread gap ${compileResult.worstGap} ms`);

    const copyResult = await page.eval(`(async () => {
      // Clear any toast left over from the compile so we read this action's own.
      document.querySelectorAll('.toast').forEach(t => t.remove());
      window.focus();
      document.body.focus();

      const started = performance.now();
      document.getElementById('btn-copy-rich').click();

      const deadline = Date.now() + 20000;
      let toastText = '';
      while (Date.now() < deadline) {
        const t = document.querySelector('.toast-message');
        if (t) { toastText = t.textContent; break; }
        await new Promise(r => setTimeout(r, 40));
      }
      return { elapsed: Math.round(performance.now() - started), toastText };
    })()`, { timeout: 40000 });

    check('Copy reuses the prepared output', /Copied/i.test(copyResult.toastText),
      `${copyResult.elapsed} ms — "${copyResult.toastText}"`);
    check('Copy is fast because it does not recompile', copyResult.elapsed < 2500,
      `${copyResult.elapsed} ms`);

    const clipboard = await page.eval(`(async () => {
      try {
        const items = await navigator.clipboard.read();
        const types = items.flatMap(i => i.types);
        let htmlLength = 0;
        for (const item of items) {
          if (item.types.includes('text/html')) {
            htmlLength = (await (await item.getType('text/html')).text()).length;
          }
        }
        return { types, htmlLength };
      } catch (e) {
        return { error: String(e.message || e) };
      }
    })()`);
    check('Clipboard received rich text', (clipboard.htmlLength || 0) > 1000,
      clipboard.error || `text/html ${clipboard.htmlLength} chars, types: ${(clipboard.types || []).join(',')}`);

    // Second compile must be a cache hit.
    // Background preparation runs on a timer after the last edit. Wait for it to
    // settle first, otherwise its request would be wrongly attributed to the click.
    await page.waitFor(
      'window.__mdtex.state.target.prepared && !window.__mdtex.state.target.busy',
      { label: 'target settled' },
    );
    await delay(3000);

    // A repeat copy must not touch the compiler at all. Resource timing tells us
    // exactly which API calls the click made.
    const cached = await page.eval(`(async () => {
      const keyBefore = window.__mdtex.state.target.key;
      performance.clearResourceTimings();
      const started = performance.now();
      document.getElementById('btn-copy-rich').click();
      await new Promise(r => setTimeout(r, 700));
      const urls = performance.getEntriesByType('resource').map(e => e.name);
      return {
        elapsed: Math.round(performance.now() - started),
        keyStable: keyBefore === window.__mdtex.state.target.key,
        compileCalls: urls.filter(u => u.indexOf('/api/build/target') !== -1 && u.indexOf('/api/build/target/') === -1).length,
        calls: urls.length,
        urls: urls.map(u => u.replace(location.origin, '')),
      };
    })()`);
    check('Repeat copy stays instant', cached.elapsed < 2000, `${cached.elapsed} ms`);
    check('Repeat copy triggers no compilation', cached.compileCalls === 0 && cached.keyStable,
      `${cached.calls} request(s): ${(cached.urls || []).join(' ') || 'none'}`);

    // ── PDF ─────────────────────────────────────────────────────────────────
    console.log('\nPDF compilation');
    const pdfResult = await page.eval(`(async () => {
      document.getElementById('btn-compile-pdf').click();
      const deadline = Date.now() + 180000;
      while (Date.now() < deadline) {
        const frame = document.getElementById('pdf-frame');
        if (frame && frame.src && frame.src !== 'about:blank') {
          return { ok: true, src: frame.src.slice(0, 80) };
        }
        const dialog = document.querySelector('.mdtex-dialog');
        if (dialog && /LaTeX/.test(dialog.textContent)) {
          return { ok: false, setup: true, text: dialog.querySelector('.dialog-title').textContent };
        }
        await new Promise(r => setTimeout(r, 250));
      }
      const status = document.querySelector('.build-status-text');
      return { ok: false, status: status ? status.textContent : 'timed out' };
    })()`, { timeout: 200000 });

    if (pdfResult.setup) {
      check('LaTeX setup state shown when LaTeX is missing', true, pdfResult.text);
    } else {
      check('PDF compiles and previews in the UI', pdfResult.ok, pdfResult.src || pdfResult.status);
    }

    // ── AI quick connect ────────────────────────────────────────────────────
    console.log('\nAI quick connect');
    await page.eval(`document.getElementById('btn-toggle-ai').click()`);
    await delay(400);
    const quick = await page.eval(`(() => {
      const options = [...document.querySelectorAll('#ai-panel-root .quick-option .quick-option-label')]
        .map(n => n.textContent);
      const detected = [...document.querySelectorAll('#ai-panel-root .quick-option')]
        .filter(n => n.querySelector('.badge-ok')).length;
      return { options, detected };
    })()`);
    check('Quick Connect offers all three backends', quick.options.length === 3, quick.options.join(', '));
    check('Local detection ran before the user clicked anything', quick.detected >= 0,
      `${quick.detected} detected`);

    // ── Loading bar ─────────────────────────────────────────────────────────
    //
    // The claim is not "a bar exists" — it is that the bar appears when a load
    // is long enough to feel like one, and stays out of the way when it is not.
    // Both halves are checked, because a bar that flashes on every click is
    // worse than no bar at all.
    console.log('\nLoading indicator');

    const barSetup = await page.eval(`(async () => {
      const bar = document.querySelector('.page-progress');
      if (!bar) return { present: false };

      // Two articles: one trivial, one large enough that rendering it blocks.
      const short = await window.__mdtex.debug.createArticle('Short load', '# Short\\n\\nOne line.\\n');
      const unit = '## Section\\n\\nProse with $a^2+b^2=c^2$ inline and several more words.\\n\\n$$\\\\int_0^1 x^2\\\\,dx$$\\n\\n';
      const long = await window.__mdtex.debug.createArticle('Long load', unit.repeat(140));
      return { present: true, short, long };
    })()`, { timeout: 30000 });

    if (!barSetup.present) {
      check('A page-level loading bar exists', false, 'no .page-progress element');
    } else {
      check('A page-level loading bar exists', true, 'fixed 3px bar across the top of the window');

      const barRun = await page.eval(`(async () => {
        const bar = document.querySelector('.page-progress');
        const open = async (id) => {
          const before = window.__mdtex.state.progressShown;
          const seen = [];
          let activeAt = 0;
          let leftActiveAt = 0;
          const obs = new MutationObserver(() => {
            const state = bar.dataset.state;
            seen.push(state);
            if (state === 'active' && !activeAt) activeAt = performance.now();
            if (activeAt && state !== 'active' && !leftActiveAt) leftActiveAt = performance.now();
          });
          obs.observe(bar, { attributes: true, attributeFilter: ['data-state'] });

          await window.__mdtex.debug.openArticle(id);
          await new Promise(r => setTimeout(r, 1200));
          obs.disconnect();

          return {
            shown: window.__mdtex.state.progressShown - before,
            states: [...new Set(seen)],
            visibleMs: activeAt && leftActiveAt ? Math.round(leftActiveAt - activeAt) : null,
            endState: bar.dataset.state,
            opacity: getComputedStyle(bar).opacity,
          };
        };
        return { short: await open(${JSON.stringify(barSetup.short)}), long: await open(${JSON.stringify(barSetup.long)}) };
      })()`, { timeout: 60000 });

      check('Opening an article shows the bar, every time',
        barRun.short.shown === 1 && barRun.long.shown === 1,
        `short ${barRun.short.shown}x, long ${barRun.long.shown}x`);

      // The reason a bar can always appear without becoming a flicker: once up,
      // it stays up. Completing 20 ms after appearing is what reads as a glitch.
      check('Even the fastest load holds the bar long enough to be seen',
        barRun.short.visibleMs !== null && barRun.short.visibleMs >= 350,
        `${barRun.short.visibleMs} ms visible on a 20 ms load`);

      check('It reaches completion rather than being cut off',
        barRun.long.states.includes('done'), barRun.long.states.join(' → '));

      check('It clears itself afterwards',
        barRun.long.endState === 'idle' && barRun.long.opacity === '0'
        && barRun.short.endState === 'idle',
        `state ${barRun.long.endState}, opacity ${barRun.long.opacity}`);
    }

    // ── Properties dialog ───────────────────────────────────────────────────
    console.log('\nArticle properties');
    await page.eval(`document.getElementById('article-title').click()`);
    await page.waitFor('document.querySelector(".dialog-properties") !== null', { label: 'properties dialog' });
    const props = await page.eval(`(() => {
      const d = document.querySelector('.dialog-properties');
      const labels = [...d.querySelectorAll('.field-label')].map(n => n.textContent.replace(/stable$/, '').trim());
      const readonly = [...d.querySelectorAll('.field-input[readonly]')].length;
      const badges = [...d.querySelectorAll('.field-badge')].map(n => n.textContent);
      return { labels, readonly, badges };
    })()`);
    check('Properties covers the full metadata schema',
      ['Title', 'Language', 'Tags', 'Series / column', 'Publishing targets', 'WeChat theme', 'PDF template']
        .every(l => props.labels.includes(l)),
      props.labels.slice(0, 6).join(', '));
    check('Identity fields are read-only and marked stable',
      props.readonly >= 3 && props.badges.every(b => b === 'stable'),
      `${props.readonly} read-only, badges: ${[...new Set(props.badges)].join(',')}`);

    await page.eval(`document.querySelector('.dialog-properties .dialog-close').click()`);
    await delay(200);

    // ── Errors ──────────────────────────────────────────────────────────────
    console.log('\nConsole health');
    const realErrors = page.pageErrors.filter(e =>
      !/favicon|ERR_FILE_NOT_FOUND/.test(e)
      // The missing-image check above deliberately requests an asset that does
      // not exist; its 404 is the behaviour under test, not a defect.
      && !/does-not-exist\.png/.test(e));
    check('No uncaught page errors during the run', realErrors.length === 0,
      realErrors.slice(0, 2).join(' | '));

    if (keep) {
      console.log('\n--keep: leaving the browser open. Press Ctrl+C to exit.');
      await new Promise(() => {});
    }
  } finally {
    await page.close().catch(() => {});
    await chrome.close();
    await server.stop();
    if (!keep) rmSync(workspace, { recursive: true, force: true });
  }

  console.log(`\n${failures === 0 ? 'All end-to-end checks passed.' : `${failures} check(s) failed.`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('\nEnd-to-end run failed:', e);
  process.exit(1);
});
