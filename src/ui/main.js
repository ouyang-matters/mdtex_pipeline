import {
  renderMarkdown,
  resolveCssVariables,
  inlineCssSimple,
  sanitizeForPlatform,
  validate,
} from './browser-compiler.js';
import { replaceKatexWithImagesInBrowser } from './math-to-image.js';
import 'katex/dist/katex.min.css';

// ── Storage Keys ──────────────────────────────────────────────────────────────

const STORAGE_KEY_STYLES = 'publisher_custom_styles';
const STORAGE_KEY_SELECTED = 'publisher_selected_style';
const STORAGE_KEY_ARTICLES = 'publisher_articles';
const STORAGE_KEY_CURRENT_ARTICLE = 'publisher_current_article';
const STORAGE_KEY_LIBRARY_VISIBLE = 'publisher_library_visible';

const builtinThemeModules = import.meta.glob('/themes/builtin/*.css', { query: '?raw', import: 'default' });

// ── State ─────────────────────────────────────────────────────────────────────

let builtinThemes = {};
let customStyles = {};
let currentStyle = { name: 'default', css: '', source: 'builtin' };
let currentPlatform = 'wechat';
let cssEditorDirty = false;
let cssEditorOriginal = '';
let debounceTimer = null;

// Article library state
let articles = [];       // [{ id, title, content, folder, format, updatedAt }]
let currentArticle = null;

// ── DOM ───────────────────────────────────────────────────────────────────────

const editor = document.getElementById('editor');
const previewContent = document.getElementById('preview-content');
const selectTheme = document.getElementById('select-theme');
const selectPlatform = document.getElementById('select-platform');
const btnOpen = document.getElementById('btn-open');
const fileInput = document.getElementById('file-input');
const btnCopyRich = document.getElementById('btn-copy-rich');
const btnCopyHtml = document.getElementById('btn-copy-html');
const btnExport = document.getElementById('btn-export');
const btnEditCss = document.getElementById('btn-edit-css');
const diagStats = document.getElementById('diag-stats');
const diagWarnings = document.getElementById('diag-warnings');
const previewPlatformLabel = document.getElementById('preview-platform-label');
const articleTitleDisplay = document.getElementById('article-title');

// Library DOM
const libraryPanel = document.getElementById('library-panel');
const libraryList = document.getElementById('library-list');
const librarySearch = document.getElementById('library-search');
const btnToggleLibrary = document.getElementById('btn-toggle-library');
const btnNewArticle = document.getElementById('btn-new-article');
const editorFormatLabel = document.getElementById('editor-format-label');

// CSS editor DOM
const cssEditorPanel = document.getElementById('css-editor-panel');
const cssEditorTextarea = document.getElementById('css-editor');
const cssEditorTitle = document.getElementById('css-editor-title');
const unsavedIndicator = document.getElementById('css-unsaved-indicator');
const btnCssSave = document.getElementById('btn-css-save');
const btnCssSaveAs = document.getElementById('btn-css-save-as');
const btnCssDuplicate = document.getElementById('btn-css-duplicate');
const btnCssRename = document.getElementById('btn-css-rename');
const btnCssDelete = document.getElementById('btn-css-delete');
const btnCssRevert = document.getElementById('btn-css-revert');
const btnCssClose = document.getElementById('btn-css-close');

// ── Initialization ────────────────────────────────────────────────────────────

async function init() {
  // Load builtin themes
  for (const [path, loader] of Object.entries(builtinThemeModules)) {
    const name = path.replace('/themes/builtin/', '').replace('.css', '');
    const css = await loader();
    builtinThemes[name] = { name, css, source: 'builtin' };
  }

  loadCustomStyles();
  rebuildThemeSelector();

  const savedSelected = localStorage.getItem(STORAGE_KEY_SELECTED);
  if (savedSelected && getAllStyles()[savedSelected]) {
    selectTheme.value = savedSelected;
    currentStyle = getAllStyles()[savedSelected];
  } else if (builtinThemes['default']) {
    selectTheme.value = 'default';
    currentStyle = builtinThemes['default'];
  }

  // Load article library
  loadArticles();
  const savedCurrent = localStorage.getItem(STORAGE_KEY_CURRENT_ARTICLE);
  if (savedCurrent) {
    const found = articles.find(a => a.id === savedCurrent);
    if (found) {
      selectArticle(found);
    }
  }

  // If no current article, create a scratch one
  if (!currentArticle) {
    if (articles.length > 0) {
      selectArticle(articles[0]);
    } else {
      const scratch = createArticle('Untitled');
      selectArticle(scratch);
    }
  }

  // Restore library visibility
  const libVisible = localStorage.getItem(STORAGE_KEY_LIBRARY_VISIBLE);
  if (libVisible === 'false') {
    libraryPanel.classList.add('collapsed');
  }

  renderLibrary();

  // Event listeners
  editor.addEventListener('input', () => {
    if (currentArticle) {
      currentArticle.content = editor.value;
      currentArticle.updatedAt = new Date().toISOString();
      saveArticles();
    }
    debouncedUpdate();
  });

  selectTheme.addEventListener('change', onStyleChange);
  selectPlatform.addEventListener('change', () => {
    currentPlatform = selectPlatform.value;
    previewPlatformLabel.textContent = currentPlatform === 'wechat' ? 'WeChat' : 'Zhihu';
    update();
  });

  btnOpen.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', handleFileOpen);
  btnCopyRich.addEventListener('click', copyRichText);
  btnCopyHtml.addEventListener('click', copyHtml);
  btnExport.addEventListener('click', exportHtml);
  btnEditCss.addEventListener('click', toggleCssEditor);

  // Library events
  btnToggleLibrary.addEventListener('click', () => {
    libraryPanel.classList.toggle('collapsed');
    localStorage.setItem(STORAGE_KEY_LIBRARY_VISIBLE, !libraryPanel.classList.contains('collapsed'));
  });

  btnNewArticle.addEventListener('click', () => {
    const title = prompt('Article title:', 'Untitled');
    if (!title || !title.trim()) return;
    const article = createArticle(title.trim());
    selectArticle(article);
    renderLibrary();
  });

  librarySearch.addEventListener('input', () => renderLibrary());

  articleTitleDisplay.addEventListener('click', () => {
    if (!currentArticle) return;
    const name = prompt('Rename article:', currentArticle.title);
    if (name && name.trim() && name.trim() !== currentArticle.title) {
      currentArticle.title = name.trim();
      currentArticle.updatedAt = new Date().toISOString();
      saveArticles();
      articleTitleDisplay.textContent = currentArticle.title;
      renderLibrary();
    }
  });

  // CSS editor events
  btnCssSave.addEventListener('click', saveCss);
  btnCssSaveAs.addEventListener('click', saveAsCss);
  btnCssDuplicate.addEventListener('click', duplicateCss);
  btnCssRename.addEventListener('click', renameCss);
  btnCssDelete.addEventListener('click', deleteCss);
  btnCssRevert.addEventListener('click', revertCss);
  btnCssClose.addEventListener('click', () => cssEditorPanel.classList.add('hidden'));

  cssEditorTextarea.addEventListener('input', () => {
    cssEditorDirty = cssEditorTextarea.value !== cssEditorOriginal;
    unsavedIndicator.classList.toggle('hidden', !cssEditorDirty);
    currentStyle = { ...currentStyle, css: cssEditorTextarea.value };
    update();
  });

  // Tab keys
  for (const el of [editor, cssEditorTextarea]) {
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const s = el.selectionStart, end = el.selectionEnd;
        el.value = el.value.substring(0, s) + '  ' + el.value.substring(end);
        el.selectionStart = el.selectionEnd = s + 2;
        el.dispatchEvent(new Event('input'));
      }
    });
  }

  update();
}

// ── Article Library ───────────────────────────────────────────────────────────

function loadArticles() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_ARTICLES);
    articles = stored ? JSON.parse(stored) : [];
  } catch { articles = []; }
}

function saveArticles() {
  localStorage.setItem(STORAGE_KEY_ARTICLES, JSON.stringify(articles));
}

function createArticle(title, content = '') {
  const article = {
    id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2),
    title,
    content: content || `# ${title}\n\n`,
    folder: '',
    format: 'markdown',
    updatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };
  articles.unshift(article);
  saveArticles();
  return article;
}

function selectArticle(article) {
  // Save current content
  if (currentArticle) {
    currentArticle.content = editor.value;
    saveArticles();
  }

  currentArticle = article;
  editor.value = article.content || '';
  articleTitleDisplay.textContent = article.title;
  editorFormatLabel.textContent = article.format === 'latex' ? 'TeX' : 'MD';
  localStorage.setItem(STORAGE_KEY_CURRENT_ARTICLE, article.id);

  update();
  renderLibrary();
}

function deleteArticle(article) {
  if (!confirm(`Delete "${article.title}"?`)) return;
  articles = articles.filter(a => a.id !== article.id);
  saveArticles();

  if (currentArticle?.id === article.id) {
    if (articles.length > 0) {
      selectArticle(articles[0]);
    } else {
      const scratch = createArticle('Untitled');
      selectArticle(scratch);
    }
  }
  renderLibrary();
}

function renderLibrary() {
  const query = (librarySearch.value || '').toLowerCase().trim();
  let filtered = articles;
  if (query) {
    filtered = articles.filter(a =>
      (a.title || '').toLowerCase().includes(query) ||
      (a.folder || '').toLowerCase().includes(query)
    );
  }

  // Sort by updatedAt descending
  filtered.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));

  if (filtered.length === 0) {
    libraryList.innerHTML = `<div class="library-empty">
      ${query ? 'No matching articles.' : 'No articles yet.<br>Click <b>+ New</b> or <b>Open</b> a file.'}
    </div>`;
    return;
  }

  libraryList.innerHTML = filtered.map(a => {
    const active = currentArticle?.id === a.id ? ' active' : '';
    const date = (a.updatedAt || '').slice(0, 10);
    const fmt = a.format === 'latex' ? 'TeX' : 'MD';
    return `<div class="library-item${active}" data-id="${a.id}">
      <span class="library-item-title">${escapeHtml(a.title)}</span>
      <span class="library-item-meta">${fmt} · ${date}</span>
    </div>`;
  }).join('');

  // Click handlers
  libraryList.querySelectorAll('.library-item').forEach(el => {
    el.addEventListener('click', () => {
      const article = articles.find(a => a.id === el.dataset.id);
      if (article) selectArticle(article);
    });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const article = articles.find(a => a.id === el.dataset.id);
      if (article && confirm(`Delete "${article.title}"?`)) {
        deleteArticle(article);
      }
    });
  });
}

// ── Style Management ──────────────────────────────────────────────────────────

function getAllStyles() { return { ...builtinThemes, ...customStyles }; }

function loadCustomStyles() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_STYLES);
    if (stored) {
      const parsed = JSON.parse(stored);
      customStyles = {};
      for (const [name, data] of Object.entries(parsed)) {
        customStyles[name] = { name, css: data.css, source: 'custom' };
      }
    }
  } catch {}
}

function saveCustomStyles() {
  const toStore = {};
  for (const [name, data] of Object.entries(customStyles)) toStore[name] = { css: data.css };
  localStorage.setItem(STORAGE_KEY_STYLES, JSON.stringify(toStore));
}

function rebuildThemeSelector() {
  selectTheme.innerHTML = '';
  const builtinNames = Object.keys(builtinThemes).sort();
  const customNames = Object.keys(customStyles).sort();

  if (builtinNames.length > 0) {
    const group = document.createElement('optgroup');
    group.label = 'Built-in';
    for (const name of builtinNames) {
      const opt = document.createElement('option');
      opt.value = name; opt.textContent = name;
      group.appendChild(opt);
    }
    selectTheme.appendChild(group);
  }

  if (customNames.length > 0) {
    const group = document.createElement('optgroup');
    group.label = 'Custom';
    for (const name of customNames) {
      const opt = document.createElement('option');
      opt.value = name; opt.textContent = name;
      group.appendChild(opt);
    }
    selectTheme.appendChild(group);
  }
}

function onStyleChange() {
  const name = selectTheme.value;
  const all = getAllStyles();
  if (all[name]) {
    currentStyle = all[name];
    localStorage.setItem(STORAGE_KEY_SELECTED, name);
    if (!cssEditorPanel.classList.contains('hidden')) openCssEditor();
    update();
  }
}

// ── CSS Editor ────────────────────────────────────────────────────────────────

function toggleCssEditor() {
  if (cssEditorPanel.classList.contains('hidden')) {
    openCssEditor();
    cssEditorPanel.classList.remove('hidden');
  } else {
    cssEditorPanel.classList.add('hidden');
  }
}

function openCssEditor() {
  cssEditorTextarea.value = currentStyle.css;
  cssEditorOriginal = currentStyle.css;
  cssEditorDirty = false;
  unsavedIndicator.classList.add('hidden');
  const label = currentStyle.source === 'builtin' ? `[builtin] ${currentStyle.name}` : currentStyle.name;
  cssEditorTitle.textContent = `Style: ${label}`;
  const isBuiltin = currentStyle.source === 'builtin';
  btnCssSave.disabled = isBuiltin;
  btnCssRename.disabled = isBuiltin;
  btnCssDelete.disabled = isBuiltin;
  btnCssRevert.disabled = isBuiltin;
}

function saveCss() {
  if (currentStyle.source === 'builtin') { showToast('Use "Save As" for built-in styles.', 'error'); return; }
  currentStyle.css = cssEditorTextarea.value;
  customStyles[currentStyle.name] = { ...currentStyle };
  saveCustomStyles();
  cssEditorOriginal = cssEditorTextarea.value;
  cssEditorDirty = false;
  unsavedIndicator.classList.add('hidden');
  showToast(`"${currentStyle.name}" saved.`, 'success');
}

function saveAsCss() {
  const name = prompt('Name for new style:', `${currentStyle.name}-custom`);
  if (!name?.trim()) return;
  const t = name.trim();
  if (builtinThemes[t]) { showToast('Cannot use a built-in name.', 'error'); return; }
  customStyles[t] = { name: t, css: cssEditorTextarea.value, source: 'custom' };
  saveCustomStyles();
  rebuildThemeSelector();
  selectTheme.value = t;
  currentStyle = customStyles[t];
  localStorage.setItem(STORAGE_KEY_SELECTED, t);
  openCssEditor();
  update();
  showToast(`"${t}" created.`, 'success');
}

function duplicateCss() {
  const name = prompt('Name for copy:', `${currentStyle.name}-copy`);
  if (!name?.trim()) return;
  const t = name.trim();
  if (builtinThemes[t]) { showToast('Cannot use a built-in name.', 'error'); return; }
  customStyles[t] = { name: t, css: currentStyle.css, source: 'custom' };
  saveCustomStyles();
  rebuildThemeSelector();
  selectTheme.value = t;
  currentStyle = customStyles[t];
  localStorage.setItem(STORAGE_KEY_SELECTED, t);
  openCssEditor();
  update();
  showToast(`Duplicated as "${t}".`, 'success');
}

function renameCss() {
  if (currentStyle.source === 'builtin') return;
  const name = prompt('New name:', currentStyle.name);
  if (!name?.trim() || name.trim() === currentStyle.name) return;
  const t = name.trim();
  if (builtinThemes[t] || customStyles[t]) { showToast('Name already exists.', 'error'); return; }
  const old = currentStyle.name;
  delete customStyles[old];
  customStyles[t] = { name: t, css: currentStyle.css, source: 'custom' };
  saveCustomStyles();
  rebuildThemeSelector();
  selectTheme.value = t;
  currentStyle = customStyles[t];
  localStorage.setItem(STORAGE_KEY_SELECTED, t);
  openCssEditor();
  showToast(`Renamed to "${t}".`, 'success');
}

function deleteCss() {
  if (currentStyle.source === 'builtin') return;
  if (!confirm(`Delete "${currentStyle.name}"?`)) return;
  delete customStyles[currentStyle.name];
  saveCustomStyles();
  rebuildThemeSelector();
  currentStyle = builtinThemes['default'] || Object.values(builtinThemes)[0];
  selectTheme.value = currentStyle.name;
  localStorage.setItem(STORAGE_KEY_SELECTED, currentStyle.name);
  openCssEditor();
  update();
  showToast('Deleted.', 'success');
}

function revertCss() {
  if (currentStyle.source === 'builtin') return;
  cssEditorTextarea.value = cssEditorOriginal;
  cssEditorDirty = false;
  unsavedIndicator.classList.add('hidden');
  currentStyle = { ...currentStyle, css: cssEditorOriginal };
  update();
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function debouncedUpdate() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(update, 200);
}

function update() {
  const source = editor.value;
  if (!source.trim()) {
    previewContent.innerHTML = '<div id="nice"><p style="color:#999;text-align:center;">Start writing...</p></div>';
    diagStats.textContent = '';
    diagWarnings.textContent = '';
    return;
  }

  const rawHtml = renderMarkdown(source);
  const resolvedCss = resolveCssVariables(currentStyle.css);
  previewContent.innerHTML = `<style>${resolvedCss}</style>\n${rawHtml}`;

  const validation = validate(rawHtml, source, currentPlatform);
  diagStats.textContent = [
    `${validation.stats.paragraphs}P`, `${validation.stats.headings}H`,
    `${validation.stats.mathTotal}Math`, `${validation.stats.codeBlocks}Code`,
    `${validation.stats.images}Img`, `${validation.stats.tables}Tbl`,
  ].join(' | ');

  const issues = [];
  for (const e of validation.errors) issues.push(`[E] ${e}`);
  for (const w of validation.warnings) issues.push(`[W] ${w}`);
  diagWarnings.textContent = issues.join(' | ');
  diagWarnings.className = validation.errors.length > 0 ? 'error' : validation.warnings.length > 0 ? 'warning' : '';
}

// ── File / Export ─────────────────────────────────────────────────────────────

function handleFileOpen(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const content = ev.target.result;
    const title = file.name.replace(/\.(md|markdown|txt|tex)$/i, '');

    // Check if this file is already in the library
    const existing = articles.find(a => a.title === title);
    if (existing) {
      existing.content = content;
      existing.updatedAt = new Date().toISOString();
      saveArticles();
      selectArticle(existing);
    } else {
      const article = createArticle(title, content);
      selectArticle(article);
    }
    renderLibrary();
    showToast(`Opened: ${file.name}`, 'success');
  };
  reader.readAsText(file);
  fileInput.value = '';
}

async function copyRichText() {
  const source = editor.value;
  if (!source.trim()) return;
  const rawHtml = renderMarkdown(source);
  const resolvedCss = resolveCssVariables(currentStyle.css);
  const mathProcessedHtml = await replaceKatexWithImagesInBrowser(rawHtml, resolvedCss);
  const inlinedHtml = inlineCssSimple(mathProcessedHtml, resolvedCss);
  const finalHtml = sanitizeForPlatform(inlinedHtml, currentPlatform);

  try {
    await navigator.clipboard.write([new ClipboardItem({
      'text/html': new Blob([finalHtml], { type: 'text/html' }),
      'text/plain': new Blob([stripHtml(finalHtml)], { type: 'text/plain' }),
    })]);
    showToast(`Copied for ${currentPlatform === 'wechat' ? 'WeChat' : 'Zhihu'}!`, 'success');
  } catch (err) {
    try { await navigator.clipboard.writeText(finalHtml); showToast('Copied as text.', 'success'); }
    catch { showToast('Copy failed: ' + err.message, 'error'); }
  }
}

async function copyHtml() {
  const source = editor.value;
  if (!source.trim()) return;
  const rawHtml = renderMarkdown(source);
  const resolvedCss = resolveCssVariables(currentStyle.css);
  const mathProcessedHtml = await replaceKatexWithImagesInBrowser(rawHtml, resolvedCss);
  const inlinedHtml = inlineCssSimple(mathProcessedHtml, resolvedCss);
  const finalHtml = sanitizeForPlatform(inlinedHtml, currentPlatform);
  try { await navigator.clipboard.writeText(finalHtml); showToast('HTML copied!', 'success'); }
  catch (err) { showToast('Copy failed: ' + err.message, 'error'); }
}

async function exportHtml() {
  const source = editor.value;
  if (!source.trim()) return;
  const rawHtml = renderMarkdown(source);
  const resolvedCss = resolveCssVariables(currentStyle.css);
  const mathProcessedHtml = await replaceKatexWithImagesInBrowser(rawHtml, resolvedCss);
  const inlinedHtml = inlineCssSimple(mathProcessedHtml, resolvedCss);
  const finalHtml = sanitizeForPlatform(inlinedHtml, currentPlatform);
  const fullDoc = `<!DOCTYPE html>\n<html lang="zh-CN">\n<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${escapeHtml(currentArticle?.title || 'Article')}</title></head>\n<body>\n${finalHtml}\n</body>\n</html>`;
  const blob = new Blob([fullDoc], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(currentArticle?.title || 'article').replace(/[^a-zA-Z0-9_-]/g, '_')}.${currentPlatform}.html`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Exported!', 'success');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2000);
}

function stripHtml(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || '';
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

init();
