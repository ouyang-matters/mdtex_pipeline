#!/usr/bin/env node
/**
 * Primary workflow check.
 *
 * Walks the whole intended journey in one run, in a real browser against a real
 * backend, in the order a writer would actually do it:
 *
 *   launch → create a folder → create an article → edit its metadata →
 *   write Markdown with live preview → drag an image in → open a LaTeX project →
 *   compile a PDF and inspect it → render WeChat without freezing →
 *   copy the finished rich text
 *
 *   node scripts/workflow-check.js [--headed]
 */

import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { setTimeout as delay } from 'timers/promises';
import { launchChrome } from './lib/chrome.js';

const appRoot = resolve(import.meta.dirname, '..');
const headed = process.argv.includes('--headed');

let step = 0;
let failures = 0;

function ok(label, detail = '') {
  console.log(`  \x1b[32m✓\x1b[0m ${++step}. ${label}${detail ? `  \x1b[90m${detail}\x1b[0m` : ''}`);
}
function bad(label, detail = '') {
  console.log(`  \x1b[31m✗\x1b[0m ${++step}. ${label}${detail ? `  \x1b[90m${detail}\x1b[0m` : ''}`);
  failures++;
}
function check(condition, label, detail = '') {
  if (condition) ok(label, detail); else bad(label, detail);
  return condition;
}

/** A tiny valid PNG, so the image step exercises real bytes. */
const PIXEL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

async function main() {
  if (!existsSync(join(appRoot, 'dist', 'ui', 'index.html'))) {
    console.error('Build the UI first: npm run build');
    process.exit(1);
  }

  const workspace = mkdtempSync(join(tmpdir(), 'mdtex-workflow-'));
  console.log(`\nPrimary workflow — workspace ${workspace}\n`);

  const { startServer } = await import('../src/server/index.js');
  const server = await startServer({
    port: 0, serveUi: true, writeRuntime: false, workspaceRoot: workspace, quiet: true,
  });

  const chrome = await launchChrome({ headless: !headed });
  const page = await chrome.browser.newPage();
  await page.enable();

  try {
    await page.grantClipboard(server.url);
    await page.cdp('Emulation.setFocusEmulationEnabled', { enabled: true });
    await page.cdp('Emulation.setDeviceMetricsOverride', {
      width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false,
    });

    // 1 — launch
    await page.goto(server.url);
    await page.waitFor('window.__mdtexReady === true', { timeout: 30000, label: 'application ready' });
    const state = await page.eval('window.__mdtex.state');
    check(state.connected, 'Launch: the UI comes up connected to the local backend', server.url);

    // 2 — create a folder
    await dialogAction(page, 'btn-new-folder', `
      const input = dialog.querySelector('.field-input');
      input.value = 'research';
      input.dispatchEvent(new Event('input', {bubbles:true}));
      [...dialog.querySelectorAll('.dialog-footer .btn')].find(b => b.textContent.includes('Create')).click();
    `);
    const folders = await page.eval('document.querySelectorAll("#library-list .library-folder").length');
    check(folders === 1, 'Create a folder', `${folders} folder in the tree`);

    // 3 — create an article inside it
    await dialogAction(page, 'btn-new-article', `
      const input = dialog.querySelector('.field-input');
      input.value = 'Regularized Inference';
      input.dispatchEvent(new Event('input', {bubbles:true}));
      const folderSelect = dialog.querySelectorAll('select')[1];
      if (folderSelect) folderSelect.value = 'research';
      [...dialog.querySelectorAll('.dialog-footer .btn')].find(b => b.textContent.includes('Create')).click();
    `);
    const title = await page.eval('document.getElementById("article-title").textContent');
    check(title === 'Regularized Inference', 'Create an article and have it open', title);

    // 4 — edit its metadata
    await page.eval('document.getElementById("article-title").click()');
    await page.waitFor('document.querySelector(".dialog-properties") !== null', { label: 'properties' });
    const metaResult = await page.eval(`(async () => {
      const d = document.querySelector('.dialog-properties');
      const fieldFor = (label) => [...d.querySelectorAll('.field')]
        .find(f => f.querySelector('.field-label')?.textContent.replace(/stable$/, '').trim() === label);

      const set = (label, value) => {
        const input = fieldFor(label).querySelector('.field-input');
        input.value = value;
        input.dispatchEvent(new Event('input', {bubbles:true}));
        input.dispatchEvent(new Event('change', {bubbles:true}));
      };
      set('Tags', 'inference, numerics');
      set('Series / column', 'Inference Notes');
      set('Author', 'A. Writer');
      set('Language', 'en');
      set('PDF template', 'academic');

      const idBefore = fieldFor('Article ID').querySelector('.field-input').value;
      [...d.querySelectorAll('.dialog-footer .btn')].find(b => b.textContent.includes('Save')).click();
      await new Promise(r => setTimeout(r, 900));
      return { idBefore };
    })()`);
    const meta = await page.eval(`(() => {
      const chips = [...document.querySelectorAll('#article-meta .tag-chip')].map(n => n.textContent);
      const series = document.querySelector('#article-meta .series-chip')?.textContent;
      return { chips, series, id: window.__mdtex.state.articleId };
    })()`);
    check(meta.chips.includes('inference') && meta.series === 'Inference Notes',
      'Edit article metadata', `tags ${meta.chips.join(',')} · series ${meta.series}`);
    check(meta.id === metaResult.idBefore, 'The article ID is unchanged by the edit', meta.id);

    // 5 — write Markdown with live preview
    const fixture = readFileSync(join(appRoot, 'tests', 'fixtures', 'long_technical_article.md'), 'utf-8');
    await page.eval(`(() => {
      const e = document.getElementById('editor');
      e.value = ${JSON.stringify(fixture)};
      e.dispatchEvent(new Event('input', {bubbles:true}));
    })()`);
    await delay(1500);
    const preview = await page.eval(`(() => ({
      katex: document.querySelectorAll('#preview-content .katex').length,
      stats: document.getElementById('diag-stats').textContent,
      overflow: document.getElementById('preview-content').scrollWidth
              - document.getElementById('preview-content').clientWidth,
    }))()`);
    check(preview.katex > 100 && preview.overflow <= 1,
      'Write Markdown and see it live', `${preview.katex} formulas rendered, ${preview.stats}`);

    // 6 — the article saved itself to disk
    await page.waitFor('window.__mdtex.state.dirty === false', { timeout: 15000, label: 'auto-save' });
    const onDisk = readdirSync(join(workspace, 'research'))[0];
    const savedSource = readFileSync(join(workspace, 'research', onDisk, 'source.md'), 'utf-8');
    check(savedSource.length === fixture.length,
      'The article is saved to disk, not to browser storage',
      join('research', onDisk, 'source.md'));

    // 7 — drop an image at the cursor
    const imageResult = await page.eval(`(async () => {
      const editor = document.getElementById('editor');
      editor.focus();
      editor.selectionStart = editor.selectionEnd = editor.value.indexOf('## 1.');

      const bytes = Uint8Array.from(atob('${PIXEL_PNG}'), c => c.charCodeAt(0));
      const file = new File([bytes], 'diagram.png', { type: 'image/png' });
      const dt = new DataTransfer();
      dt.items.add(file);

      document.getElementById('editor-pane').dispatchEvent(
        new DragEvent('drop', { dataTransfer: dt, bubbles: true, clientX: 400, clientY: 300 }));

      await new Promise(r => setTimeout(r, 1200));
      const m = document.getElementById('editor').value.match(/!\\[[^\\]]*\\]\\(assets\\/[^)]+\\)/);
      return m ? m[0] : null;
    })()`);
    check(Boolean(imageResult), 'Drag an image into the editor', imageResult || 'no reference inserted');

    const assetDir = join(workspace, 'research', onDisk, 'assets');
    check(existsSync(assetDir) && readdirSync(assetDir).length > 0,
      'The image is stored in the article assets directory',
      existsSync(assetDir) ? readdirSync(assetDir).join(', ') : 'missing');

    // 8 — WeChat compilation, without freezing
    const compile = await page.eval(`(async () => {
      let worstGap = 0, last = performance.now(), running = true;
      const tick = () => { const n = performance.now(); worstGap = Math.max(worstGap, n - last); last = n;
                           if (running) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);

      const marks = [];
      const started = performance.now();
      document.getElementById('btn-prepare').click();
      const deadline = Date.now() + 120000;
      while (Date.now() < deadline) {
        const s = document.getElementById('target-state');
        if (s.classList.contains('ready')) break;
        if (s.textContent && !marks.includes(s.textContent)) marks.push(s.textContent);
        await new Promise(r => setTimeout(r, 50));
      }
      const elapsed = performance.now() - started;
      running = false;
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      return { elapsed: Math.round(elapsed), worstGap: Math.round(worstGap), marks: marks.slice(0, 6),
               ready: document.getElementById('target-state').classList.contains('ready') };
    })()`, { timeout: 180000 });

    check(compile.ready, 'Compile for WeChat', `${compile.elapsed} ms`);
    check(compile.worstGap < 400, 'The editor stays responsive throughout',
      `worst main-thread stall ${compile.worstGap} ms`);
    check(compile.marks.some(m => /formula/i.test(m)), 'Progress is reported stage by stage',
      compile.marks.slice(0, 3).join(' → '));

    // 9 — copy the finished rich text
    const copy = await page.eval(`(async () => {
      document.querySelectorAll('.toast').forEach(t => t.remove());
      performance.clearResourceTimings();
      const started = performance.now();
      document.getElementById('btn-copy-rich').click();
      const deadline = Date.now() + 20000;
      let toast = '';
      while (Date.now() < deadline) {
        const t = document.querySelector('.toast-message');
        if (t) { toast = t.textContent; break; }
        await new Promise(r => setTimeout(r, 40));
      }
      const urls = performance.getEntriesByType('resource').map(e => e.name);
      return { ms: Math.round(performance.now() - started), toast,
               compiles: urls.filter(u => u.endsWith('/api/build/target')).length };
    })()`, { timeout: 40000 });

    check(/Copied/i.test(copy.toast), 'Copy the finished rich text', `${copy.ms} ms — ${copy.toast}`);
    check(copy.compiles === 0, 'Copying did not trigger another compilation',
      `${copy.compiles} compile request(s)`);

    const clip = await page.eval(`(async () => {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        if (item.types.includes('text/html')) {
          const html = await (await item.getType('text/html')).text();
          return { bytes: html.length, svgs: (html.match(/<svg/g) || []).length,
                   hasStyleTag: /<style/i.test(html), hasClasses: /class="/.test(html) };
        }
      }
      return null;
    })()`);
    check(clip && clip.svgs > 100 && !clip.hasStyleTag && !clip.hasClasses,
      'The clipboard holds WeChat-ready rich text',
      clip ? `${(clip.bytes/1024).toFixed(0)} KB, ${clip.svgs} inline SVGs, no <style>, no classes` : 'nothing');

    // 10 — compile a PDF and inspect it
    const pdf = await page.eval(`(async () => {
      document.getElementById('btn-compile-pdf').click();
      const deadline = Date.now() + 240000;
      while (Date.now() < deadline) {
        const frame = document.getElementById('pdf-frame');
        if (frame && frame.src && frame.src !== 'about:blank') return { ok: true };
        const dialog = document.querySelector('.mdtex-dialog');
        if (dialog && /LaTeX/.test(dialog.textContent)) return { ok: false, setup: true };
        await new Promise(r => setTimeout(r, 300));
      }
      return { ok: false, status: document.querySelector('.build-status-text')?.textContent };
    })()`, { timeout: 260000 });

    if (pdf.setup) {
      ok('LaTeX is not installed — the UI shows a setup state instead of failing');
    } else {
      const pdfPath = join(workspace, 'research', onDisk, 'dist', 'pdf', 'article.pdf');
      check(pdf.ok && existsSync(pdfPath), 'Compile a PDF from the UI and preview it',
        existsSync(pdfPath) ? `${(readFileSync(pdfPath).length / 1024).toFixed(0)} KB` : 'no PDF on disk');
      check(readFileSync(pdfPath).subarray(0, 5).toString() === '%PDF-',
        'The PDF is a real PDF');

      // The image dragged in at step 8 must actually be in the document. A PDF
      // that compiles without its figures is a silent failure, and "it built"
      // is not evidence that it built correctly.
      const texDir = join(workspace, 'research', onDisk, 'dist', 'pdf', 'tex');
      const mainTex = existsSync(join(texDir, 'article.tex'))
        ? readFileSync(join(texDir, 'article.tex'), 'utf-8')
        : '';
      const copied = existsSync(texDir)
        ? readdirSync(texDir).filter(f => /^image-\d+\.(png|jpe?g|pdf)$/i.test(f))
        : [];
      check(
        /\\includegraphics\[[^\]]*\]\{image-\d+\.[a-z]+\}/.test(mainTex) && copied.length > 0,
        'The dragged image is carried into the PDF, not silently dropped',
        `${copied.length} image(s) copied into the build directory`,
      );
    }

    // 11 — open a LaTeX project and compile it
    const latexDir = join(workspace, 'research', 'latex-paper');
    writeLatexProject(latexDir);
    // Navigate rather than calling location.reload(): reload() returns before
    // the navigation happens, so the readiness flag of the OLD page would
    // satisfy the wait and everything after it would run against a stale DOM.
    await page.goto(server.url);
    await page.waitFor('window.__mdtexReady === true', { timeout: 30000, label: 'reload' });
    await delay(500);
    const opened = await page.eval(`(async () => {
      const row = [...document.querySelectorAll('#library-list .library-item')]
        .find(n => n.textContent.includes('LaTeX Paper'));
      if (!row) return { found: false };
      row.click();
      await new Promise(r => setTimeout(r, 900));
      return { found: true, format: document.getElementById('editor-format-label').textContent,
               source: document.getElementById('editor').value.slice(0, 40) };
    })()`);
    check(opened.found && opened.format === 'TeX', 'Open a LaTeX project', opened.source);

    if (!pdf.setup) {
      const latexPdf = await page.eval(`(async () => {
        document.getElementById('btn-compile-pdf').click();
        const deadline = Date.now() + 240000;
        while (Date.now() < deadline) {
          const frame = document.getElementById('pdf-frame');
          if (frame && frame.src && frame.src !== 'about:blank') return { ok: true };
          await new Promise(r => setTimeout(r, 300));
        }
        return { ok: false, status: document.querySelector('.build-status-text')?.textContent };
      })()`, { timeout: 260000 });

      const projectPdf = join(latexDir, 'dist', 'pdf', 'main.pdf');
      check(latexPdf.ok && existsSync(projectPdf),
        'Compile the LaTeX project, with its .sty, .bib and figures',
        existsSync(projectPdf) ? `${(readFileSync(projectPdf).length / 1024).toFixed(0)} KB` : latexPdf.status);
    }

    // 12 — AI quick connect is present and detected
    await page.eval('document.getElementById("btn-toggle-ai").click()');
    await delay(500);
    const ai = await page.eval(`(() => ({
      options: [...document.querySelectorAll('#ai-panel-root .quick-option-label')].map(n => n.textContent),
      detected: [...document.querySelectorAll('#ai-panel-root .quick-option .badge-ok')].map(n => n.textContent),
    }))()`);
    check(ai.options.length === 3, 'Quick AI Connection is one click away in the AI panel',
      ai.options.join(', '));

    const errors = page.pageErrors.filter(e => !/favicon/.test(e));
    check(errors.length === 0, 'No uncaught errors anywhere in the journey',
      errors.slice(0, 2).join(' | '));
  } finally {
    await page.close().catch(() => {});
    await chrome.close();
    await server.stop();
    rmSync(workspace, { recursive: true, force: true });
  }

  console.log(`\n${failures === 0 ? 'The primary workflow completes end to end.' : `${failures} step(s) failed.`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

/**
 * Click a button, wait for its dialog, then run `body` against it.
 * `body` is evaluated with `dialog` bound to the dialog element.
 */
async function dialogAction(page, buttonId, body) {
  await page.eval(`document.getElementById(${JSON.stringify(buttonId)}).click()`);
  await page.waitFor('document.querySelector(".mdtex-dialog") !== null', { label: `${buttonId} dialog` });
  await page.eval(`(() => { const dialog = document.querySelector('.mdtex-dialog'); ${body} })()`);
  await delay(700);
}

/** A small multi-file LaTeX project with a local package, bibliography and figure. */
function writeLatexProject(dir) {
  mkdirSync(join(dir, 'sections'), { recursive: true });
  mkdirSync(join(dir, 'figures'), { recursive: true });
  mkdirSync(join(dir, 'assets'), { recursive: true });

  writeFileSync(join(dir, 'article.json'), JSON.stringify({
    id: 'workflow-latex-project',
    title: 'LaTeX Paper',
    sourceFormat: 'latex',
    sourceFile: 'main.tex',
    language: 'en',
    tags: [],
    targets: ['pdf'],
    theme: 'default',
    pdfTemplate: 'default',
    pdfEngine: 'xelatex',
    status: 'draft',
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  }, null, 2));

  writeFileSync(join(dir, 'mystyle.sty'),
    '\\ProvidesPackage{mystyle}\n\\usepackage{xcolor}\n\\newcommand{\\hi}[1]{\\textcolor{blue}{\\textbf{#1}}}\n');
  writeFileSync(join(dir, 'refs.bib'),
    '@article{knuth1984,\n  author = {Donald E. Knuth},\n  title = {Literate Programming},\n'
    + '  journal = {The Computer Journal},\n  year = {1984},\n  volume = {27},\n  pages = {97--111}\n}\n');
  writeFileSync(join(dir, 'sections', 'intro.tex'),
    '\\section{Introduction}\\label{sec:intro}\nA local package gives \\hi{highlighted text}, '
    + 'and this cites \\cite{knuth1984} while referring to Section~\\ref{sec:results}.\n');
  writeFileSync(join(dir, 'sections', 'results.tex'),
    '\\section{Results}\\label{sec:results}\nBack to Section~\\ref{sec:intro}.\n'
    + '\\begin{figure}[htbp]\\centering\\includegraphics[width=0.3\\linewidth]{figures/box}'
    + '\\caption{A figure.}\\label{fig:box}\\end{figure}\n'
    + '\\begin{equation}\\label{eq:main}\\int_0^1 x^2\\,dx = \\frac{1}{3}\\end{equation}\n'
    + 'Equation~\\eqref{eq:main} is elementary.\n');
  writeFileSync(join(dir, 'main.tex'),
    '\\documentclass[11pt,a4paper]{article}\n\\usepackage[margin=2.5cm]{geometry}\n'
    + '\\usepackage{amsmath}\n\\usepackage{graphicx}\n\\usepackage{mystyle}\n\n'
    + '\\title{A Multi-file Project}\\author{MDTeX}\\date{}\n\n'
    + '\\begin{document}\\maketitle\n\\input{sections/intro}\n\\input{sections/results}\n'
    + '\\bibliographystyle{plain}\n\\bibliography{refs}\n\\end{document}\n');
  writeFileSync(join(dir, 'figures', 'box.png'), Buffer.from(PIXEL_PNG, 'base64'));
}

main().catch((e) => {
  console.error('\nWorkflow check failed:', e);
  process.exit(1);
});
