import { renderMarkdown, resolveCssVariables, validate } from './browser-compiler.js';
import { getSnippetsGrouped, applySnippet, handleAutoClose, BUILTIN_SNIPPETS } from './snippets.js';
import { el, clear, mount, toast, contextMenu, confirmDialog, promptDialog, modal, field, relativeTime } from './ui-kit.js';
import { api, backend, connect } from './api.js';
import { app, on, emit, invalidateTarget, currentLanguage } from './state.js';
import { fitDisplayMath, observeMathFit } from './math-fit.js';
import { importImage, resolvePreviewAssets, rewriteAssetHtml, refreshAssetManifest, noteAsset } from './assets.js';
import { initLibrary, refreshLibrary, createArticle, createFolder, openProperties, render as renderLibrary } from './library-panel.js';
import { initAiPanel, refreshAi, openQuickConnect } from './ai-panel.js';
import {
  initBuildPanel, prepareTarget, copyTarget, exportTarget, compilePdf, showLatexSetup, appendBuildLog,
} from './build-panel.js';
import { openSettings } from './settings-dialog.js';
import { initLatexView, syncLatexTabs, isLatexView } from './latex-view.js';
import { initPageProgress, beginTask, progressShownCount } from './progress.js';
import 'katex/dist/katex.min.css';

/**
 * MDTeX Studio — application shell.
 *
 * The browser owns the editor, the live preview and the interaction model.
 * Everything native — the workspace on disk, LaTeX, publishing builds, AI —
 * is the local backend's job and is reached through src/ui/api.js.
 */

const $ = (id) => document.getElementById(id);

const dom = {};
let previewTimer = null;
let autoSaveTimer = null;
let autoPrepareTimer = null;
let preferences = {};
let disposeMathObserver = null;

// ── Boot ──────────────────────────────────────────────────────────────────────

async function boot() {
  cacheDom();

  const connection = await connect();
  if (!connection.ok) {
    showDisconnected(connection.error);
    return;
  }
  app.connected = true;

  try {
    const [env, schema, themes, prefs] = await Promise.all([
      backend.env(),
      backend.workspace.schema(),
      backend.themes.list(),
      backend.preferences(),
    ]);
    app.env = env;
    app.schema = schema;
    app.themes = themes.themes;
    preferences = prefs.preferences;
    app.platform = prefs.config.default_platform || 'wechat';
  } catch (e) {
    showDisconnected(e.message);
    return;
  }

  initLibrary({
    listNode: dom.libraryList,
    searchNode: dom.librarySearch,
    onSelectArticle: (id) => openArticle(id),
  });
  initAiPanel({ root: dom.aiPanel });
  initBuildPanel({ root: dom.buildPanel });

  wireEvents();
  buildThemeSelector();
  applyPreferences();

  await refreshLibrary();
  await refreshAi();

  const lastId = localStorage.getItem('mdtex.currentArticle');
  const target = app.articles.find(a => a.id === lastId) || app.articles[0];

  if (target) {
    await openArticle(target.id);
  } else {
    showNoArticle();
  }

  updateEnvironmentUi();
  disposeMathObserver = observeMathFit(dom.previewContent);
  exposeDebugHandle();
  window.__mdtexReady = true;
}

function cacheDom() {
  dom.app = $('app');
  initPageProgress();
  dom.editor = $('editor');
  dom.editorPane = $('editor-pane');
  dom.previewContent = $('preview-content');
  dom.previewContainer = $('preview-container');
  dom.previewPane = $('preview-pane');
  dom.pdfPreview = $('pdf-preview');
  dom.pdfFrame = $('pdf-frame');
  dom.libraryPanel = $('library-panel');
  dom.libraryList = $('library-list');
  dom.librarySearch = $('library-search');
  dom.articleTitle = $('article-title');
  dom.articleMeta = $('article-meta');
  dom.saveState = $('save-state');
  dom.themeSelect = $('select-theme');
  dom.platformSelect = $('select-platform');
  dom.formatLabel = $('editor-format-label');
  dom.editorToolbar = $('editor-toolbar');
  dom.insertImage = $('btn-insert-image');
  dom.insertSnippet = $('btn-snippets');
  dom.snippetPalette = $('snippet-palette');
  dom.bottomPanel = $('bottom-panel');
  dom.aiPanel = $('ai-panel-root');
  dom.buildPanel = $('build-panel-root');
  dom.cssEditor = $('css-editor');
  dom.cssTitle = $('css-editor-title');
  dom.cssUnsaved = $('css-unsaved-indicator');
  dom.diagStats = $('diag-stats');
  dom.diagIssues = $('diag-issues');
  dom.targetState = $('target-state');
  dom.fileInput = $('file-input');
  dom.imageInput = $('image-input');
  dom.previewLabel = $('preview-platform-label');
}

function showDisconnected(message) {
  document.body.classList.add('disconnected');
  const overlay = el('div', { class: 'startup-overlay' },
    el('div', { class: 'startup-card' },
      el('h1', {}, 'MDTeX Studio'),
      el('p', { class: 'startup-error' }, 'The local backend is not reachable.'),
      el('p', { class: 'muted' }, message || ''),
      el('div', { class: 'startup-steps' },
        el('p', {}, 'Start it from a terminal:'),
        el('pre', {}, 'publisher start'),
        el('p', { class: 'muted' },
          'The same command works on Windows PowerShell, CMD and Linux/macOS shells. '
          + 'If `publisher` is not found, re-run the installer for your platform.'),
      ),
      el('button', { class: 'btn btn-primary', onClick: () => location.reload() }, 'Retry'),
    ),
  );
  document.body.append(overlay);
}

// ── Article lifecycle ─────────────────────────────────────────────────────────

async function openArticle(id) {
  await flushPendingSave();

  // The bar shows itself only if this outlives its delay. A short article opens
  // in about 20 ms and never causes a flash; a long one takes 150-200 ms, most
  // of it in the preview render, and is worth showing.
  const loading = beginTask();

  try {
    const data = await backend.workspace.article(id);
    // A second click while the first fetch was in flight owns the editor now.
    if (loading.superseded) return;

    loading.to(0.45);

    app.currentArticleId = id;
    app.currentArticle = data.article;
    app.source = data.source;
    app.dirty = false;
    app.savedAt = data.article.updatedAt;
    localStorage.setItem('mdtex.currentArticle', id);

    dom.editor.value = data.source;
    dom.editor.disabled = false;

    await loadTheme(data.article.theme || 'default');
    if (loading.superseded) return;
    loading.to(0.62);

    // Asset hashes for this article, so the preview can cache-bust correctly.
    await refreshAssetManifest(id);
    if (loading.superseded) return;

    invalidateTarget('article-changed');
    updateHeader();
    buildEditorToolbar();
    renderLibrary();

    // Rendering the preview is synchronous: markdown-it plus KaTeX for every
    // formula, then the DOM insertion and layout that dominate the cost. A
    // delay timer cannot fire while that runs, so a bar waiting to appear would
    // never appear — the render would finish first. Decide up front instead,
    // then give the browser a frame to actually paint the new width before the
    // main thread goes away.
    if (perceptiblePreview(data.source)) loading.showNow();
    await loading.paint(0.72);
    if (loading.superseded) return;

    updatePreview();
    emit('article:opened', data.article);
    loading.done();
  } catch (e) {
    loading.fail();
    toast(e.message, { type: 'error', timeout: 6000 });
  }
}

/**
 * Whether rendering this source will be felt as a wait.
 *
 * Measured in Chrome on this machine, timing updatePreview end to end — the
 * markdown pass, KaTeX, the innerHTML assignment and the layout it forces:
 *
 *     768 chars   11 ms      9 216 chars   103 ms
 *   2 304 chars   30 ms     15 360 chars   182 ms
 *   4 608 chars   48 ms     24 960 chars   356 ms
 *
 * Close enough to linear at ~0.012 ms per character, which crosses the ~80 ms
 * where a pause stops feeling instant at around 7 000. A heuristic, not a
 * promise: it decides whether to show a bar, and being wrong costs a bar that
 * was not needed or one that was missed — never a wrong result.
 */
const PERCEPTIBLE_MS = 80;
const MS_PER_CHAR = 0.012;

function perceptiblePreview(source) {
  return String(source || '').length * MS_PER_CHAR >= PERCEPTIBLE_MS;
}

function showNoArticle() {
  app.currentArticleId = null;
  app.currentArticle = null;
  app.source = '';
  dom.editor.value = '';
  dom.editor.disabled = true;
  updateHeader();
  clear(dom.previewContent);
  mount(dom.previewContent, el('div', { class: 'preview-empty' },
    el('p', {}, 'No article open'),
    el('button', { class: 'btn btn-primary', onClick: () => createArticle() }, 'Create your first article'),
  ));
}

function updateHeader() {
  const article = app.currentArticle;

  clear(dom.articleTitle);
  dom.articleTitle.append(article ? article.title : 'No article');
  dom.articleTitle.title = article ? 'Click to open article properties' : '';

  clear(dom.articleMeta);
  if (article) {
    mount(dom.articleMeta,
      el('span', { class: `format-chip ${article.sourceFormat}` },
        article.sourceFormat === 'latex' ? 'TeX' : 'MD'),
      article.series ? el('span', { class: 'series-chip' }, article.series) : null,
      ...(article.tags || []).slice(0, 3).map(t => el('span', { class: 'tag-chip' }, t)),
    );
  }

  dom.formatLabel.textContent = article?.sourceFormat === 'latex' ? 'TeX' : 'MD';
  syncLatexTabs();
  updateSaveState();
}

function updateSaveState() {
  if (!dom.saveState) return;
  if (!app.currentArticle) { dom.saveState.textContent = ''; return; }
  dom.saveState.textContent = app.dirty ? 'unsaved' : `saved ${relativeTime(app.savedAt)}`;
  dom.saveState.classList.toggle('dirty', app.dirty);
}

async function saveSource({ immediate = false } = {}) {
  if (!app.currentArticleId || !app.dirty) return;
  try {
    const result = await backend.workspace.saveSource(app.currentArticleId, app.source);
    app.dirty = false;
    app.savedAt = result.savedAt;
    updateSaveState();
  } catch (e) {
    if (immediate) toast(`Could not save: ${e.message}`, { type: 'error', timeout: 6000 });
  }
}

async function flushPendingSave() {
  clearTimeout(autoSaveTimer);
  await saveSource({ immediate: true });
}

// ── Editor ────────────────────────────────────────────────────────────────────

function onEditorInput() {
  app.source = dom.editor.value;
  app.dirty = true;
  updateSaveState();
  invalidateTarget('source-changed');
  updateTargetState();

  clearTimeout(previewTimer);
  previewTimer = setTimeout(updatePreview, 180);

  if (preferences.auto_save !== false) {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => saveSource(), 900);
  }

  scheduleAutoPrepare();
}

/**
 * Warm the platform representation in the background once editing settles.
 * The work happens on the backend, so the editor never stalls, and the eventual
 * Copy is a cache read.
 */
function scheduleAutoPrepare() {
  if (preferences.auto_prepare_target === false) return;
  clearTimeout(autoPrepareTimer);
  autoPrepareTimer = setTimeout(() => {
    if (app.target.busy || !app.source.trim()) return;
    prepareTarget({ silent: true }).then(updateTargetState).catch(() => {});
  }, 2500);
}

function handleEditorKeydown(e) {
  if (e.key === 'Tab') { e.preventDefault(); insertTab(dom.editor); return; }
  if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1) {
    if (handleAutoClose(dom.editor, e, currentLanguage())) return;
  }
}

function handleSnippetShortcuts(e) {
  if (!e.ctrlKey && !e.metaKey) return;
  const key = `Ctrl+${e.shiftKey ? 'Shift+' : ''}${e.key.toUpperCase()}`;
  const lang = currentLanguage();
  const snippet = BUILTIN_SNIPPETS.find(s => s.shortcut === key && (s.lang === lang || s.lang === 'both'));
  if (snippet) {
    e.preventDefault();
    applySnippet(dom.editor, snippet);
  }
}

function insertTab(textarea) {
  const size = Number(preferences.editor_tab_size) || 2;
  const start = textarea.selectionStart;
  const pad = ' '.repeat(size);
  textarea.value = textarea.value.slice(0, start) + pad + textarea.value.slice(textarea.selectionEnd);
  textarea.selectionStart = textarea.selectionEnd = start + size;
  textarea.dispatchEvent(new Event('input'));
}

function insertAtCursor(text) {
  const pos = dom.editor.selectionStart;
  dom.editor.value = dom.editor.value.slice(0, pos) + text + dom.editor.value.slice(dom.editor.selectionEnd);
  dom.editor.selectionStart = dom.editor.selectionEnd = pos + text.length;
  dom.editor.dispatchEvent(new Event('input'));
  dom.editor.focus();
}

function buildEditorToolbar() {
  const lang = currentLanguage();
  const buttons = lang === 'latex'
    ? [
        { label: 'B', title: 'Bold (Ctrl+B)', snippet: '\\textbf{$SELECTION$$CURSOR$}' },
        { label: 'I', title: 'Italic (Ctrl+I)', snippet: '\\textit{$SELECTION$$CURSOR$}' },
        { label: '$', title: 'Inline math (Ctrl+M)', snippet: '$$$SELECTION$$CURSOR$$$' },
        { label: '$$', title: 'Display math', snippet: '\\[\n$SELECTION$$CURSOR$\n\\]' },
        { label: '§', title: 'Section', snippet: '\\section{$CURSOR$}' },
        { label: 'fig', title: 'Figure', snippet: '\\begin{figure}[htbp]\n  \\centering\n  \\includegraphics[width=0.8\\textwidth]{$CURSOR$}\n  \\caption{}\n  \\label{fig:}\n\\end{figure}' },
      ]
    : [
        { label: 'B', title: 'Bold (Ctrl+B)', snippet: '**$SELECTION$$CURSOR$**' },
        { label: 'I', title: 'Italic (Ctrl+I)', snippet: '*$SELECTION$$CURSOR$*' },
        { label: '`', title: 'Inline code', snippet: '`$SELECTION$$CURSOR$`' },
        { label: '$', title: 'Inline math (Ctrl+M)', snippet: '$$$SELECTION$$CURSOR$$$' },
        { label: '$$', title: 'Display math', snippet: '\n$$\n$SELECTION$$CURSOR$\n$$\n' },
        { label: '[]', title: 'Link (Ctrl+K)', snippet: '[$SELECTION$]($CURSOR$)' },
        { label: '>', title: 'Blockquote', snippet: '> $SELECTION$$CURSOR$' },
      ];

  clear(dom.editorToolbar);
  for (const button of buttons) {
    dom.editorToolbar.append(el('button', {
      class: 'tb', title: button.title, type: 'button',
      onClick: () => applySnippet(dom.editor, { template: button.snippet }),
    }, button.label));
  }
}

function toggleSnippetPalette() {
  if (!dom.snippetPalette.classList.contains('hidden')) {
    dom.snippetPalette.classList.add('hidden');
    return;
  }

  clear(dom.snippetPalette);
  const groups = getSnippetsGrouped(currentLanguage());
  for (const [category, items] of Object.entries(groups)) {
    dom.snippetPalette.append(el('div', { class: 'snippet-category' }, category));
    for (const snippet of items) {
      dom.snippetPalette.append(el('button', {
        class: 'snippet-item', type: 'button',
        onClick: () => {
          applySnippet(dom.editor, snippet);
          dom.snippetPalette.classList.add('hidden');
        },
      },
        el('span', {}, snippet.label),
        snippet.shortcut ? el('span', { class: 'snippet-shortcut' }, snippet.shortcut) : null,
      ));
    }
  }
  dom.snippetPalette.classList.remove('hidden');
}

// ── Images ────────────────────────────────────────────────────────────────────

/**
 * The single image-import path.
 *
 * The toolbar button, drag-and-drop and clipboard paste all land here, so there
 * is exactly one asset-path behaviour rather than three. The reference is
 * inserted only after the backend has copied the file and verified it exists.
 */
async function insertImageFile(file, { caretOffset = null } = {}) {
  if (!app.currentArticleId) {
    toast('Open an article before inserting images.', { type: 'error' });
    return;
  }

  if (caretOffset !== null) {
    dom.editor.selectionStart = dom.editor.selectionEnd = caretOffset;
  }

  try {
    const asset = await importImage(file);
    insertAtCursor(asset.reference);
    // The manifest already knows the new hash, so the preview resolves it on
    // this render — no restart, no reopening the article.
    updatePreview();
    toast(asset.reused
      ? `Reused the identical image already stored as ${asset.name}.`
      : `Inserted ${asset.name}.`);
  } catch (e) {
    toast(`Could not store the image: ${e.message}`, { type: 'error', timeout: 7000 });
  }
}

function handleDrop(e) {
  e.preventDefault();
  dom.editorPane.classList.remove('dragover');

  const file = e.dataTransfer?.files?.[0];
  if (!file) return;

  // The LaTeX view is generated and read-only. Inserting into the editor
  // underneath it would change the article with nothing on screen to show it.
  if (isLatexView() && file.type.startsWith('image/')) {
    toast('Switch to the Markdown tab to insert an image.', { type: 'error' });
    return;
  }

  const caret = caretFromPoint(e.clientX, e.clientY);

  if (file.type.startsWith('image/')) {
    insertImageFile(file, { caretOffset: caret });
    return;
  }
  if (/\.(md|markdown|txt|tex|ltx)$/i.test(file.name)) {
    importFile(file);
  }
}

/** Estimate a caret offset from a drop point inside the textarea. */
function caretFromPoint(x, y) {
  const rect = dom.editor.getBoundingClientRect();
  const style = getComputedStyle(dom.editor);
  const lineHeight = parseFloat(style.lineHeight) || 22;
  const paddingLeft = parseFloat(style.paddingLeft) || 12;
  const paddingTop = parseFloat(style.paddingTop) || 12;

  // Measure the monospace advance width once rather than guessing it.
  const probe = el('span', {
    style: {
      position: 'absolute', visibility: 'hidden', whiteSpace: 'pre',
      font: style.font, fontFamily: style.fontFamily, fontSize: style.fontSize,
    },
  }, '0'.repeat(100));
  document.body.append(probe);
  const charWidth = probe.getBoundingClientRect().width / 100;
  probe.remove();
  if (!charWidth) return null;

  const row = Math.floor((y - rect.top - paddingTop + dom.editor.scrollTop) / lineHeight);
  const col = Math.round((x - rect.left - paddingLeft + dom.editor.scrollLeft) / charWidth);

  const lines = dom.editor.value.split('\n');
  const clampedRow = Math.max(0, Math.min(row, lines.length - 1));

  let offset = 0;
  for (let i = 0; i < clampedRow; i++) offset += lines[i].length + 1;
  offset += Math.max(0, Math.min(col, lines[clampedRow].length));

  return Math.min(offset, dom.editor.value.length);
}

async function importFile(file) {
  const content = await file.text();
  try {
    const { article } = await backend.workspace.import({ name: file.name, content });
    await refreshLibrary();
    await openArticle(article.id);
    toast(`Imported “${article.title}”.`);
  } catch (e) {
    toast(e.message, { type: 'error' });
  }
}

// ── Theme ─────────────────────────────────────────────────────────────────────

async function loadTheme(name) {
  try {
    const theme = await backend.themes.read(name);
    app.themeName = theme.name;
    app.themeCss = theme.css;
    app.themeEditable = theme.editable;
  } catch {
    app.themeName = 'default';
    app.themeCss = '';
    app.themeEditable = false;
  }
  if (dom.themeSelect) dom.themeSelect.value = app.themeName;
  updateCssEditor();
}

function buildThemeSelector() {
  clear(dom.themeSelect);
  const builtin = app.themes.filter(t => t.source === 'builtin');
  const user = app.themes.filter(t => t.source === 'user');

  for (const [label, items] of [['Built-in', builtin], ['Custom', user]]) {
    if (!items.length) continue;
    const group = el('optgroup', { label });
    for (const theme of items) group.append(el('option', { value: theme.name }, theme.name));
    dom.themeSelect.append(group);
  }
  dom.themeSelect.value = app.themeName;
}

function updateCssEditor() {
  if (!dom.cssEditor) return;
  dom.cssEditor.value = app.themeCss;
  dom.cssEditor.dataset.original = app.themeCss;
  dom.cssEditor.readOnly = false;
  dom.cssTitle.textContent = `Style: ${app.themeName}${app.themeEditable ? '' : ' (built-in)'}`;
  dom.cssUnsaved.classList.add('hidden');
  $('btn-css-save').disabled = !app.themeEditable;
  $('btn-css-rename').disabled = !app.themeEditable;
  $('btn-css-delete').disabled = !app.themeEditable;
}

async function saveTheme() {
  const css = dom.cssEditor.value;
  if (!app.themeEditable) {
    const name = await promptDialog({
      title: 'Save as a new theme',
      label: 'Theme name',
      value: `${app.themeName}-custom`,
      hint: 'Built-in themes are read-only. Saving creates an editable copy.',
      confirmLabel: 'Create theme',
      validate: (v) => (v.trim() ? null : 'A name is required.'),
    });
    if (name === undefined) return;
    await backend.themes.create({ name, css });
    app.themes = (await backend.themes.list()).themes;
    buildThemeSelector();
    await loadTheme(name);
    await setArticleTheme(name);
    toast(`Theme “${name}” created.`);
    return;
  }

  await backend.themes.save(app.themeName, css);
  app.themeCss = css;
  dom.cssEditor.dataset.original = css;
  dom.cssUnsaved.classList.add('hidden');
  invalidateTarget('theme-saved');
  updateTargetState();
  toast('Theme saved.');
}

async function setArticleTheme(name) {
  if (!app.currentArticleId) return;
  await backend.workspace.saveMeta(app.currentArticleId, { theme: name });
  if (app.currentArticle) app.currentArticle.theme = name;
}

// ── Preview ───────────────────────────────────────────────────────────────────

function updatePreview() {
  const source = app.source;

  if (!source.trim()) {
    clear(dom.previewContent);
    dom.previewContent.append(el('div', { class: 'preview-empty' }, el('p', {}, 'Start writing…')));
    dom.diagStats.textContent = '';
    dom.diagIssues.textContent = '';
    return;
  }

  if (currentLanguage() === 'latex') {
    clear(dom.previewContent);
    dom.previewContent.append(el('div', { id: 'nice', class: 'latex-source-preview' }, source));
    dom.diagStats.textContent = `LaTeX · ${source.split('\n').length} lines · ${source.length} chars`;
    dom.diagIssues.textContent = 'Compile a PDF to see the typeset result.';
    dom.diagIssues.className = '';
    return;
  }

  const rawHtml = renderMarkdown(source);
  const css = resolveCssVariables(app.themeCss);

  // The preview keeps KaTeX HTML: it is fast, selectable, and never leaves the
  // browser. Publishing output is a different renderer and runs on the backend.
  // Article-relative assets cannot be loaded by the browser directly, so point
  // them at the backend *before* the HTML enters the document — otherwise the
  // browser fires off a request for `assets/…` that is guaranteed to fail. The
  // rewrite applies to the rendered HTML only; the source is untouched.
  dom.previewContent.innerHTML = `<style>${css}</style>\n${rewriteAssetHtml(rawHtml)}`;

  resolvePreviewAssets(dom.previewContent);

  fitDisplayMath(dom.previewContent);

  const result = validate(rawHtml, source, app.platform);
  dom.diagStats.textContent =
    `${result.stats.paragraphs}P · ${result.stats.headings}H · ${result.stats.mathTotal} math · `
    + `${result.stats.codeBlocks} code · ${result.stats.images} img · ${result.stats.tables} tbl`;

  const issues = [
    ...result.errors.map(e => `error: ${e}`),
    ...result.warnings.map(w => `warning: ${w}`),
  ];
  dom.diagIssues.textContent = issues.join(' · ');
  dom.diagIssues.className = result.errors.length ? 'error' : result.warnings.length ? 'warning' : '';
}

function updateTargetState() {
  if (!dom.targetState) return;
  const label = app.platform === 'wechat' ? 'WeChat' : 'Zhihu';
  if (app.target.busy) {
    dom.targetState.textContent = `${label}: compiling…`;
    dom.targetState.className = 'target-state busy';
  } else if (app.target.prepared) {
    dom.targetState.textContent = `${label}: ready`;
    dom.targetState.className = 'target-state ready';
  } else {
    dom.targetState.textContent = `${label}: not compiled`;
    dom.targetState.className = 'target-state stale';
  }
}

// ── PDF preview ───────────────────────────────────────────────────────────────

function showPdfPreview(pdf) {
  dom.previewPane.classList.add('showing-pdf');
  dom.pdfFrame.src = pdf.url;
  dom.previewLabel.textContent = 'PDF';
}

function hidePdfPreview() {
  dom.previewPane.classList.remove('showing-pdf');
  dom.pdfFrame.src = 'about:blank';
  dom.previewLabel.textContent = app.platform === 'wechat' ? 'WeChat' : 'Zhihu';
}

// ── Environment-driven UI ─────────────────────────────────────────────────────

function updateEnvironmentUi() {
  const latexOk = Boolean(app.env?.latex?.available);
  const pdfButton = $('btn-compile-pdf');
  if (pdfButton) {
    pdfButton.classList.toggle('needs-setup', !latexOk);
    pdfButton.title = latexOk
      ? `Compile PDF with ${app.env.latex.defaultEngine}`
      : 'LaTeX is not installed — click to see setup instructions';
  }
}

function applyPreferences() {
  if (preferences.editor_font_size) dom.editor.style.fontSize = `${preferences.editor_font_size}px`;
  if (preferences.editor_tab_size) dom.editor.style.tabSize = String(preferences.editor_tab_size);
}

// ── Wiring ────────────────────────────────────────────────────────────────────

function wireEvents() {
  initLatexView({
    editor: dom.editor,
    editorTools: [dom.insertImage, dom.insertSnippet],
    onBeforeLeaveEditor: flushPendingSave,
    // Adoption rewrites the article on disk: reopening is what makes the editor
    // show the LaTeX that is now the source, rather than the Markdown that is
    // no longer there.
    onSourceAdopted: () => openArticle(app.currentArticleId),
  });

  dom.editor.addEventListener('input', onEditorInput);
  dom.editor.addEventListener('keydown', handleEditorKeydown);
  dom.editor.addEventListener('keydown', handleSnippetShortcuts);
  dom.editor.addEventListener('paste', (e) => {
    for (const item of e.clipboardData?.items || []) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        insertImageFile(item.getAsFile());
        return;
      }
    }
  });

  dom.editorPane.addEventListener('dragover', (e) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    if (isLatexView()) return;
    e.preventDefault();
    dom.editorPane.classList.add('dragover');
  });
  dom.editorPane.addEventListener('dragleave', () => dom.editorPane.classList.remove('dragover'));
  dom.editorPane.addEventListener('drop', handleDrop);

  dom.themeSelect.addEventListener('change', async () => {
    await loadTheme(dom.themeSelect.value);
    await setArticleTheme(dom.themeSelect.value);
    invalidateTarget('theme-changed');
    updateTargetState();
    updatePreview();
  });

  dom.platformSelect.addEventListener('change', () => {
    app.platform = dom.platformSelect.value;
    dom.previewLabel.textContent = app.platform === 'wechat' ? 'WeChat' : 'Zhihu';
    invalidateTarget('platform-changed');
    updateTargetState();
    updatePreview();
  });

  dom.articleTitle.addEventListener('click', () => {
    if (app.currentArticleId) openProperties(app.currentArticleId);
  });

  $('btn-new-article').addEventListener('click', () => createArticle());
  $('btn-new-folder').addEventListener('click', () => createFolder());
  $('btn-open').addEventListener('click', () => dom.fileInput.click());
  dom.fileInput.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) importFile(file);
    dom.fileInput.value = '';
  });

  $('btn-insert-image').addEventListener('click', () => dom.imageInput.click());
  dom.imageInput.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) insertImageFile(file);
    dom.imageInput.value = '';
  });

  $('btn-snippets').addEventListener('click', toggleSnippetPalette);
  document.addEventListener('click', (e) => {
    if (!dom.snippetPalette.contains(e.target) && e.target !== $('btn-snippets')) {
      dom.snippetPalette.classList.add('hidden');
    }
  });

  $('btn-toggle-library').addEventListener('click', () => {
    dom.libraryPanel.classList.toggle('collapsed');
    localStorage.setItem('mdtex.libraryVisible', String(!dom.libraryPanel.classList.contains('collapsed')));
  });
  if (localStorage.getItem('mdtex.libraryVisible') === 'false') {
    dom.libraryPanel.classList.add('collapsed');
  }

  $('btn-prepare').addEventListener('click', async () => {
    openPanel('build');
    await prepareTarget({ force: true });
    updateTargetState();
  });
  $('btn-copy-rich').addEventListener('click', async () => {
    await copyTarget();
    updateTargetState();
  });
  $('btn-copy-html').addEventListener('click', () => copyTarget({ asPlainHtml: true }));
  $('btn-export').addEventListener('click', () => exportTarget());

  $('btn-compile-pdf').addEventListener('click', () => {
    if (!app.env?.latex?.available) return showLatexSetup();
    return compilePdf();
  });

  $('btn-settings').addEventListener('click', () => openSettings());
  $('btn-toggle-ai').addEventListener('click', () => openPanel('ai'));
  $('btn-edit-css').addEventListener('click', () => openPanel('css'));
  $('btn-close-bottom').addEventListener('click', () => dom.bottomPanel.classList.add('hidden'));
  $('btn-close-pdf').addEventListener('click', hidePdfPreview);

  for (const tab of dom.bottomPanel.querySelectorAll('.bottom-tab')) {
    tab.addEventListener('click', () => openPanel(tab.dataset.tab));
  }

  dom.cssEditor.addEventListener('input', () => {
    const dirty = dom.cssEditor.value !== dom.cssEditor.dataset.original;
    dom.cssUnsaved.classList.toggle('hidden', !dirty);
    app.themeCss = dom.cssEditor.value;
    invalidateTarget('theme-edited');
    updateTargetState();
    clearTimeout(previewTimer);
    previewTimer = setTimeout(updatePreview, 180);
  });
  dom.cssEditor.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') { e.preventDefault(); insertTab(dom.cssEditor); }
  });

  $('btn-css-save').addEventListener('click', () => saveTheme());
  $('btn-css-save-as').addEventListener('click', async () => {
    const name = await promptDialog({
      title: 'Save theme as',
      label: 'Theme name',
      value: `${app.themeName}-copy`,
      confirmLabel: 'Create',
      validate: (v) => (v.trim() ? null : 'A name is required.'),
    });
    if (name === undefined) return;
    await backend.themes.create({ name, css: dom.cssEditor.value });
    app.themes = (await backend.themes.list()).themes;
    buildThemeSelector();
    await loadTheme(name);
    await setArticleTheme(name);
    toast(`Theme “${name}” created.`);
  });
  $('btn-css-rename').addEventListener('click', async () => {
    const name = await promptDialog({
      title: 'Rename theme', label: 'Theme name', value: app.themeName, confirmLabel: 'Rename',
      validate: (v) => (v.trim() ? null : 'A name is required.'),
    });
    if (name === undefined || name === app.themeName) return;
    await backend.themes.rename(app.themeName, name);
    app.themes = (await backend.themes.list()).themes;
    buildThemeSelector();
    await loadTheme(name);
    await setArticleTheme(name);
    toast('Theme renamed.');
  });
  $('btn-css-delete').addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Delete theme?',
      message: `“${app.themeName}” will be removed from disk.`,
      confirmLabel: 'Delete', danger: true,
    });
    if (!ok) return;
    await backend.themes.remove(app.themeName);
    app.themes = (await backend.themes.list()).themes;
    buildThemeSelector();
    await loadTheme('default');
    await setArticleTheme('default');
    updatePreview();
    toast('Theme deleted.');
  });
  $('btn-css-revert').addEventListener('click', () => {
    dom.cssEditor.value = dom.cssEditor.dataset.original;
    app.themeCss = dom.cssEditor.value;
    dom.cssUnsaved.classList.add('hidden');
    updatePreview();
  });

  // App-level shortcuts.
  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;

    if (e.key === 's') { e.preventDefault(); flushPendingSave().then(() => toast('Saved.')); }
    else if (e.key === 'n' && e.shiftKey) { e.preventDefault(); createArticle(); }
    else if (e.key === 'i' && !e.shiftKey && app.currentArticleId) { e.preventDefault(); openProperties(app.currentArticleId); }
    else if (e.key === 'p' && e.shiftKey) { e.preventDefault(); compilePdf(); }
    else if (e.key === 'f' && e.shiftKey) { e.preventDefault(); dom.librarySearch.focus(); }
    else if (e.key === ',') { e.preventDefault(); openSettings(); }
  });

  window.addEventListener('beforeunload', () => {
    if (app.dirty && app.currentArticleId) {
      navigator.sendBeacon?.(
        `${api.base}/workspace/article/${encodeURIComponent(app.currentArticleId)}/source?token=${encodeURIComponent(api.token)}`,
        new Blob([JSON.stringify({ source: app.source })], { type: 'application/json' }),
      );
    }
  });

  on('target:changed', updateTargetState);
  on('target:busy', updateTargetState);
  on('target:progress', ({ message }) => {
    if (dom.targetState) {
      dom.targetState.textContent = message;
      dom.targetState.className = 'target-state busy';
    }
  });
  on('target:invalidate', () => { invalidateTarget('external'); updateTargetState(); });
  on('panel:open', (tab) => openPanel(tab));
  on('preview:show-pdf', showPdfPreview);
  on('env:changed', updateEnvironmentUi);
  on('preferences:changed', (patch) => {
    Object.assign(preferences, patch);
    applyPreferences();
  });
  on('article:metadata-changed', async () => {
    if (app.currentArticleId) {
      const data = await backend.workspace.article(app.currentArticleId);
      app.currentArticle = data.article;
      updateHeader();
      if (data.article.theme !== app.themeName) {
        await loadTheme(data.article.theme);
        updatePreview();
      }
    }
  });
  on('article:none', showNoArticle);
  on('ai:applied', async (result) => {
    if (result.source !== undefined && result.source !== app.source) {
      app.source = result.source;
      dom.editor.value = result.source;
      app.dirty = false;
      app.savedAt = new Date().toISOString();
      updateSaveState();
      invalidateTarget('ai-edit');
      updatePreview();
    }
    if (result.themeCss && result.themeName === app.themeName) {
      app.themeCss = result.themeCss;
      updateCssEditor();
      invalidateTarget('ai-theme-edit');
      updatePreview();
    }
    await refreshLibrary();
    updateTargetState();
  });
  on('editor:goto-line', (line) => {
    const lines = dom.editor.value.split('\n');
    let offset = 0;
    for (let i = 0; i < Math.min(line - 1, lines.length); i++) offset += lines[i].length + 1;
    dom.editor.focus();
    dom.editor.setSelectionRange(offset, offset + (lines[line - 1]?.length || 0));
  });
}

/**
 * A read-only view of the application state.
 *
 * Used by scripts/e2e.js to assert on real internals rather than on rendered
 * text, and useful when diagnosing a report from a user's own browser.
 */
function exposeDebugHandle() {
  Object.defineProperty(window, '__mdtex', {
    value: {
      get state() {
        return {
          connected: app.connected,
          articleId: app.currentArticleId,
          // How many times the loading bar has actually been shown. The
          // verification scripts assert both that it appears for a slow load
          // and that it stays away for a fast one.
          progressShown: progressShownCount(),
          // Where the open article lives and what it is. The verification
          // scripts need this to find its files on disk without guessing at
          // the workspace layout.
          article: app.currentArticle ? {
            id: app.currentArticle.id,
            folder: app.currentArticle.folder ?? '',
            dirName: app.currentArticle.dirName,
            sourceFormat: app.currentArticle.sourceFormat,
            sourceFile: app.currentArticle.sourceFile,
            language: app.currentArticle.language,
          } : null,
          platform: app.platform,
          theme: app.themeName,
          dirty: app.dirty,
          target: {
            key: app.target.key,
            prepared: app.target.prepared,
            bytes: app.target.bytes,
            hasBytesInMemory: app.target.html != null,
            busy: app.target.busy,
          },
          pdf: { path: app.pdf.path },
          ai: { activeProfileId: app.ai.activeProfileId, profiles: app.ai.profiles.length },
        };
      },
      version: api.version,

      // A deterministic way for the verification scripts to set up and open
      // articles without driving dialogs, so a check about loading behaviour
      // is not also a check about the New Article form.
      debug: {
        async createArticle(title, content = '') {
          const created = await backend.workspace.create({ title, language: 'en' });
          if (content) await backend.workspace.saveSource(created.article.id, content);
          await refreshLibrary();
          return created.article.id;
        },
        openArticle: (id) => openArticle(id),
      },
    },
    writable: false,
    configurable: true,
  });
}

function openPanel(tab) {
  dom.bottomPanel.classList.remove('hidden');
  for (const node of dom.bottomPanel.querySelectorAll('.bottom-tab')) {
    node.classList.toggle('active', node.dataset.tab === tab);
  }
  for (const node of dom.bottomPanel.querySelectorAll('.bottom-tab-content')) {
    node.classList.toggle('active', node.dataset.tab === tab);
  }
}

boot();
