import {
  renderMarkdown,
  resolveCssVariables,
  inlineCssSimple,
  sanitizeForPlatform,
  validate,
} from './browser-compiler.js';
import { replaceKatexWithImagesInBrowser } from './math-to-image.js';
import { getSnippetsGrouped, applySnippet, handleAutoClose, BUILTIN_SNIPPETS } from './snippets.js';
import 'katex/dist/katex.min.css';

// ── Storage ───────────────────────────────────────────────────────────────────

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

let builtinThemes = {}, customStyles = {};
let currentStyle = { name: 'default', css: '', source: 'builtin' };
let currentPlatform = 'wechat';
let cssEditorDirty = false, cssEditorOriginal = '';
let debounceTimer = null;
let articles = [], folders = [], currentArticle = null;

// ── DOM ───────────────────────────────────────────────────────────────────────

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
const bottomPanel = $('bottom-panel');
const cssEditorTextarea = $('css-editor');
const cssEditorTitle = $('css-editor-title');
const unsavedIndicator = $('css-unsaved-indicator');
const aiMessages = $('ai-messages');
const aiPromptInput = $('ai-prompt');
const buildOutput = $('build-output');
const snippetPalette = $('snippet-palette');
const editorToolbar = $('editor-toolbar');

function currentLang() { return currentArticle?.format === 'latex' ? 'latex' : 'markdown'; }

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  for (const [path, loader] of Object.entries(builtinThemeModules)) {
    const name = path.replace('/themes/builtin/', '').replace('.css', '');
    builtinThemes[name] = { name, css: await loader(), source: 'builtin' };
  }

  loadCustomStyles(); rebuildThemeSelector();
  const savedStyle = localStorage.getItem(SK.SELECTED_STYLE);
  if (savedStyle && getAllStyles()[savedStyle]) { selectTheme.value = savedStyle; currentStyle = getAllStyles()[savedStyle]; }
  else if (builtinThemes['default']) { selectTheme.value = 'default'; currentStyle = builtinThemes['default']; }

  loadArticles(); loadFolders();
  const found = localStorage.getItem(SK.CURRENT);
  selectArticle((found && articles.find(a => a.id === found)) || articles[0] || createArticle('Untitled'));
  if (localStorage.getItem(SK.LIB_VISIBLE) === 'false') libraryPanel.classList.add('collapsed');
  renderLibrary(); buildEditorToolbar(); setupEvents(); update();
}

function setupEvents() {
  editor.addEventListener('input', () => {
    if (currentArticle) { currentArticle.content = editor.value; currentArticle.updatedAt = new Date().toISOString(); saveArticles(); }
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
    const fmt = prompt('Format? (md / tex)', 'md')?.trim();
    const article = createArticle(title.trim(), '', '', fmt === 'tex' ? 'latex' : 'markdown');
    selectArticle(article); renderLibrary();
  });

  $('btn-new-folder').addEventListener('click', () => {
    const name = prompt('Folder name:');
    if (!name?.trim()) return;
    if (!folders.includes(name.trim())) { folders.push(name.trim()); saveFolders(); }
    renderLibrary();
  });

  $('btn-insert-image').addEventListener('click', () => imageInput.click());
  imageInput.addEventListener('change', (e) => { if (e.target.files?.[0]) insertImageFile(e.target.files[0]); imageInput.value = ''; });

  $('btn-snippets').addEventListener('click', toggleSnippetPalette);
  $('btn-compile-pdf').addEventListener('click', compilePdf);

  articleTitleDisplay.addEventListener('click', () => {
    if (!currentArticle) return;
    const name = prompt('Rename:', currentArticle.title);
    if (name?.trim() && name.trim() !== currentArticle.title) {
      currentArticle.title = name.trim(); currentArticle.updatedAt = new Date().toISOString();
      saveArticles(); articleTitleDisplay.textContent = currentArticle.title; renderLibrary();
    }
  });

  librarySearch.addEventListener('input', () => renderLibrary());

  bottomPanel.querySelectorAll('.bottom-tab').forEach(tab => {
    tab.addEventListener('click', () => openBottomTab(tab.dataset.tab));
  });
  $('btn-close-bottom').addEventListener('click', () => bottomPanel.classList.add('hidden'));

  $('btn-css-save').addEventListener('click', saveCss);
  $('btn-css-save-as').addEventListener('click', saveAsCss);
  $('btn-css-duplicate').addEventListener('click', duplicateCss);
  $('btn-css-rename').addEventListener('click', renameCss);
  $('btn-css-delete').addEventListener('click', deleteCss);
  $('btn-css-revert').addEventListener('click', revertCss);

  cssEditorTextarea.addEventListener('input', () => {
    cssEditorDirty = cssEditorTextarea.value !== cssEditorOriginal;
    unsavedIndicator.classList.toggle('hidden', !cssEditorDirty);
    currentStyle = { ...currentStyle, css: cssEditorTextarea.value }; update();
  });

  $('btn-ai-send').addEventListener('click', sendAiPrompt);
  aiPromptInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendAiPrompt(); });

  // Tab key + auto-close delimiters
  editor.addEventListener('keydown', handleEditorKeydown);
  cssEditorTextarea.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') { e.preventDefault(); insertTab(cssEditorTextarea); }
  });

  // Drag-drop with cursor position
  editorPane.addEventListener('dragover', (e) => { e.preventDefault(); editorPane.classList.add('dragover'); });
  editorPane.addEventListener('dragleave', () => editorPane.classList.remove('dragover'));
  editorPane.addEventListener('drop', handleDrop);

  // Clipboard paste
  editor.addEventListener('paste', handlePaste);

  // Keyboard shortcuts for snippets
  editor.addEventListener('keydown', handleSnippetShortcuts);

  // Close snippet palette on outside click
  document.addEventListener('click', (e) => {
    if (!snippetPalette.contains(e.target) && e.target !== $('btn-snippets')) {
      snippetPalette.classList.add('hidden');
    }
  });
}

// ── Editor keyboard handling ──────────────────────────────────────────────────

function handleEditorKeydown(e) {
  if (e.key === 'Tab') { e.preventDefault(); insertTab(editor); return; }
  // Auto-close delimiters
  if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1) {
    if (handleAutoClose(editor, e, currentLang())) return;
  }
}

function handleSnippetShortcuts(e) {
  if (!e.ctrlKey && !e.metaKey) return;
  const key = `Ctrl+${e.shiftKey ? 'Shift+' : ''}${e.key.toUpperCase()}`;
  const lang = currentLang();
  const snippet = BUILTIN_SNIPPETS.find(s =>
    s.shortcut === key && (s.lang === lang || s.lang === 'both')
  );
  if (snippet) {
    e.preventDefault();
    applySnippet(editor, snippet);
  }
}

function insertTab(textarea) {
  const s = textarea.selectionStart;
  textarea.value = textarea.value.substring(0, s) + '  ' + textarea.value.substring(textarea.selectionEnd);
  textarea.selectionStart = textarea.selectionEnd = s + 2;
  textarea.dispatchEvent(new Event('input'));
}

// ── Editor toolbar (quick-insert buttons) ─────────────────────────────────────

function buildEditorToolbar() {
  const lang = currentLang();
  const buttons = lang === 'latex'
    ? [
        { label: 'B', title: 'Bold (Ctrl+B)', snippet: '\\textbf{$SELECTION$$CURSOR$}' },
        { label: 'I', title: 'Italic (Ctrl+I)', snippet: '\\textit{$SELECTION$$CURSOR$}' },
        { label: '$', title: 'Inline Math (Ctrl+M)', snippet: '$$$SELECTION$$CURSOR$$$' },
        { label: '$$', title: 'Display Math (Ctrl+Shift+M)', snippet: '\\[\n$SELECTION$$CURSOR$\n\\]' },
        { label: '§', title: 'Section', snippet: '\\section{$CURSOR$}' },
        { label: 'fig', title: 'Figure', snippet: '\\begin{figure}[htbp]\n  \\centering\n  \\includegraphics[width=0.8\\textwidth]{$CURSOR$}\n  \\caption{}\n  \\label{fig:}\n\\end{figure}' },
      ]
    : [
        { label: 'B', title: 'Bold (Ctrl+B)', snippet: '**$SELECTION$$CURSOR$**' },
        { label: 'I', title: 'Italic (Ctrl+I)', snippet: '*$SELECTION$$CURSOR$*' },
        { label: '`', title: 'Code', snippet: '`$SELECTION$$CURSOR$`' },
        { label: '$', title: 'Inline Math (Ctrl+M)', snippet: '$$$SELECTION$$CURSOR$$$' },
        { label: '$$', title: 'Display Math', snippet: '\n$$\n$SELECTION$$CURSOR$\n$$\n' },
        { label: '[]', title: 'Link (Ctrl+K)', snippet: '[$SELECTION$]($CURSOR$)' },
        { label: '>', title: 'Blockquote', snippet: '> $SELECTION$$CURSOR$' },
      ];

  editorToolbar.innerHTML = '';
  for (const b of buttons) {
    const btn = document.createElement('button');
    btn.className = 'tb';
    btn.textContent = b.label;
    btn.title = b.title;
    btn.addEventListener('click', () => {
      applySnippet(editor, { template: b.snippet });
    });
    editorToolbar.appendChild(btn);
  }
}

// ── Snippet palette ───────────────────────────────────────────────────────────

function toggleSnippetPalette() {
  if (!snippetPalette.classList.contains('hidden')) {
    snippetPalette.classList.add('hidden'); return;
  }
  const groups = getSnippetsGrouped(currentLang());
  let html = '';
  for (const [cat, items] of Object.entries(groups)) {
    html += `<div class="snippet-category">${esc(cat)}</div>`;
    for (const s of items) {
      const shortcut = s.shortcut ? `<span class="snippet-shortcut">${esc(s.shortcut)}</span>` : '';
      html += `<div class="snippet-item" data-idx="${BUILTIN_SNIPPETS.indexOf(s)}">${esc(s.label)}${shortcut}</div>`;
    }
  }
  snippetPalette.innerHTML = html;
  snippetPalette.classList.remove('hidden');

  snippetPalette.querySelectorAll('.snippet-item').forEach(el => {
    el.addEventListener('click', () => {
      const all = [...BUILTIN_SNIPPETS];
      const idx = parseInt(el.dataset.idx);
      if (all[idx]) applySnippet(editor, all[idx]);
      snippetPalette.classList.add('hidden');
    });
  });
}

// ── Image handling (cursor-aware) ─────────────────────────────────────────────

function handleDrop(e) {
  e.preventDefault();
  editorPane.classList.remove('dragover');
  const file = e.dataTransfer?.files?.[0];
  if (!file || !file.type.startsWith('image/')) return;

  // Determine cursor position from drop coordinates
  const caretPos = getCaretPositionFromPoint(e.clientX, e.clientY);
  if (caretPos !== null) {
    editor.selectionStart = editor.selectionEnd = caretPos;
  }
  insertImageFile(file);
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

function getCaretPositionFromPoint(x, y) {
  // Use browser API to get text position from screen coordinates
  if (document.caretPositionFromPoint) {
    const pos = document.caretPositionFromPoint(x, y);
    if (pos && pos.offsetNode === editor) return pos.offset;
  }
  if (document.caretRangeFromPoint) {
    const range = document.caretRangeFromPoint(x, y);
    if (range) {
      // For textarea, estimate position from mouse coordinates
      const rect = editor.getBoundingClientRect();
      const lineHeight = parseFloat(getComputedStyle(editor).lineHeight) || 22;
      const charWidth = 8.4; // approximate monospace char width at 14px
      const scrollTop = editor.scrollTop;
      const row = Math.floor((y - rect.top + scrollTop) / lineHeight);
      const col = Math.floor((x - rect.left - 12) / charWidth); // 12px padding

      const lines = editor.value.split('\n');
      let pos = 0;
      for (let i = 0; i < Math.min(row, lines.length); i++) pos += lines[i].length + 1;
      pos += Math.min(Math.max(col, 0), (lines[row] || '').length);
      return Math.min(pos, editor.value.length);
    }
  }
  return null; // fallback: use current cursor position
}

function insertImageFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    const dataUri = reader.result;
    const name = file.name || 'image.png';
    const safeName = name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const altText = safeName.replace(/\.[^.]+$/, '');

    let ref;
    if (currentLang() === 'latex') {
      ref = `\\begin{figure}[htbp]\n  \\centering\n  \\includegraphics[width=0.8\\textwidth]{${safeName}}\n  \\caption{${altText}}\n  \\label{fig:${altText.toLowerCase().replace(/\s+/g, '-')}}\n\\end{figure}`;
    } else {
      ref = `![${altText}](${dataUri})`;
    }
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

// ── PDF Compilation ───────────────────────────────────────────────────────────

function compilePdf() {
  openBottomTab('build');
  appendBuildLog('PDF compilation requires a local LaTeX installation.');
  appendBuildLog('Use the CLI: publisher build <article-dir> --target pdf');
  appendBuildLog('Or install TeX Live and use latexmk directly.');

  if (currentArticle) {
    const source = editor.value;
    const lang = currentLang();
    if (lang === 'latex') {
      appendBuildLog(`LaTeX project: compile main.tex with latexmk -xelatex`);
    } else {
      appendBuildLog(`Markdown project: convert to LaTeX intermediate, then compile.`);
      appendBuildLog(`Source has ${(source.match(/\$/g) || []).length} dollar signs (math delimiters).`);
    }
    appendBuildLog('PDF compilation from the browser UI requires a backend server (planned).');
  }
}

// ── Article Library ───────────────────────────────────────────────────────────

function loadArticles() { try { articles = JSON.parse(localStorage.getItem(SK.ARTICLES) || '[]'); } catch { articles = []; } }
function saveArticles() { localStorage.setItem(SK.ARTICLES, JSON.stringify(articles)); }
function loadFolders() { try { folders = JSON.parse(localStorage.getItem(SK.FOLDERS) || '[]'); } catch { folders = []; } }
function saveFolders() { localStorage.setItem(SK.FOLDERS, JSON.stringify(folders)); }

function createArticle(title, content = '', folder = '', format = 'markdown') {
  const defaultContent = format === 'latex'
    ? `\\documentclass{article}\n\\usepackage{amsmath,amssymb}\n\\begin{document}\n\\title{${title}}\n\\maketitle\n\n$CURSOR$\n\n\\end{document}\n`
    : `# ${title}\n\n`;
  const article = {
    id: crypto.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2),
    title, content: content || defaultContent, folder, format,
    updatedAt: new Date().toISOString(), createdAt: new Date().toISOString(),
  };
  articles.unshift(article); saveArticles();
  return article;
}

function selectArticle(article) {
  if (currentArticle) { currentArticle.content = editor.value; saveArticles(); }
  currentArticle = article;
  editor.value = article.content || '';
  articleTitleDisplay.textContent = article.title;
  editorFormatLabel.textContent = article.format === 'latex' ? 'TeX' : 'MD';
  localStorage.setItem(SK.CURRENT, article.id);
  buildEditorToolbar(); // rebuild for language
  update(); renderLibrary();
}

function deleteArticle(article) {
  if (!confirm(`Delete "${article.title}"?`)) return;
  articles = articles.filter(a => a.id !== article.id); saveArticles();
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
    el.addEventListener('click', () => { const a = articles.find(x => x.id === el.dataset.id); if (a) selectArticle(a); });
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); const a = articles.find(x => x.id === el.dataset.id); if (a) deleteArticle(a); });
  });
}

// ── Bottom Panel / AI ─────────────────────────────────────────────────────────

function openBottomTab(tabName) {
  bottomPanel.classList.remove('hidden');
  bottomPanel.querySelectorAll('.bottom-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
  bottomPanel.querySelectorAll('.bottom-tab-content').forEach(c => c.classList.toggle('active', c.dataset.tab === tabName));
  if (tabName === 'css') openCssEditor();
}

function sendAiPrompt() {
  const prompt = aiPromptInput.value.trim();
  if (!prompt) return;
  const scope = $('ai-scope').value;
  addAiMessage('user', `[${scope}] ${prompt}`);
  aiPromptInput.value = '';

  // Scope-aware response
  const lang = currentLang();
  let response;
  switch (scope) {
    case 'convert-to-latex':
      response = `To convert this ${lang === 'latex' ? 'LaTeX' : 'Markdown'} to LaTeX:\n\n`
        + `Use the CLI with Claude: claude -p "Convert this Markdown to LaTeX, preserving all equations, headings, and structure."\n\n`
        + `The AI backend (src/ai/backend.js) supports this via the LocalClaudeCodeBackend. The converted result will be shown as a diff for review.`;
      break;
    case 'convert-to-md':
      response = `To convert this ${lang === 'latex' ? 'LaTeX' : 'Markdown'} to Markdown:\n\n`
        + `Use the CLI with Claude: claude -p "Convert this LaTeX to Markdown, preserving math in $...$ and $$...$$ syntax."\n\n`
        + `Conversion will preserve headings, equations, theorem/proof structure where representable.`;
      break;
    case 'fix-compile':
      response = `To fix compilation errors:\n\n`
        + `1. Copy the error from the Build Output tab\n`
        + `2. The AI will inspect the compiler log and source to propose a fix\n`
        + `3. Fixes are shown as diffs — accept or reject each change\n\n`
        + `Use locally: claude -p "Fix this LaTeX compilation error: [paste error]"`;
      break;
    default:
      response = `AI editing (${scope}) is available via the Claude Code CLI.\n`
        + `The LocalClaudeCode backend invokes your locally installed claude CLI.\n`
        + `Configure in ~/.config/publisher/config.json.`;
  }
  addAiMessage('assistant', response);
}

function addAiMessage(role, text) {
  const div = document.createElement('div');
  div.className = `ai-msg ${role}`;
  div.textContent = text;
  aiMessages.appendChild(div);
  aiMessages.scrollTop = aiMessages.scrollHeight;
  const w = aiMessages.querySelector('.ai-welcome');
  if (w) w.remove();
}

// ── Style Management (unchanged logic, compressed) ────────────────────────────

function getAllStyles() { return { ...builtinThemes, ...customStyles }; }
function loadCustomStyles() { try { const s = localStorage.getItem(SK.STYLES); if (s) { customStyles = {}; for (const [n, d] of Object.entries(JSON.parse(s))) customStyles[n] = { name: n, css: d.css, source: 'custom' }; } } catch {} }
function saveCustomStyles() { const o = {}; for (const [n, d] of Object.entries(customStyles)) o[n] = { css: d.css }; localStorage.setItem(SK.STYLES, JSON.stringify(o)); }

function rebuildThemeSelector() {
  selectTheme.innerHTML = '';
  for (const [label, items] of [['Built-in', Object.keys(builtinThemes).sort()], ['Custom', Object.keys(customStyles).sort()]]) {
    if (!items.length) continue;
    const g = document.createElement('optgroup'); g.label = label;
    for (const n of items) { const o = document.createElement('option'); o.value = n; o.textContent = n; g.appendChild(o); }
    selectTheme.appendChild(g);
  }
}

function onStyleChange() {
  const all = getAllStyles();
  if (all[selectTheme.value]) { currentStyle = all[selectTheme.value]; localStorage.setItem(SK.SELECTED_STYLE, selectTheme.value); if (!bottomPanel.classList.contains('hidden')) openCssEditor(); update(); }
}

function openCssEditor() {
  cssEditorTextarea.value = currentStyle.css; cssEditorOriginal = currentStyle.css; cssEditorDirty = false; unsavedIndicator.classList.add('hidden');
  cssEditorTitle.textContent = `Style: ${currentStyle.source === 'builtin' ? '[builtin] ' : ''}${currentStyle.name}`;
  const b = currentStyle.source === 'builtin';
  $('btn-css-save').disabled = b; $('btn-css-rename').disabled = b; $('btn-css-delete').disabled = b; $('btn-css-revert').disabled = b;
}

function saveCss() { if (currentStyle.source === 'builtin') { showToast('Use Save As.', 'error'); return; } currentStyle.css = cssEditorTextarea.value; customStyles[currentStyle.name] = { ...currentStyle }; saveCustomStyles(); cssEditorOriginal = cssEditorTextarea.value; cssEditorDirty = false; unsavedIndicator.classList.add('hidden'); showToast('Saved.', 'success'); }
function saveAsCss() { const n = prompt('Name:', `${currentStyle.name}-custom`)?.trim(); if (!n || builtinThemes[n]) return; customStyles[n] = { name: n, css: cssEditorTextarea.value, source: 'custom' }; saveCustomStyles(); rebuildThemeSelector(); selectTheme.value = n; currentStyle = customStyles[n]; localStorage.setItem(SK.SELECTED_STYLE, n); openCssEditor(); update(); showToast(`"${n}" created.`, 'success'); }
function duplicateCss() { const n = prompt('Name:', `${currentStyle.name}-copy`)?.trim(); if (!n || builtinThemes[n]) return; customStyles[n] = { name: n, css: currentStyle.css, source: 'custom' }; saveCustomStyles(); rebuildThemeSelector(); selectTheme.value = n; currentStyle = customStyles[n]; localStorage.setItem(SK.SELECTED_STYLE, n); openCssEditor(); update(); }
function renameCss() { if (currentStyle.source === 'builtin') return; const n = prompt('Name:', currentStyle.name)?.trim(); if (!n || n === currentStyle.name || builtinThemes[n] || customStyles[n]) return; delete customStyles[currentStyle.name]; customStyles[n] = { name: n, css: currentStyle.css, source: 'custom' }; saveCustomStyles(); rebuildThemeSelector(); selectTheme.value = n; currentStyle = customStyles[n]; localStorage.setItem(SK.SELECTED_STYLE, n); openCssEditor(); }
function deleteCss() { if (currentStyle.source === 'builtin' || !confirm(`Delete "${currentStyle.name}"?`)) return; delete customStyles[currentStyle.name]; saveCustomStyles(); rebuildThemeSelector(); currentStyle = builtinThemes['default'] || Object.values(builtinThemes)[0]; selectTheme.value = currentStyle.name; localStorage.setItem(SK.SELECTED_STYLE, currentStyle.name); openCssEditor(); update(); }
function revertCss() { if (currentStyle.source === 'builtin') return; cssEditorTextarea.value = cssEditorOriginal; cssEditorDirty = false; unsavedIndicator.classList.add('hidden'); currentStyle = { ...currentStyle, css: cssEditorOriginal }; update(); }

// ── Rendering ─────────────────────────────────────────────────────────────────

function debouncedUpdate() { clearTimeout(debounceTimer); debounceTimer = setTimeout(update, 200); }

function update() {
  const source = editor.value;
  if (!source.trim()) {
    previewContent.innerHTML = '<div id="nice"><p style="color:#999;text-align:center;">Start writing...</p></div>';
    diagStats.textContent = ''; diagWarnings.textContent = ''; return;
  }

  // LaTeX files: show source as-is in a styled container (no markdown rendering)
  if (currentLang() === 'latex') {
    previewContent.innerHTML = `<div id="nice" style="font-family:monospace;white-space:pre-wrap;padding:16px;font-size:13px;line-height:1.5;color:#333;">${esc(source)}</div>`;
    diagStats.textContent = `LaTeX · ${source.split('\n').length} lines`;
    diagWarnings.textContent = '';
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
  const file = e.target.files?.[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const content = ev.target.result;
    const title = file.name.replace(/\.(md|markdown|txt|tex|sty|cls|bib)$/i, '');
    const fmt = /\.(tex|sty|cls|bib)$/i.test(file.name) ? 'latex' : 'markdown';
    const existing = articles.find(a => a.title === title);
    if (existing) { existing.content = content; existing.format = fmt; existing.updatedAt = new Date().toISOString(); saveArticles(); selectArticle(existing); }
    else { const a = createArticle(title, content, '', fmt); selectArticle(a); }
    renderLibrary(); showToast(`Opened: ${file.name}`, 'success');
  };
  reader.readAsText(file); fileInput.value = '';
}

async function copyRichText() {
  const source = editor.value; if (!source.trim()) return;
  appendBuildLog('Compiling for ' + currentPlatform + '...');
  const rawHtml = renderMarkdown(source);
  const resolvedCss = resolveCssVariables(currentStyle.css);
  const mathHtml = await replaceKatexWithImagesInBrowser(rawHtml, resolvedCss);
  const inlinedHtml = inlineCssSimple(mathHtml, resolvedCss);
  const finalHtml = sanitizeForPlatform(inlinedHtml, currentPlatform);
  appendBuildLog('Done.');
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([finalHtml], { type: 'text/html' }), 'text/plain': new Blob([stripHtml(finalHtml)], { type: 'text/plain' }) })]);
    showToast(`Copied for ${currentPlatform === 'wechat' ? 'WeChat' : 'Zhihu'}!`, 'success');
  } catch (err) { try { await navigator.clipboard.writeText(finalHtml); showToast('Copied as text.', 'success'); } catch { showToast('Copy failed.', 'error'); } }
}

async function copyHtml() {
  const source = editor.value; if (!source.trim()) return;
  const rawHtml = renderMarkdown(source); const resolvedCss = resolveCssVariables(currentStyle.css);
  const mathHtml = await replaceKatexWithImagesInBrowser(rawHtml, resolvedCss);
  const inlinedHtml = inlineCssSimple(mathHtml, resolvedCss);
  const finalHtml = sanitizeForPlatform(inlinedHtml, currentPlatform);
  try { await navigator.clipboard.writeText(finalHtml); showToast('HTML copied!', 'success'); } catch (err) { showToast('Failed.', 'error'); }
}

async function exportHtml() {
  const source = editor.value; if (!source.trim()) return;
  const rawHtml = renderMarkdown(source); const resolvedCss = resolveCssVariables(currentStyle.css);
  const mathHtml = await replaceKatexWithImagesInBrowser(rawHtml, resolvedCss);
  const inlinedHtml = inlineCssSimple(mathHtml, resolvedCss);
  const finalHtml = sanitizeForPlatform(inlinedHtml, currentPlatform);
  const title = esc(currentArticle?.title || 'Article');
  const doc = `<!DOCTYPE html>\n<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${title}</title></head><body>\n${finalHtml}\n</body></html>`;
  const blob = new Blob([doc], { type: 'text/html' }); const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `${(currentArticle?.title || 'article').replace(/[^a-zA-Z0-9_-]/g, '_')}.${currentPlatform}.html`; a.click(); URL.revokeObjectURL(url);
  showToast('Exported!', 'success');
}

// ── Build Log ─────────────────────────────────────────────────────────────────

function appendBuildLog(text) {
  const ts = new Date().toLocaleTimeString();
  if (buildOutput.querySelector('.ai-welcome')) buildOutput.innerHTML = '';
  buildOutput.textContent += `[${ts}] ${text}\n`;
  buildOutput.scrollTop = buildOutput.scrollHeight;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function showToast(msg, type = 'success') {
  const t = document.createElement('div'); t.className = `toast ${type}`; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 2000);
}
function stripHtml(html) { const d = document.createElement('div'); d.innerHTML = html; return d.textContent || ''; }
function esc(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

init();
