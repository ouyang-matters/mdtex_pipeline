/**
 * Frozen snapshot of the pre-backend browser WeChat path.
 *
 * This is the code that used to run on the browser main thread when the user
 * pressed "Copy for Platform", preserved verbatim (minus Vite-specific asset
 * imports) so scripts/bench-wechat.js can keep measuring what was replaced.
 *
 * DO NOT use this in the application. It exists only for the benchmark.
 */

import { readFileSync } from 'fs';
import { join, resolve } from 'path';
import MarkdownIt from 'markdown-it';
import footnotePlugin from 'markdown-it-footnote';
import texmathPlugin from 'markdown-it-texmath';
import katex from 'katex';
import hljs from 'highlight.js';

const appRoot = resolve(import.meta.dirname, '..');

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildCodeBlockHtml(code, language) {
  let highlighted;
  let lang = language;
  if (language && hljs.getLanguage(language)) {
    try {
      highlighted = hljs.highlight(code, { language, ignoreIllegals: true }).value;
    } catch {
      highlighted = escapeHtml(code);
    }
  } else {
    highlighted = escapeHtml(code);
    lang = '';
  }
  const langClass = lang ? ` hljs language-${lang}` : ' hljs';
  const langLabel = lang ? `<span class="code-lang">${escapeHtml(lang)}</span>` : '';
  return `<div class="code-block-wrapper">\n${langLabel}<pre class="code-block"><code class="${langClass}">${highlighted}</code></pre>\n</div>`;
}

const md = (() => {
  const parser = new MarkdownIt({ html: false, linkify: true, typographer: false, breaks: false });
  parser.use(footnotePlugin);
  parser.use(texmathPlugin, {
    engine: katex,
    delimiters: 'dollars',
    katexOptions: { throwOnError: false, strict: false, trust: true, output: 'htmlAndMathml' },
  });
  parser.renderer.rules.fence = (tokens, idx) =>
    buildCodeBlockHtml(tokens[idx].content, tokens[idx].info.trim().split(/\s+/)[0] || '');
  parser.renderer.rules.code_block = (tokens, idx) => buildCodeBlockHtml(tokens[idx].content, '');
  return parser;
})();

export function renderMarkdown(source) {
  return `<div id="nice">\n${md.render(source, {})}\n</div>`;
}

export function resolveCssVariables(css) {
  const vars = {};
  const varDefPattern = /(--[\w-]+)\s*:\s*([^;]+);/g;
  let match;
  while ((match = varDefPattern.exec(css)) !== null) vars[match[1]] = match[2].trim();

  let resolved = css;
  let iterations = 0;
  while (/var\(--[\w-]+\)/.test(resolved) && iterations < 10) {
    resolved = resolved.replace(/var\((--[\w-]+)(?:\s*,\s*([^)]+))?\)/g, (_, name, fallback) => vars[name] || fallback || '');
    iterations++;
  }
  return resolved;
}

// ── The two hot spots ────────────────────────────────────────────────────────

let _katexCss = null;
function getKatexCss() {
  if (_katexCss === null) {
    _katexCss = readFileSync(join(appRoot, 'node_modules', 'katex', 'dist', 'katex.min.css'), 'utf-8');
  }
  return _katexCss;
}

/**
 * Original math-to-image.js: renders every formula into its own foreignObject
 * SVG data URI, with a full copy of katex.min.css embedded in each one.
 */
export async function replaceKatexWithImagesInBrowser(html, themeCss) {
  const katexCss = getKatexCss();

  const container = document.createElement('div');
  container.style.cssText = 'position:absolute;left:-9999px;top:-9999px;visibility:hidden;';
  container.innerHTML = `<style>${katexCss}\n${themeCss}</style>\n${html}`;
  document.body.appendChild(container);

  try {
    for (const eqn of container.querySelectorAll('eqn')) {
      const latex = eqn.querySelector('annotation[encoding="application/x-tex"]')?.textContent?.trim() || '';
      const katexEl = eqn.querySelector('.katex-display') || eqn.querySelector('.katex');
      if (!katexEl) continue;
      const imgTag = katexElementToImg(katexEl, latex, true, katexCss);
      if (imgTag) {
        const section = eqn.closest('section') || eqn.parentElement;
        const wrapper = document.createElement('section');
        wrapper.style.cssText = 'text-align:center;margin:1em 0;overflow-x:auto;overflow-y:hidden;';
        wrapper.innerHTML = imgTag;
        section.replaceWith(wrapper);
      }
    }

    for (const eq of container.querySelectorAll('eq')) {
      const latex = eq.querySelector('annotation[encoding="application/x-tex"]')?.textContent?.trim() || '';
      const katexEl = eq.querySelector('.katex');
      if (!katexEl) continue;
      const imgTag = katexElementToImg(katexEl, latex, false, katexCss);
      if (imgTag) {
        const holder = document.createElement('span');
        holder.innerHTML = imgTag;
        eq.replaceWith(holder.firstChild);
      }
    }

    container.querySelector('style')?.remove();
    return container.innerHTML;
  } finally {
    document.body.removeChild(container);
  }
}

function katexElementToImg(katexEl, latex, displayMode, katexCss) {
  try {
    const rect = katexEl.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;

    const scale = 2;
    const width = Math.ceil(rect.width * scale);
    const height = Math.ceil(rect.height * scale);

    const computedStyle = window.getComputedStyle(katexEl);
    const fontSize = computedStyle.fontSize;
    const color = computedStyle.color;
    const clone = katexEl.cloneNode(true);

    const svgHtml = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${rect.width} ${rect.height}">
      <foreignObject width="${rect.width}" height="${rect.height}">
        <div xmlns="http://www.w3.org/1999/xhtml" style="font-size:${fontSize};color:${color};margin:0;padding:0;">
          <style>${katexCss}</style>
          ${clone.outerHTML}
        </div>
      </foreignObject>
    </svg>`;

    const dataUri = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgHtml)));
    const escapedLatex = latex.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    return displayMode
      ? `<img src="${dataUri}" alt="${escapedLatex}" data-latex="${escapedLatex}" data-display="true" style="max-width:100%;height:auto;vertical-align:middle;" />`
      : `<img src="${dataUri}" alt="${escapedLatex}" data-latex="${escapedLatex}" data-display="false" style="height:${rect.height}px;vertical-align:middle;margin:0 0.15em;display:inline;" />`;
  } catch {
    return null;
  }
}

/**
 * Original browser-compiler.js inliner: one getComputedStyle() per element plus
 * a full rules × elements matches() sweep.
 */
export function inlineCssSimple(html, css) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const style = doc.createElement('style');
  style.textContent = css;
  doc.head.appendChild(style);

  const root = doc.querySelector('#nice');
  if (!root) return html;

  const rules = [];
  for (const sheet of doc.styleSheets) {
    try {
      for (const rule of sheet.cssRules) {
        if (rule.type === CSSRule.STYLE_RULE) rules.push(rule);
      }
    } catch { /* cross-origin */ }
  }

  const elementsArray = [root, ...root.querySelectorAll('*')];
  for (const el of elementsArray) {
    const computedStyle = doc.defaultView?.getComputedStyle(el);
    if (!computedStyle) continue;
    for (const rule of rules) {
      try {
        if (el.matches(rule.selectorText)) {
          for (let i = 0; i < rule.style.length; i++) {
            const prop = rule.style[i];
            el.style.setProperty(prop, rule.style.getPropertyValue(prop), rule.style.getPropertyPriority(prop));
          }
        }
      } catch { /* invalid selector */ }
    }
  }

  style.remove();
  return root.outerHTML;
}

export function sanitizeForPlatform(html, platform) {
  let result = html;
  result = result.replace(/<script[\s\S]*?<\/script>/gi, '');
  result = result.replace(/<style[\s\S]*?<\/style>/gi, '');
  result = result.replace(/<link[^>]*>/gi, '');
  result = result.replace(/<iframe[\s\S]*?<\/iframe>/gi, '');
  result = result.replace(/\s+on\w+="[^"]*"/gi, '');
  if (platform === 'wechat') {
    result = result.replace(/\s+class="[^"]*"/gi, '');
    result = result.replace(/(<(?!div|section)[^>]*)\s+id="(?!nice)[^"]*"/gi, '$1');
  } else if (platform === 'zhihu') {
    result = result.replace(/\s+id="[^"]*"/gi, '');
  }
  return result;
}

// Browser `unescape(encodeURIComponent(s))` turns a JS string into a latin1
// binary string, which is what btoa() expects. This is the Node equivalent.
function unescape(s) {
  return Buffer.from(decodeURIComponent(s), 'utf8').toString('latin1');
}
