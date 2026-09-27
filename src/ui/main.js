import { renderMarkdown, resolveCssVariables, scopeThemeCss, validate } from './browser-compiler.js';
import { getSnippetsGrouped, applySnippet, handleAutoClose, BUILTIN_SNIPPETS } from './snippets.js';
import { el, clear, mount, toast, contextMenu, confirmDialog, promptDialog, modal, field, relativeTime } from './ui-kit.js';
import { api, backend, connect } from './api.js';
import { app, on, emit, invalidateTarget, currentLanguage } from './state.js';
import { fitDisplayMath, observeMathFit } from './math-fit.js';
import { importImage, resolvePreviewAssets, rewriteAssetHtml, refreshAssetManifest, noteAsset } from './assets.js';
import { initLibrary, refreshLibrary, createArticle, createFolder, openProperties, render as renderLibrary } from './library-panel.js';
import { initAiPanel, refreshAi, openQuickConnect } from './ai-panel.js';
import { showProposal, clearProposal, isReviewing, flashApplied } from './ai-highlight.js';
import {
  initBuildPanel, prepareTarget, copyTarget, exportTarget, compilePdf, showLatexSetup, appendBuildLog,
} from './build-panel.js';
import { openSettings } from './settings-dialog.js';
import { initLatexView, syncLatexTabs, isPreviewView, primaryTabLabel } from './latex-view.js';
import { initPageProgress, beginTask, progressShownCount } from './progress.js';
import { t, translateDom, getLanguage, setLanguagePreference, LANGUAGES } from './i18n.js';
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
  // The language guessed from the last session (localStorage), so the loading
  // screen already speaks it; the stored preference confirms it below.
  document.documentElement.lang = LANGUAGES.find(l => l.value === getLanguage())?.htmlLang || 'en';
  translateDom();
  cacheDom();

  bootProgress(0.1, t('app.boot.connecting'));
  const connection = await connect();
  if (!connection.ok) {
    bootFailed(t('app.startup.unreachable'));
    showDisconnected(connection.error);
    return;
  }
  app.connected = true;

  // Detecting the LaTeX installation means probing for a dozen executables and
  // is by far the slowest thing here — measured at 636 ms on this machine, and
  // longer on Windows. Nothing on screen depends on it: the library, the
  // editor and the preview are all ready without it, and the two places that
  // do care wait for `app.envReady` at the point of use. So it runs alongside
  // rather than in front, and the articles no longer queue behind it.
  app.envReady = backend.env()
    .then((env) => { app.env = env; updateEnvironmentUi(); return env; })
    .catch(() => null);

  try {
    bootProgress(0.28, t('app.boot.loadingSettings'));
    const [schema, themes, prefs] = await Promise.all([
      backend.workspace.schema(),
      backend.themes.list(),
      backend.preferences(),
    ]);
    app.schema = schema;
    app.themes = themes.themes;
    preferences = prefs.preferences;
    // Before anything renders dynamic text: if the saved language differs from
    // the boot guess, the static markup is translated again now.
    if (setLanguagePreference(preferences.ui_language || 'auto')) translateDom();
    app.platform = prefs.config.default_platform || 'wechat';
  } catch (e) {
    bootFailed(e.message);
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

  bootProgress(0.5, t('app.boot.readingWorkspace'));
  await refreshLibrary();
  bootProgress(0.66, t('app.boot.readingWorkspace'), t('app.boot.articleCount', { n: app.articles.length }));

  await refreshAi();

  const lastId = localStorage.getItem('mdtex.currentArticle');
  const target = app.articles.find(a => a.id === lastId) || app.articles[0];

  if (target) {
    bootProgress(0.82, t('app.boot.openingLast'), target.title);
    // The overlay is still up, so the per-article bar underneath it would be
    // covered anyway; painting first is what makes this last step visible.
    await bootPaint();
    await openArticle(target.id);
  } else {
    showNoArticle();
  }

  bootProgress(1, t('app.boot.ready'));
  disposeMathObserver = observeMathFit(dom.previewContent);
  exposeDebugHandle();
  bootDone();
  window.__mdtexReady = true;
}

// ── Boot indicator ────────────────────────────────────────────────────────────
//
// The overlay is in index.html, so it is on screen from the first paint rather
// than from whenever the bundle finishes parsing. Its job is to answer one
// question — is this working, or has it lost my articles — so it names the
// step it is on rather than showing an unlabelled spinner.

function bootProgress(fraction, status, detail = '') {
  const fill = document.getElementById('boot-bar-fill');
  const label = document.getElementById('boot-status');
  const note = document.getElementById('boot-detail');
  if (fill) fill.style.width = `${Math.round(fraction * 100)}%`;
  if (label && status) label.textContent = status;
  if (note) note.textContent = detail;
}

function bootFailed(message) {
  const label = document.getElementById('boot-status');
  if (label) {
    label.textContent = message;
    label.classList.add('error');
  }
  bootDone(0);
}

/** Let the browser paint what was just set, before a blocking step. */
function bootPaint() {
  return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

function bootDone(delay = 160) {
  const overlay = document.getElementById('boot-overlay');
  if (!overlay) return;
  setTimeout(() => {
    overlay.classList.add('leaving');
    // Removed rather than hidden: an invisible full-screen layer that still
    // exists is a layer that can still swallow a click.
    setTimeout(() => overlay.remove(), 320);
  }, delay);
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
      el('p', { class: 'startup-error' }, t('app.startup.unreachable')),
      el('p', { class: 'muted' }, message || ''),
      el('div', { class: 'startup-steps' },
        el('p', {}, t('app.startup.fromTerminal')),
        el('pre', {}, 'publisher start'),
        el('p', { class: 'muted' }, t('app.startup.hint')),
      ),
      el('button', { class: 'btn btn-primary', onClick: () => location.reload() }, t('app.startup.retry')),
    ),
  );
  document.body.append(overlay);
}

// ── Article lifecycle ─────────────────────────────────────────────────────────

async function openArticle(id) {
  await flushPendingSave();
  // A proposal belongs to the article it was made for.
  clearProposal();

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
    // formula, then the DOM insertion and layout that dominate the cost. The
    // bar cannot move while that runs, so it is moved first and given a frame
    // to actually reach the screen before the main thread goes away.
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

function showNoArticle() {
  app.currentArticleId = null;
  app.currentArticle = null;
  app.source = '';
  dom.editor.value = '';
  dom.editor.disabled = true;
  updateHeader();
  clear(dom.previewContent);
  mount(dom.previewContent, el('div', { class: 'preview-empty' },
    el('p', {}, t('app.preview.noArticle')),
    el('button', { class: 'btn btn-primary', onClick: () => createArticle() }, t('app.preview.createFirst')),
  ));
}

function updateHeader() {
  const article = app.currentArticle;

  clear(dom.articleTitle);
  dom.articleTitle.append(article ? article.title : t('app.header.noArticle'));
  dom.articleTitle.title = article ? t('app.header.openProperties') : '';

  clear(dom.articleMeta);
  if (article) {
    mount(dom.articleMeta,
      el('span', { class: `format-chip ${article.sourceFormat}` },
        article.sourceFormat === 'latex' ? 'TeX' : 'MD'),
      article.series ? el('span', { class: 'series-chip' }, article.series) : null,
      ...(article.tags || []).slice(0, 3).map(tag => el('span', { class: 'tag-chip' }, tag)),
    );
  }

  dom.formatLabel.textContent = article?.sourceFormat === 'latex' ? 'TeX' : 'MD';
  syncLatexTabs();
  updateSaveState();
}

function updateSaveState() {
  if (!dom.saveState) return;
  if (!app.currentArticle) { dom.saveState.textContent = ''; return; }
  dom.saveState.textContent = app.dirty ? t('app.save.unsaved') : t('app.save.savedAgo', { when: relativeTime(app.savedAt) });
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
    if (immediate) toast(t('app.save.failed', { message: e.message }), { type: 'error', timeout: 6000 });
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
        { label: 'B', title: t('app.fmt.bold'), snippet: '\\textbf{$SELECTION$$CURSOR$}' },
        { label: 'I', title: t('app.fmt.italic'), snippet: '\\textit{$SELECTION$$CURSOR$}' },
        { label: '$', title: t('app.fmt.inlineMath'), snippet: '$$$SELECTION$$CURSOR$$$' },
        { label: '$$', title: t('app.fmt.displayMath'), snippet: '\\[\n$SELECTION$$CURSOR$\n\\]' },
        { label: '§', title: t('app.fmt.section'), snippet: '\\section{$CURSOR$}' },
        { label: 'fig', title: t('app.fmt.figure'), snippet: '\\begin{figure}[htbp]\n  \\centering\n  \\includegraphics[width=0.8\\textwidth]{$CURSOR$}\n  \\caption{}\n  \\label{fig:}\n\\end{figure}' },
      ]
    : [
        { label: 'B', title: t('app.fmt.bold'), snippet: '**$SELECTION$$CURSOR$**' },
        { label: 'I', title: t('app.fmt.italic'), snippet: '*$SELECTION$$CURSOR$*' },
        { label: '`', title: t('app.fmt.inlineCode'), snippet: '`$SELECTION$$CURSOR$`' },
        { label: '$', title: t('app.fmt.inlineMath'), snippet: '$$$SELECTION$$CURSOR$$$' },
        { label: '$$', title: t('app.fmt.displayMath'), snippet: '\n$$\n$SELECTION$$CURSOR$\n$$\n' },
        { label: '[]', title: t('app.fmt.link'), snippet: '[$SELECTION$]($CURSOR$)' },
        { label: '>', title: t('app.fmt.blockquote'), snippet: '> $SELECTION$$CURSOR$' },
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
    toast(t('app.image.openFirst'), { type: 'error' });
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
      ? t('app.image.reused', { name: asset.name })
      : t('app.image.inserted', { name: asset.name }));
  } catch (e) {
    toast(t('app.image.failed', { message: e.message }), { type: 'error', timeout: 7000 });
  }
}

function handleDrop(e) {
  e.preventDefault();
  dom.editorPane.classList.remove('dragover');

  const file = e.dataTransfer?.files?.[0];
  if (!file) return;

  // A preview tab is generated and read-only. Inserting into the editor
  // underneath it would change the article with nothing on screen to show it.
  if (isPreviewView() && file.type.startsWith('image/')) {
    toast(t('app.image.switchTab', { tab: primaryTabLabel() }), { type: 'error' });
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
    toast(t('app.import.done', { title: article.title }));
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
  const builtin = app.themes.filter(theme => theme.source === 'builtin');
  const user = app.themes.filter(theme => theme.source === 'user');

  for (const [label, items] of [[t('app.theme.groupBuiltin'), builtin], [t('app.theme.groupCustom'), user]]) {
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
  dom.cssTitle.textContent = t(app.themeEditable ? 'app.css.title' : 'app.css.titleBuiltin', { name: app.themeName });
  dom.cssUnsaved.classList.add('hidden');
  $('btn-css-save').disabled = !app.themeEditable;
  $('btn-css-rename').disabled = !app.themeEditable;
  $('btn-css-delete').disabled = !app.themeEditable;
}

async function saveTheme() {
  const css = dom.cssEditor.value;
  if (!app.themeEditable) {
    const name = await promptDialog({
      title: t('app.theme.saveAsNewTitle'),
      label: t('app.theme.nameLabel'),
      value: `${app.themeName}-custom`,
      hint: t('app.theme.builtinReadonly'),
      confirmLabel: t('app.theme.createTheme'),
      validate: (v) => (v.trim() ? null : t('app.theme.nameRequired')),
    });
    if (name === undefined) return;
    await backend.themes.create({ name, css });
    app.themes = (await backend.themes.list()).themes;
    buildThemeSelector();
    await loadTheme(name);
    await setArticleTheme(name);
    toast(t('app.theme.created', { name }));
    return;
  }

  await backend.themes.save(app.themeName, css);
  app.themeCss = css;
  dom.cssEditor.dataset.original = css;
  dom.cssUnsaved.classList.add('hidden');
  invalidateTarget('theme-saved');
  updateTargetState();
  toast(t('app.theme.saved'));
}

async function setArticleTheme(name) {
  if (!app.currentArticleId) return;
  await backend.workspace.saveMeta(app.currentArticleId, { theme: name });
  if (app.currentArticle) app.currentArticle.theme = name;
}

// ── Preview ───────────────────────────────────────────────────────────────────

/**
 * Put rendered Markdown HTML into the preview and return its #nice root.
 *
 * The preview keeps KaTeX HTML: it is fast, selectable, and never leaves the
 * browser. Publishing output is a different renderer and runs on the backend.
 * Article-relative assets cannot be loaded by the browser directly, so point
 * them at the backend *before* the HTML enters the document — otherwise the
 * browser fires off a request for `assets/…` that is guaranteed to fail. The
 * rewrite applies to the rendered HTML only; the source is untouched.
 */
function paintPreview(rawHtml) {
  const css = scopeThemeCss(resolveCssVariables(app.themeCss));
  dom.previewContent.innerHTML = `<style>${css}</style>\n${rewriteAssetHtml(rawHtml)}`;
  resolvePreviewAssets(dom.previewContent);
  fitDisplayMath(dom.previewContent);
  return dom.previewContent.querySelector('#nice');
}

function updatePreview() {
  const source = app.source;

  // An AI proposal owns the preview until it is applied or discarded.
  if (isReviewing()) return;

  if (!source.trim()) {
    clear(dom.previewContent);
    dom.previewContent.append(el('div', { class: 'preview-empty' }, el('p', {}, t('app.preview.startWriting'))));
    dom.diagStats.textContent = '';
    dom.diagIssues.textContent = '';
    return;
  }

  if (currentLanguage() === 'latex') {
    clear(dom.previewContent);
    dom.previewContent.append(el('div', { id: 'nice', class: 'latex-source-preview' }, source));
    dom.diagStats.textContent = t('app.preview.latexStats', { lines: source.split('\n').length, chars: source.length });
    dom.diagIssues.textContent = t('app.preview.compileForPdf');
    dom.diagIssues.className = '';
    return;
  }

  const rawHtml = renderMarkdown(source);
  paintPreview(rawHtml);

  const result = validate(rawHtml, source, app.platform);
  dom.diagStats.textContent = t('app.preview.stats', {
    paragraphs: result.stats.paragraphs, headings: result.stats.headings, math: result.stats.mathTotal,
    code: result.stats.codeBlocks, images: result.stats.images, tables: result.stats.tables,
  });

  const issues = [
    ...result.errors.map(e => t('app.preview.error', { message: e })),
    ...result.warnings.map(w => t('app.preview.warning', { message: w })),
  ];
  dom.diagIssues.textContent = issues.join(' · ');
  dom.diagIssues.className = result.errors.length ? 'error' : result.warnings.length ? 'warning' : '';
}

function updateTargetState() {
  if (!dom.targetState) return;
  const platform = platformLabel();
  if (app.target.busy) {
    dom.targetState.textContent = t('app.target.stateCompiling', { platform });
    dom.targetState.className = 'target-state busy';
  } else if (app.target.prepared) {
    dom.targetState.textContent = t('app.target.stateReady', { platform });
    dom.targetState.className = 'target-state ready';
  } else {
    dom.targetState.textContent = t('app.target.stateNotCompiled', { platform });
    dom.targetState.className = 'target-state stale';
  }
}

/** The publishing platform's short name, for labels. */
function platformLabel() {
  return t(app.platform === 'wechat' ? 'app.platform.wechatShort' : 'app.platform.zhihu');
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
  dom.previewLabel.textContent = platformLabel();
}

// ── Environment-driven UI ─────────────────────────────────────────────────────

function updateEnvironmentUi() {
  const latexOk = Boolean(app.env?.latex?.available);
  const pdfButton = $('btn-compile-pdf');
  if (pdfButton) {
    pdfButton.classList.toggle('needs-setup', !latexOk);
    pdfButton.title = latexOk
      ? t('app.pdf.compileWith', { engine: app.env.latex.defaultEngine })
      : t('app.pdf.notInstalled');
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
    if (isPreviewView()) return;
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
    dom.previewLabel.textContent = platformLabel();
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

  $('btn-compile-pdf').addEventListener('click', async () => {
    // The environment probe no longer blocks the boot, so it may still be in
    // flight when this is clicked. Waiting is right; deciding from a value that
    // has not arrived would show the "LaTeX is not installed" card to someone
    // who has it.
    await app.envReady;
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
      title: t('app.theme.saveAsTitle'),
      label: t('app.theme.nameLabel'),
      value: `${app.themeName}-copy`,
      confirmLabel: t('app.theme.create'),
      validate: (v) => (v.trim() ? null : t('app.theme.nameRequired')),
    });
    if (name === undefined) return;
    await backend.themes.create({ name, css: dom.cssEditor.value });
    app.themes = (await backend.themes.list()).themes;
    buildThemeSelector();
    await loadTheme(name);
    await setArticleTheme(name);
    toast(t('app.theme.created', { name }));
  });
  $('btn-css-rename').addEventListener('click', async () => {
    const name = await promptDialog({
      title: t('app.theme.renameTitle'), label: t('app.theme.nameLabel'), value: app.themeName,
      confirmLabel: t('app.theme.rename'),
      validate: (v) => (v.trim() ? null : t('app.theme.nameRequired')),
    });
    if (name === undefined || name === app.themeName) return;
    await backend.themes.rename(app.themeName, name);
    app.themes = (await backend.themes.list()).themes;
    buildThemeSelector();
    await loadTheme(name);
    await setArticleTheme(name);
    toast(t('app.theme.renamed'));
  });
  $('btn-css-delete').addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: t('app.theme.deleteTitle'),
      message: t('app.theme.deleteMessage', { name: app.themeName }),
      confirmLabel: t('app.theme.delete'), danger: true,
    });
    if (!ok) return;
    await backend.themes.remove(app.themeName);
    app.themes = (await backend.themes.list()).themes;
    buildThemeSelector();
    await loadTheme('default');
    await setArticleTheme('default');
    updatePreview();
    toast(t('app.theme.deleted'));
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

    if (e.key === 's') { e.preventDefault(); flushPendingSave().then(() => toast(t('app.save.done'))); }
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
    // Every panel builds its text when it renders, so a new language is a
    // reload rather than a partial repaint that leaves the old one behind.
    if (patch && 'ui_language' in patch && setLanguagePreference(patch.ui_language)) {
      location.reload();
      return;
    }
    applyPreferences();
  });
  on('article:metadata-changed', async () => {
    if (!app.currentArticleId) return;

    const previousFormat = app.currentArticle?.sourceFormat;
    const data = await backend.workspace.article(app.currentArticleId);

    // A source-format change means the editor is showing the wrong file —
    // possibly a different one entirely, as when converting between LaTeX and
    // Markdown. That needs the same full reload `openArticle` already does
    // for adopting LaTeX; a metadata-only refresh would leave stale text in
    // the editor under a header that now claims a different format.
    if (previousFormat !== undefined && data.article.sourceFormat !== previousFormat) {
      await openArticle(app.currentArticleId);
      return;
    }

    app.currentArticle = data.article;
    updateHeader();
    if (data.article.theme !== app.themeName) {
      await loadTheme(data.article.theme);
      updatePreview();
    }
  });
  on('article:none', showNoArticle);
  on('ai:proposal', ({ source, stats, apply, discard }) => {
    if (currentLanguage() === 'latex') return;   // the preview of a LaTeX article is its source
    showProposal({
      editor: dom.editor,
      oldSource: app.source,
      newSource: source,
      stats,
      paintPreview,
      onApply: apply,
      onDiscard: discard,
    });
  });
  on('ai:proposal-cleared', () => {
    if (!isReviewing()) return;
    clearProposal();
    updatePreview();
  });
  on('ai:applied', async (result) => {
    clearProposal();

    // State first, one repaint after: the highlight is attached to that
    // repaint, and a second one would silently replace it.
    const previous = app.source;
    const sourceChanged = result.source !== undefined && result.source !== app.source;
    if (sourceChanged) {
      app.source = result.source;
      dom.editor.value = result.source;
      app.dirty = false;
      app.savedAt = new Date().toISOString();
      updateSaveState();
      invalidateTarget('ai-edit');
    }
    if (result.themeCss && result.themeName === app.themeName && result.themeCss !== app.themeCss) {
      app.themeCss = result.themeCss;
      updateCssEditor();
      invalidateTarget('ai-theme-edit');
    }
    updatePreview();

    if (sourceChanged && currentLanguage() !== 'latex') {
      flashApplied({
        editor: dom.editor,
        previewRoot: dom.previewContent.querySelector('#nice'),
        oldSource: previous,
        newSource: result.source,
      });
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
