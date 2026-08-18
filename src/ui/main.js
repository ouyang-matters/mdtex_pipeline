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

const SK = {
  STYLES: 'publisher_custom_styles',
  SELECTED_STYLE: 'publisher_selected_style',
  ARTICLES: 'publisher_articles',
  CURRENT: 'publisher_current_article',
  LIB_VISIBLE: 'publisher_library_visible',
  FOLDERS: 'publisher_folders',
};

const builtinThemeModules = import.meta.glob('/themes/builtin/*.css', { query: '?raw', import: 'default' });

// ── State ─────────────────────────────────────────────────────────────────────

let builtinThemes = {};
let customStyles = {};
let currentStyle = { name: 'default', css: '', source: 'builtin' };
let currentPlatform = 'wechat';
let cssEditorDirty = false;
let cssEditorOriginal = '';
let debounceTimer = null;
let articles = [];
let folders = [];
let currentArticle = null;
let currentFolder = '';

// ── DOM refs ──────────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

const editor = $('editor');
const previewContent = $('preview-content');
const selectTheme = $('select-theme');
const selectPlatform = $('select-platform');
const fileInput = $('file-input');
const imageInput = $('image-input');
const articleTitleDisplay = $('article-title');
const libraryPanel = $('library-panel');
const libraryList = $('library-list');
const librarySearch = $('library-search');
const editorFormatLabel = $('editor-format-label');
const editorPane = $('editor-pane');
const previewPlatformLabel = $('preview-platform-label');
const diagStats = $('diag-stats');
const diagWarnings = $('diag-warnings');

// Bottom panel
const bottomPanel = $('bottom-panel');
const cssEditorTextarea = $('css-editor');
const cssEditorTitle = $('css-editor-title');
const unsavedIndicator = $('css-unsaved-indicator');
const aiMessages = $('ai-messages');
const aiPromptInput = $('ai-prompt');
const buildOutput = $('build-output');

// ── Initialization ────────────────────────────────────────────────────────────

async function init() {
  for (const [path, loader] of Object.entries(builtinThemeModules)) {
    const name = path.replace('/themes/builtin/', '').replace('.css', '');
    const css = await loader();
    builtinThemes[name] = { name, css, source: 'builtin' };
  }

  loadCustomStyles();
  rebuildThemeSelector();

  const savedStyle = localStorage.getItem(SK.SELECTED_STYLE);
  if (savedStyle && getAllStyles()[savedStyle]) {
    selectTheme.value = savedStyle;
    currentStyle = getAllStyles()[savedStyle];
  } else if (builtinThemes['default']) {
    selectTheme.value = 'default';
    currentStyle = builtinThemes['default'];
  }

  loadArticles();
  loadFolders();

  const savedCurrent = localStorage.getItem(SK.CURRENT);
  const found = savedCurrent ? articles.find(a => a.id === savedCurrent) : null;
  selectArticle(found || articles[0] || createArticle('Untitled'));

  if (localStorage.getItem(SK.LIB_VISIBLE) === 'false') libraryPanel.classList.add('collapsed');

  renderLibrary();
  setupEvents();
  update();
}

function setupEvents() {
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

  $('btn-open').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', handleFileOpen);
  $('btn-copy-rich').addEventListener('click', copyRichText);
  $('btn-copy-html').addEventListener('click', copyHtml);
  $('btn-export').addEventListener('click', exportHtml);
  $('btn-edit-css').addEventListener('click', () => openBottomTab('css'));
  $('btn-toggle-ai').addEventListener('click', () => openBottomTab('ai'));

  $('btn-toggle-library').addEventListener('click', () => {
    libraryPanel.classList.toggle('collapsed');
    localStorage.setItem(SK.LIB_VISIBLE, !libraryPanel.classList.contains('collapsed'));
  });

  $('btn-new-article').addEventListener('click', () => {
    const title = prompt('Article title:', 'Untitled');
    if (!title?.trim()) return;
    selectArticle(createArticle(title.trim()));
    renderLibrary();
  });

  $('btn-new-folder').addEventListener('click', () => {
    const name = prompt('Folder name:');
    if (!name?.trim()) return;
    const path = currentFolder ? `${currentFolder}/${name.trim()}` : name.trim();
    if (!folders.includes(path)) { folders.push(path); saveFolders(); }
    renderLibrary();
  });

  $('btn-insert-image').addEventListener('click', () => imageInput.click());
  imageInput.addEventListener('change', handleImageInsert);

  articleTitleDisplay.addEventListener('click', () => {
    if (!currentArticle) return;
    const name = prompt('Rename article:', currentArticle.title);
    if (name?.trim() && name.trim() !== currentArticle.title) {
      currentArticle.title = name.trim();
      currentArticle.updatedAt = new Date().toISOString();
      saveArticles();
      articleTitleDisplay.textContent = currentArticle.title;
      renderLibrary();
    }
  });

  librarySearch.addEventListener('input', () => renderLibrary());

  // Bottom panel tabs
  bottomPanel.querySelectorAll('.bottom-tab').forEach(tab => {
    tab.addEventListener('click', () => openBottomTab(tab.dataset.tab));
  });
  $('btn-close-bottom').addEventListener('click', () => bottomPanel.classList.add('hidden'));

  // CSS editor
  $('btn-css-save').addEventListener('click', saveCss);
  $('btn-css-save-as').addEventListener('click', saveAsCss);
  $('btn-css-duplicate').addEventListener('click', duplicateCss);
  $('btn-css-rename').addEventListener('click', renameCss);
  $('btn-css-delete').addEventListener('click', deleteCss);
  $('btn-css-revert').addEventListener('click', revertCss);

  cssEditorTextarea.addEventListener('input', () => {
    cssEditorDirty = cssEditorTextarea.value !== cssEditorOriginal;
    unsavedIndicator.classList.toggle('hidden', !cssEditorDirty);
    currentStyle = { ...currentStyle, css: cssEditorTextarea.value };
    update();
  });

  // AI send
  $('btn-ai-send').addEventListener('click', sendAiPrompt);
  aiPromptInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendAiPrompt(); });

  // Tab key in textareas
  for (const el of [editor, cssEditorTextarea]) {
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const s = el.selectionStart;
        el.value = el.value.substring(0, s) + '  ' + el.value.substring(el.selectionEnd);
        el.selectionStart = el.selectionEnd = s + 2;
        el.dispatchEvent(new Event('input'));
      }
    });
  }

  // Drag-and-drop images on editor
  editorPane.addEventListener('dragover', (e) => { e.preventDefault(); editorPane.classList.add('dragover'); });
  editorPane.addEventListener('dragleave', () => editorPane.classList.remove('dragover'));
  editorPane.addEventListener('drop', handleDrop);

  // Clipboard paste images
  editor.addEventListener('paste', handlePaste);
}

// ── Article Library ───────────────────────────────────────────────────────────

function loadArticles() {
  try { articles = JSON.parse(localStorage.getItem(SK.ARTICLES) || '[]'); } catch { articles = []; }
}
function saveArticles() { localStorage.setItem(SK.ARTICLES, JSON.stringify(articles)); }
function loadFolders() {
  try { folders = JSON.parse(localStorage.getItem(SK.FOLDERS) || '[]'); } catch { folders = []; }
}
function saveFolders() { localStorage.setItem(SK.FOLDERS, JSON.stringify(folders)); }

function createArticle(title, content = '', folder = '') {
  const article = {
    id: crypto.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2),
    title, content: content || `# ${title}\n\n`, folder,
    format: 'markdown', updatedAt: new Date().toISOString(), createdAt: new Date().toISOString(),
  };
  articles.unshift(article);
  saveArticles();
  return article;
}

function selectArticle(article) {
  if (currentArticle) { currentArticle.content = editor.value; saveArticles(); }
  currentArticle = article;
  editor.value = article.content || '';
  articleTitleDisplay.textContent = article.title;
  editorFormatLabel.textContent = article.format === 'latex' ? 'TeX' : 'MD';
  localStorage.setItem(SK.CURRENT, article.id);
  update();
  renderLibrary();
}

function deleteArticle(article) {
  if (!confirm(`Delete "${article.title}"?`)) return;
  articles = articles.filter(a => a.id !== article.id);
  saveArticles();
  if (currentArticle?.id === article.id) selectArticle(articles[0] || createArticle('Untitled'));
  renderLibrary();
}

function renderLibrary() {
  const q = (librarySearch.value || '').toLowerCase().trim();
  let filtered = articles;
  if (q) filtered = articles.filter(a =>
    (a.title || '').toLowerCase().includes(q) || (a.folder || '').toLowerCase().includes(q));
  filtered.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));

  let html = '';

  // Show folders first
  const uniqueFolders = [...new Set(folders.concat(articles.map(a => a.folder).filter(Boolean)))].sort();
  if (uniqueFolders.length > 0 && !q) {
    for (const f of uniqueFolders) {
      const count = articles.filter(a => a.folder === f).length;
      html += `<div class="library-folder" data-folder="${esc(f)}">${esc(f)} (${count})</div>`;
    }
  }

  if (filtered.length === 0) {
    html += `<div class="library-empty">${q ? 'No matches.' : 'No articles yet.'}</div>`;
  } else {
    for (const a of filtered) {
      const active = currentArticle?.id === a.id ? ' active' : '';
      const date = (a.updatedAt || '').slice(0, 10);
      const fmt = a.format === 'latex' ? 'TeX' : 'MD';
      const folder = a.folder ? `${a.folder}/` : '';
      html += `<div class="library-item${active}" data-id="${a.id}">
        <span class="library-item-title">${esc(a.title)}</span>
        <span class="library-item-meta">${fmt} · ${folder}${date}</span>
      </div>`;
    }
  }

  libraryList.innerHTML = html;

  libraryList.querySelectorAll('.library-item').forEach(el => {
    el.addEventListener('click', () => {
      const a = articles.find(x => x.id === el.dataset.id);
      if (a) selectArticle(a);
    });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const a = articles.find(x => x.id === el.dataset.id);
      if (a) deleteArticle(a);
    });
  });
}

// ── Image handling ────────────────────────────────────────────────────────────

function handleImageInsert(e) {
  const file = e.target.files?.[0];
  if (file) insertImageFile(file);
  imageInput.value = '';
}

function handleDrop(e) {
  e.preventDefault();
  editorPane.classList.remove('dragover');
  const file = e.dataTransfer?.files?.[0];
  if (file && file.type.startsWith('image/')) insertImageFile(file);
}

function handlePaste(e) {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault();
      insertImageFile(item.getAsFile());
      return;
    }
  }
}

function insertImageFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    const dataUri = reader.result;
    const name = file.name || 'image.png';
    const safeName = name.replace(/[^a-zA-Z0-9._-]/g, '_');
    // Store image as data URI in the article content (browser-only; CLI uses filesystem)
    const ref = `![${safeName.replace(/\.[^.]+$/, '')}](${dataUri})`;
    insertAtCursor(ref);
    showToast(`Image inserted: ${safeName}`, 'success');
  };
  reader.readAsDataURL(file);
}

function insertAtCursor(text) {
  const pos = editor.selectionStart;
  editor.value = editor.value.substring(0, pos) + text + editor.value.substring(editor.selectionEnd);
  editor.selectionStart = editor.selectionEnd = pos + text.length;
  editor.dispatchEvent(new Event('input'));
  editor.focus();
}

// ── Bottom Panel ──────────────────────────────────────────────────────────────

function openBottomTab(tabName) {
  bottomPanel.classList.remove('hidden');
  bottomPanel.querySelectorAll('.bottom-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
  bottomPanel.querySelectorAll('.bottom-tab-content').forEach(c => c.classList.toggle('active', c.dataset.tab === tabName));
  if (tabName === 'css') openCssEditor();
}

// ── AI Assistant ──────────────────────────────────────────────────────────────

function sendAiPrompt() {
  const prompt = aiPromptInput.value.trim();
  if (!prompt) return;
  const scope = $('ai-scope').value;

  addAiMessage('user', `[${scope}] ${prompt}`);
  aiPromptInput.value = '';

  // Simulate AI response (real backend integration uses src/ai/backend.js)
  addAiMessage('assistant', `AI editing is available via CLI:\n\nThe LocalClaudeCode and RemoteClaudeClaw backends are defined in src/ai/backend.js. To use them, configure your Claude Code CLI locally or connect to a remote ClaudeClaw worker.\n\nFor now, edit your ${scope === 'theme' ? 'CSS theme' : 'article content'} directly in the editor.`);
}

function addAiMessage(role, text) {
  const div = document.createElement('div');
  div.className = `ai-msg ${role}`;
  div.textContent = text;
  aiMessages.appendChild(div);
  aiMessages.scrollTop = aiMessages.scrollHeight;
  // Remove welcome message
  const welcome = aiMessages.querySelector('.ai-welcome');
  if (welcome) welcome.remove();
}

// ── Style Management ──────────────────────────────────────────────────────────

function getAllStyles() { return { ...builtinThemes, ...customStyles }; }

function loadCustomStyles() {
  try {
    const stored = localStorage.getItem(SK.STYLES);
    if (stored) {
      customStyles = {};
      for (const [n, d] of Object.entries(JSON.parse(stored))) customStyles[n] = { name: n, css: d.css, source: 'custom' };
    }
  } catch {}
}

function saveCustomStyles() {
  const o = {};
  for (const [n, d] of Object.entries(customStyles)) o[n] = { css: d.css };
  localStorage.setItem(SK.STYLES, JSON.stringify(o));
}

function rebuildThemeSelector() {
  selectTheme.innerHTML = '';
  for (const [label, items] of [['Built-in', Object.keys(builtinThemes).sort()], ['Custom', Object.keys(customStyles).sort()]]) {
    if (items.length === 0) continue;
    const g = document.createElement('optgroup');
    g.label = label;
    for (const n of items) { const o = document.createElement('option'); o.value = n; o.textContent = n; g.appendChild(o); }
    selectTheme.appendChild(g);
  }
}

function onStyleChange() {
  const all = getAllStyles();
  if (all[selectTheme.value]) {
    currentStyle = all[selectTheme.value];
    localStorage.setItem(SK.SELECTED_STYLE, selectTheme.value);
    if (!bottomPanel.classList.contains('hidden')) openCssEditor();
    update();
  }
}

// ── CSS Editor ────────────────────────────────────────────────────────────────

function openCssEditor() {
  cssEditorTextarea.value = currentStyle.css;
  cssEditorOriginal = currentStyle.css;
  cssEditorDirty = false;
  unsavedIndicator.classList.add('hidden');
  cssEditorTitle.textContent = `Style: ${currentStyle.source === 'builtin' ? '[builtin] ' : ''}${currentStyle.name}`;
  const b = currentStyle.source === 'builtin';
  $('btn-css-save').disabled = b;
  $('btn-css-rename').disabled = b;
  $('btn-css-delete').disabled = b;
  $('btn-css-revert').disabled = b;
}

function saveCss() {
  if (currentStyle.source === 'builtin') { showToast('Use Save As for built-in styles.', 'error'); return; }
  currentStyle.css = cssEditorTextarea.value;
  customStyles[currentStyle.name] = { ...currentStyle };
  saveCustomStyles();
  cssEditorOriginal = cssEditorTextarea.value;
  cssEditorDirty = false;
  unsavedIndicator.classList.add('hidden');
  showToast(`Saved.`, 'success');
}

function saveAsCss() {
  const n = prompt('New style name:', `${currentStyle.name}-custom`)?.trim();
  if (!n) return;
  if (builtinThemes[n]) { showToast('Cannot use built-in name.', 'error'); return; }
  customStyles[n] = { name: n, css: cssEditorTextarea.value, source: 'custom' };
  saveCustomStyles(); rebuildThemeSelector();
  selectTheme.value = n; currentStyle = customStyles[n];
  localStorage.setItem(SK.SELECTED_STYLE, n);
  openCssEditor(); update();
  showToast(`"${n}" created.`, 'success');
}

function duplicateCss() {
  const n = prompt('Copy name:', `${currentStyle.name}-copy`)?.trim();
  if (!n) return;
  if (builtinThemes[n]) { showToast('Cannot use built-in name.', 'error'); return; }
  customStyles[n] = { name: n, css: currentStyle.css, source: 'custom' };
  saveCustomStyles(); rebuildThemeSelector();
  selectTheme.value = n; currentStyle = customStyles[n];
  localStorage.setItem(SK.SELECTED_STYLE, n);
  openCssEditor(); update();
  showToast(`Duplicated as "${n}".`, 'success');
}

function renameCss() {
  if (currentStyle.source === 'builtin') return;
  const n = prompt('New name:', currentStyle.name)?.trim();
  if (!n || n === currentStyle.name) return;
  if (builtinThemes[n] || customStyles[n]) { showToast('Name exists.', 'error'); return; }
  delete customStyles[currentStyle.name];
  customStyles[n] = { name: n, css: currentStyle.css, source: 'custom' };
  saveCustomStyles(); rebuildThemeSelector();
  selectTheme.value = n; currentStyle = customStyles[n];
  localStorage.setItem(SK.SELECTED_STYLE, n);
  openCssEditor();
}

function deleteCss() {
  if (currentStyle.source === 'builtin') return;
  if (!confirm(`Delete "${currentStyle.name}"?`)) return;
  delete customStyles[currentStyle.name];
  saveCustomStyles(); rebuildThemeSelector();
  currentStyle = builtinThemes['default'] || Object.values(builtinThemes)[0];
  selectTheme.value = currentStyle.name;
  localStorage.setItem(SK.SELECTED_STYLE, currentStyle.name);
  openCssEditor(); update();
}

function revertCss() {
  if (currentStyle.source === 'builtin') return;
  cssEditorTextarea.value = cssEditorOriginal;
  cssEditorDirty = false; unsavedIndicator.classList.add('hidden');
  currentStyle = { ...currentStyle, css: cssEditorOriginal };
  update();
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function debouncedUpdate() { clearTimeout(debounceTimer); debounceTimer = setTimeout(update, 200); }

function update() {
  const source = editor.value;
  if (!source.trim()) {
    previewContent.innerHTML = '<div id="nice"><p style="color:#999;text-align:center;">Start writing...</p></div>';
    diagStats.textContent = ''; diagWarnings.textContent = '';
    return;
  }
  const rawHtml = renderMarkdown(source);
  const resolvedCss = resolveCssVariables(currentStyle.css);
  previewContent.innerHTML = `<style>${resolvedCss}</style>\n${rawHtml}`;

  const v = validate(rawHtml, source, currentPlatform);
  diagStats.textContent = `${v.stats.paragraphs}P | ${v.stats.headings}H | ${v.stats.mathTotal}Math | ${v.stats.codeBlocks}Code | ${v.stats.images}Img | ${v.stats.tables}Tbl`;
  const issues = [...v.errors.map(e => `[E] ${e}`), ...v.warnings.map(w => `[W] ${w}`)];
  diagWarnings.textContent = issues.join(' | ');
  diagWarnings.className = v.errors.length > 0 ? 'error' : v.warnings.length > 0 ? 'warning' : '';
}

// ── File / Export ─────────────────────────────────────────────────────────────

function handleFileOpen(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const content = ev.target.result;
    const title = file.name.replace(/\.(md|markdown|txt|tex)$/i, '');
    const fmt = file.name.endsWith('.tex') ? 'latex' : 'markdown';
    const existing = articles.find(a => a.title === title);
    if (existing) {
      existing.content = content; existing.format = fmt;
      existing.updatedAt = new Date().toISOString();
      saveArticles(); selectArticle(existing);
    } else {
      const a = createArticle(title, content);
      a.format = fmt; saveArticles();
      selectArticle(a);
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
  appendBuildLog('Compiling for ' + currentPlatform + '...');
  const rawHtml = renderMarkdown(source);
  const resolvedCss = resolveCssVariables(currentStyle.css);
  const mathHtml = await replaceKatexWithImagesInBrowser(rawHtml, resolvedCss);
  const inlinedHtml = inlineCssSimple(mathHtml, resolvedCss);
  const finalHtml = sanitizeForPlatform(inlinedHtml, currentPlatform);
  appendBuildLog('Done. Copying to clipboard...');

  try {
    await navigator.clipboard.write([new ClipboardItem({
      'text/html': new Blob([finalHtml], { type: 'text/html' }),
      'text/plain': new Blob([stripHtml(finalHtml)], { type: 'text/plain' }),
    })]);
    showToast(`Copied for ${currentPlatform === 'wechat' ? 'WeChat' : 'Zhihu'}!`, 'success');
    appendBuildLog('Copied to clipboard.');
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
  const mathHtml = await replaceKatexWithImagesInBrowser(rawHtml, resolvedCss);
  const inlinedHtml = inlineCssSimple(mathHtml, resolvedCss);
  const finalHtml = sanitizeForPlatform(inlinedHtml, currentPlatform);
  try { await navigator.clipboard.writeText(finalHtml); showToast('HTML copied!', 'success'); }
  catch (err) { showToast('Copy failed: ' + err.message, 'error'); }
}

async function exportHtml() {
  const source = editor.value;
  if (!source.trim()) return;
  const rawHtml = renderMarkdown(source);
  const resolvedCss = resolveCssVariables(currentStyle.css);
  const mathHtml = await replaceKatexWithImagesInBrowser(rawHtml, resolvedCss);
  const inlinedHtml = inlineCssSimple(mathHtml, resolvedCss);
  const finalHtml = sanitizeForPlatform(inlinedHtml, currentPlatform);
  const title = esc(currentArticle?.title || 'Article');
  const doc = `<!DOCTYPE html>\n<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${title}</title></head><body>\n${finalHtml}\n</body></html>`;
  const blob = new Blob([doc], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `${(currentArticle?.title || 'article').replace(/[^a-zA-Z0-9_-]/g, '_')}.${currentPlatform}.html`;
  a.click(); URL.revokeObjectURL(url);
  showToast('Exported!', 'success');
}

// ── Build Log ─────────────────────────────────────────────────────────────────

function appendBuildLog(text) {
  const ts = new Date().toLocaleTimeString();
  buildOutput.textContent += `[${ts}] ${text}\n`;
  buildOutput.scrollTop = buildOutput.scrollHeight;
  // Clear welcome
  const w = buildOutput.querySelector('.ai-welcome');
  if (w) w.remove();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function showToast(msg, type = 'success') {
  const t = document.createElement('div'); t.className = `toast ${type}`; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 2000);
}
function stripHtml(html) { const d = document.createElement('div'); d.innerHTML = html; return d.textContent || ''; }
function esc(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

init();
