import {
  renderMarkdown,
  resolveCssVariables,
  inlineCssSimple,
  sanitizeForPlatform,
  validate,
} from './browser-compiler.js';
import { replaceKatexWithImagesInBrowser } from './math-to-image.js';
import 'katex/dist/katex.min.css';

// Theme loading - load from both builtin and legacy locations
const builtinThemeModules = import.meta.glob('/themes/builtin/*.css', { query: '?raw', import: 'default' });
const legacyThemeModules = import.meta.glob('/themes/*.css', { query: '?raw', import: 'default' });
const themeModules = { ...legacyThemeModules, ...builtinThemeModules };

// State
let currentTheme = { name: 'default', css: '' };
let currentPlatform = 'wechat';
let themes = {};
let debounceTimer = null;

// DOM elements
const editor = document.getElementById('editor');
const previewContent = document.getElementById('preview-content');
const selectTheme = document.getElementById('select-theme');
const selectPlatform = document.getElementById('select-platform');
const btnOpen = document.getElementById('btn-open');
const fileInput = document.getElementById('file-input');
const btnCopyRich = document.getElementById('btn-copy-rich');
const btnCopyHtml = document.getElementById('btn-copy-html');
const btnExport = document.getElementById('btn-export');
const btnReloadCss = document.getElementById('btn-reload-css');
const diagStats = document.getElementById('diag-stats');
const diagWarnings = document.getElementById('diag-warnings');
const previewPlatformLabel = document.getElementById('preview-platform-label');

// Initialize
async function init() {
  // Load all themes
  for (const [path, loader] of Object.entries(themeModules)) {
    const name = path.replace('/themes/builtin/', '').replace('/themes/', '').replace('.css', '');
    const css = await loader();
    themes[name] = { name, css, path };
  }

  // Populate theme selector
  for (const name of Object.keys(themes).sort()) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    selectTheme.appendChild(opt);
  }

  if (themes['default']) {
    selectTheme.value = 'default';
    currentTheme = themes['default'];
  } else {
    const first = Object.keys(themes)[0];
    if (first) {
      selectTheme.value = first;
      currentTheme = themes[first];
    }
  }

  // Load sample content if editor is empty
  if (!editor.value) {
    editor.value = getDefaultContent();
  }

  // Set up event listeners
  editor.addEventListener('input', () => debouncedUpdate());
  selectTheme.addEventListener('change', () => {
    currentTheme = themes[selectTheme.value] || currentTheme;
    update();
  });
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
  btnReloadCss.addEventListener('click', reloadCss);

  // Handle tab key in editor
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

  update();
}

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

  // Render markdown
  const rawHtml = renderMarkdown(source);

  // Apply theme CSS for preview (inject as style tag for speed)
  const resolvedCss = resolveCssVariables(currentTheme.css);
  previewContent.innerHTML = `<style>${resolvedCss}</style>\n${rawHtml}`;

  // Validate
  const validation = validate(rawHtml, source, currentPlatform);
  updateDiagnostics(validation);
}

function updateDiagnostics(validation) {
  const { stats, warnings, errors } = validation;
  const parts = [
    `${stats.paragraphs}P`,
    `${stats.headings}H`,
    `${stats.mathTotal}Math`,
    `${stats.codeBlocks}Code`,
    `${stats.images}Img`,
    `${stats.tables}Tbl`,
  ];
  diagStats.textContent = parts.join(' | ');

  const issues = [];
  for (const e of errors) issues.push(`[E] ${e}`);
  for (const w of warnings) issues.push(`[W] ${w}`);
  diagWarnings.textContent = issues.join(' | ');
  if (errors.length > 0) {
    diagWarnings.className = 'error';
  } else if (warnings.length > 0) {
    diagWarnings.className = 'warning';
  } else {
    diagWarnings.className = '';
  }
}

function handleFileOpen(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (ev) => {
    editor.value = ev.target.result;
    update();
    showToast(`Opened: ${file.name}`, 'success');
  };
  reader.readAsText(file);
  fileInput.value = ''; // reset for re-opening same file
}

async function copyRichText() {
  const source = editor.value;
  if (!source.trim()) return;

  const rawHtml = renderMarkdown(source);
  const resolvedCss = resolveCssVariables(currentTheme.css);

  // Replace KaTeX math with SVG images for publishing
  const mathProcessedHtml = await replaceKatexWithImagesInBrowser(rawHtml, resolvedCss);

  // Inline CSS using DOM-based approach
  const inlinedHtml = inlineCssSimple(mathProcessedHtml, resolvedCss);

  // Sanitize for target platform
  const finalHtml = sanitizeForPlatform(inlinedHtml, currentPlatform);

  try {
    const blob = new Blob([finalHtml], { type: 'text/html' });
    const plainBlob = new Blob([stripHtml(finalHtml)], { type: 'text/plain' });

    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': blob,
        'text/plain': plainBlob,
      }),
    ]);
    showToast(`Copied for ${currentPlatform === 'wechat' ? 'WeChat' : 'Zhihu'}!`, 'success');
  } catch (err) {
    // Fallback: copy HTML as text
    try {
      await navigator.clipboard.writeText(finalHtml);
      showToast('Copied HTML as text (rich text copy not supported in this browser)', 'success');
    } catch {
      showToast('Copy failed: ' + err.message, 'error');
    }
  }
}

async function copyHtml() {
  const source = editor.value;
  if (!source.trim()) return;

  const rawHtml = renderMarkdown(source);
  const resolvedCss = resolveCssVariables(currentTheme.css);
  const mathProcessedHtml = await replaceKatexWithImagesInBrowser(rawHtml, resolvedCss);
  const inlinedHtml = inlineCssSimple(mathProcessedHtml, resolvedCss);
  const finalHtml = sanitizeForPlatform(inlinedHtml, currentPlatform);

  try {
    await navigator.clipboard.writeText(finalHtml);
    showToast('HTML copied to clipboard!', 'success');
  } catch (err) {
    showToast('Copy failed: ' + err.message, 'error');
  }
}

async function exportHtml() {
  const source = editor.value;
  if (!source.trim()) return;

  const rawHtml = renderMarkdown(source);
  const resolvedCss = resolveCssVariables(currentTheme.css);
  const mathProcessedHtml = await replaceKatexWithImagesInBrowser(rawHtml, resolvedCss);
  const inlinedHtml = inlineCssSimple(mathProcessedHtml, resolvedCss);
  const finalHtml = sanitizeForPlatform(inlinedHtml, currentPlatform);

  const fullDoc = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Article</title>
</head>
<body>
${finalHtml}
</body>
</html>`;

  const blob = new Blob([fullDoc], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `article.${currentPlatform}.html`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Exported!', 'success');
}

async function reloadCss() {
  // Reload themes by re-importing
  for (const [path, loader] of Object.entries(themeModules)) {
    const name = path.replace('/themes/builtin/', '').replace('/themes/', '').replace('.css', '');
    // Vite will return cached version in dev, but we can invalidate
    try {
      const css = await loader();
      themes[name] = { name, css, path };
    } catch { /* ignore */ }
  }
  if (themes[selectTheme.value]) {
    currentTheme = themes[selectTheme.value];
  }
  update();
  showToast('CSS reloaded!', 'success');
}

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

// Boot
init();
