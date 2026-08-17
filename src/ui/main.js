import {
  renderMarkdown,
  resolveCssVariables,
  inlineCssSimple,
  sanitizeForPlatform,
  validate,
} from './browser-compiler.js';
import { replaceKatexWithImagesInBrowser } from './math-to-image.js';
import 'katex/dist/katex.min.css';

// ── Theme / Style Storage ─────────────────────────────────────────────────────
// Builtin themes: bundled at build time from themes/builtin/*.css
// Custom styles: persisted in localStorage under "publisher_custom_styles"
// Selected style: persisted in localStorage under "publisher_selected_style"

const STORAGE_KEY_STYLES = 'publisher_custom_styles';
const STORAGE_KEY_SELECTED = 'publisher_selected_style';

const builtinThemeModules = import.meta.glob('/themes/builtin/*.css', { query: '?raw', import: 'default' });

// State
let builtinThemes = {};  // { name: { name, css, source:'builtin' } }
let customStyles = {};   // { name: { name, css, source:'custom' } }
let currentStyle = { name: 'default', css: '', source: 'builtin' };
let currentPlatform = 'wechat';
let cssEditorDirty = false;
let cssEditorOriginal = '';
let debounceTimer = null;

// DOM
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

  // Load custom styles from localStorage
  loadCustomStyles();

  // Populate theme selector
  rebuildThemeSelector();

  // Restore selected style
  const savedSelected = localStorage.getItem(STORAGE_KEY_SELECTED);
  if (savedSelected && getAllStyles()[savedSelected]) {
    selectTheme.value = savedSelected;
    currentStyle = getAllStyles()[savedSelected];
  } else if (builtinThemes['default']) {
    selectTheme.value = 'default';
    currentStyle = builtinThemes['default'];
  }

  // Load sample content
  if (!editor.value) {
    editor.value = getDefaultContent();
  }

  // Event listeners
  editor.addEventListener('input', () => debouncedUpdate());
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
    // Live preview
    currentStyle = { ...currentStyle, css: cssEditorTextarea.value };
    update();
  });

  // Tab in editor
  editor.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      editor.value = editor.value.substring(0, start) + '  ' + editor.value.substring(end);
      editor.selectionStart = editor.selectionEnd = start + 2;
      debouncedUpdate();
    }
  });

  // Tab in CSS editor
  cssEditorTextarea.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = cssEditorTextarea.selectionStart;
      const end = cssEditorTextarea.selectionEnd;
      cssEditorTextarea.value = cssEditorTextarea.value.substring(0, start) + '  ' + cssEditorTextarea.value.substring(end);
      cssEditorTextarea.selectionStart = cssEditorTextarea.selectionEnd = start + 2;
      cssEditorTextarea.dispatchEvent(new Event('input'));
    }
  });

  update();
}

// ── Style Management ──────────────────────────────────────────────────────────

function getAllStyles() {
  return { ...builtinThemes, ...customStyles };
}

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
  } catch { /* ignore corrupt data */ }
}

function saveCustomStyles() {
  const toStore = {};
  for (const [name, data] of Object.entries(customStyles)) {
    toStore[name] = { css: data.css };
  }
  localStorage.setItem(STORAGE_KEY_STYLES, JSON.stringify(toStore));
}

function rebuildThemeSelector() {
  selectTheme.innerHTML = '';
  const all = getAllStyles();
  const builtinNames = Object.keys(builtinThemes).sort();
  const customNames = Object.keys(customStyles).sort();

  if (builtinNames.length > 0) {
    const group = document.createElement('optgroup');
    group.label = 'Built-in';
    for (const name of builtinNames) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      group.appendChild(opt);
    }
    selectTheme.appendChild(group);
  }

  if (customNames.length > 0) {
    const group = document.createElement('optgroup');
    group.label = 'Custom';
    for (const name of customNames) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
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
    // Update CSS editor if open
    if (!cssEditorPanel.classList.contains('hidden')) {
      openCssEditor();
    }
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

  // Builtin styles: disable save/rename/delete, enable save-as/duplicate
  const isBuiltin = currentStyle.source === 'builtin';
  btnCssSave.disabled = isBuiltin;
  btnCssRename.disabled = isBuiltin;
  btnCssDelete.disabled = isBuiltin;
  btnCssRevert.disabled = isBuiltin;
}

function saveCss() {
  if (currentStyle.source === 'builtin') {
    showToast('Cannot overwrite built-in style. Use "Save As" to create a custom copy.', 'error');
    return;
  }
  currentStyle.css = cssEditorTextarea.value;
  customStyles[currentStyle.name] = { ...currentStyle };
  saveCustomStyles();
  cssEditorOriginal = cssEditorTextarea.value;
  cssEditorDirty = false;
  unsavedIndicator.classList.add('hidden');
  showToast(`Style "${currentStyle.name}" saved.`, 'success');
}

function saveAsCss() {
  const name = prompt('Name for new custom style:', `${currentStyle.name}-custom`);
  if (!name || !name.trim()) return;
  const trimmed = name.trim();

  if (builtinThemes[trimmed]) {
    showToast('Cannot use a built-in style name.', 'error');
    return;
  }

  customStyles[trimmed] = { name: trimmed, css: cssEditorTextarea.value, source: 'custom' };
  saveCustomStyles();
  rebuildThemeSelector();

  selectTheme.value = trimmed;
  currentStyle = customStyles[trimmed];
  localStorage.setItem(STORAGE_KEY_SELECTED, trimmed);
  openCssEditor();
  update();
  showToast(`Custom style "${trimmed}" created.`, 'success');
}

function duplicateCss() {
  const name = prompt('Name for duplicate:', `${currentStyle.name}-copy`);
  if (!name || !name.trim()) return;
  const trimmed = name.trim();

  if (builtinThemes[trimmed]) {
    showToast('Cannot use a built-in style name.', 'error');
    return;
  }

  customStyles[trimmed] = { name: trimmed, css: currentStyle.css, source: 'custom' };
  saveCustomStyles();
  rebuildThemeSelector();
  selectTheme.value = trimmed;
  currentStyle = customStyles[trimmed];
  localStorage.setItem(STORAGE_KEY_SELECTED, trimmed);
  openCssEditor();
  update();
  showToast(`Style duplicated as "${trimmed}".`, 'success');
}

function renameCss() {
  if (currentStyle.source === 'builtin') return;
  const name = prompt('New name:', currentStyle.name);
  if (!name || !name.trim() || name.trim() === currentStyle.name) return;
  const trimmed = name.trim();

  if (builtinThemes[trimmed] || customStyles[trimmed]) {
    showToast('A style with that name already exists.', 'error');
    return;
  }

  const oldName = currentStyle.name;
  delete customStyles[oldName];
  customStyles[trimmed] = { name: trimmed, css: currentStyle.css, source: 'custom' };
  saveCustomStyles();
  rebuildThemeSelector();
  selectTheme.value = trimmed;
  currentStyle = customStyles[trimmed];
  localStorage.setItem(STORAGE_KEY_SELECTED, trimmed);
  openCssEditor();
  showToast(`Renamed "${oldName}" to "${trimmed}".`, 'success');
}

function deleteCss() {
  if (currentStyle.source === 'builtin') return;
  if (!confirm(`Delete custom style "${currentStyle.name}"?`)) return;

  delete customStyles[currentStyle.name];
  saveCustomStyles();
  rebuildThemeSelector();

  // Switch to default
  currentStyle = builtinThemes['default'] || Object.values(builtinThemes)[0];
  selectTheme.value = currentStyle.name;
  localStorage.setItem(STORAGE_KEY_SELECTED, currentStyle.name);
  openCssEditor();
  update();
  showToast('Style deleted.', 'success');
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
    previewContent.innerHTML = '<div id="nice"><p style="color:#999;text-align:center;">Enter Markdown to preview...</p></div>';
    diagStats.textContent = '';
    diagWarnings.textContent = '';
    return;
  }

  const rawHtml = renderMarkdown(source);
  const resolvedCss = resolveCssVariables(currentStyle.css);
  previewContent.innerHTML = `<style>${resolvedCss}</style>\n${rawHtml}`;

  const validation = validate(rawHtml, source, currentPlatform);
  updateDiagnostics(validation);
}

function updateDiagnostics(validation) {
  const { stats, warnings, errors } = validation;
  diagStats.textContent = [
    `${stats.paragraphs}P`, `${stats.headings}H`, `${stats.mathTotal}Math`,
    `${stats.codeBlocks}Code`, `${stats.images}Img`, `${stats.tables}Tbl`,
  ].join(' | ');

  const issues = [];
  for (const e of errors) issues.push(`[E] ${e}`);
  for (const w of warnings) issues.push(`[W] ${w}`);
  diagWarnings.textContent = issues.join(' | ');
  diagWarnings.className = errors.length > 0 ? 'error' : warnings.length > 0 ? 'warning' : '';
}

// ── File / Export ─────────────────────────────────────────────────────────────

function handleFileOpen(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => { editor.value = ev.target.result; update(); showToast(`Opened: ${file.name}`, 'success'); };
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
    const blob = new Blob([finalHtml], { type: 'text/html' });
    const plainBlob = new Blob([stripHtml(finalHtml)], { type: 'text/plain' });
    await navigator.clipboard.write([new ClipboardItem({ 'text/html': blob, 'text/plain': plainBlob })]);
    showToast(`Copied for ${currentPlatform === 'wechat' ? 'WeChat' : 'Zhihu'}!`, 'success');
  } catch (err) {
    try {
      await navigator.clipboard.writeText(finalHtml);
      showToast('Copied HTML as text (rich text not supported in this browser)', 'success');
    } catch { showToast('Copy failed: ' + err.message, 'error'); }
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
  const fullDoc = `<!DOCTYPE html>\n<html lang="zh-CN">\n<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Article</title></head>\n<body>\n${finalHtml}\n</body>\n</html>`;
  const blob = new Blob([fullDoc], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `article.${currentPlatform}.html`; a.click();
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
  const tmp = document.createElement('div'); tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || '';
}

function getDefaultContent() {
  return `# Hello MDTeX Pipeline

Write your **Markdown** with $\\LaTeX$ math here.

## Inline Math

The quadratic formula is $x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$.

## Display Math

$$
\\int_{-\\infty}^{\\infty} e^{-x^2} \\, dx = \\sqrt{\\pi}
$$

## Code

\`\`\`python
def hello():
    print("Hello, WeChat!")
\`\`\`

> This is a blockquote with math: $E = mc^2$

| Column A | Column B |
|----------|----------|
| 1        | 2        |
| 3        | 4        |
`;
}

init();
