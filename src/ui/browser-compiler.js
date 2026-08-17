import MarkdownIt from 'markdown-it';
import footnotePlugin from 'markdown-it-footnote';
import texmathPlugin from 'markdown-it-texmath';
import katex from 'katex';
import hljs from 'highlight.js';

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildCodeBlockHtml(code, language) {
  let highlighted;
  let lang = language;

  if (language && hljs.getLanguage(language)) {
    try {
      const result = hljs.highlight(code, { language, ignoreIllegals: true });
      highlighted = result.value;
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

function createRenderer() {
  const md = new MarkdownIt({
    html: false,
    linkify: true,
    typographer: false,
    breaks: false,
  });

  md.use(footnotePlugin);
  md.use(texmathPlugin, {
    engine: katex,
    delimiters: 'dollars',
    katexOptions: {
      throwOnError: false,
      strict: false,
      trust: true,
      output: 'htmlAndMathml',
    },
  });

  md.renderer.rules.fence = (tokens, idx) => {
    const token = tokens[idx];
    const code = token.content;
    const lang = token.info.trim().split(/\s+/)[0] || '';
    return buildCodeBlockHtml(code, lang);
  };

  md.renderer.rules.code_block = (tokens, idx) => {
    return buildCodeBlockHtml(tokens[idx].content, '');
  };

  return md;
}

const md = createRenderer();

/**
 * Render markdown source to HTML scoped under #nice.
 */
export function renderMarkdown(source) {
  const env = {};
  const bodyHtml = md.render(source, env);
  return `<div id="nice">\n${bodyHtml}\n</div>`;
}

/**
 * Resolve CSS variables in a stylesheet.
 */
export function resolveCssVariables(css) {
  const vars = {};
  const varDefPattern = /(--[\w-]+)\s*:\s*([^;]+);/g;
  let match;
  while ((match = varDefPattern.exec(css)) !== null) {
    vars[match[1]] = match[2].trim();
  }

  let resolved = css;
  let iterations = 0;
  while (/var\(--[\w-]+\)/.test(resolved) && iterations < 10) {
    resolved = resolved.replace(/var\((--[\w-]+)(?:\s*,\s*([^)]+))?\)/g, (_, name, fallback) => {
      return vars[name] || fallback || '';
    });
    iterations++;
  }
  return resolved;
}

/**
 * Inline CSS into HTML using a simple browser-based approach.
 * For production export, we use juice on the server side.
 * For preview, we inject a <style> tag (faster and sufficient).
 */
export function inlineCssSimple(html, css) {
  // For clipboard/export, we use a DOM-based inliner
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const style = doc.createElement('style');
  style.textContent = css;
  doc.head.appendChild(style);

  // Apply computed styles inline
  const root = doc.querySelector('#nice');
  if (!root) return html;

  inlineStyles(doc, root);

  // Remove style tag
  style.remove();

  return root.outerHTML;
}

function inlineStyles(doc, root) {
  // Get all stylesheets
  const sheets = doc.styleSheets;
  const rules = [];

  for (const sheet of sheets) {
    try {
      for (const rule of sheet.cssRules) {
        if (rule.type === CSSRule.STYLE_RULE) {
          rules.push(rule);
        }
      }
    } catch { /* cross-origin */ }
  }

  // Sort rules by specificity (simplified)
  // Apply to matching elements
  const allElements = root.querySelectorAll('*');
  const elementsArray = [root, ...allElements];

  for (const el of elementsArray) {
    const computedStyle = doc.defaultView?.getComputedStyle(el);
    if (!computedStyle) continue;

    // Collect matching rules
    for (const rule of rules) {
      try {
        if (el.matches(rule.selectorText)) {
          // Apply each property from the rule
          for (let i = 0; i < rule.style.length; i++) {
            const prop = rule.style[i];
            const val = rule.style.getPropertyValue(prop);
            const priority = rule.style.getPropertyPriority(prop);
            el.style.setProperty(prop, val, priority);
          }
        }
      } catch { /* invalid selector */ }
    }
  }
}

/**
 * Apply platform-specific sanitization.
 */
export function sanitizeForPlatform(html, platform) {
  let result = html;

  // Common sanitization
  result = result.replace(/<script[\s\S]*?<\/script>/gi, '');
  result = result.replace(/<style[\s\S]*?<\/style>/gi, '');
  result = result.replace(/<link[^>]*>/gi, '');
  result = result.replace(/<iframe[\s\S]*?<\/iframe>/gi, '');
  result = result.replace(/\s+on\w+="[^"]*"/gi, '');

  if (platform === 'wechat') {
    // Remove class attributes after inlining
    result = result.replace(/\s+class="[^"]*"/gi, '');
    // Remove id attributes except root
    result = result.replace(/(<(?!div|section)[^>]*)\s+id="(?!nice)[^"]*"/gi, '$1');
  } else if (platform === 'zhihu') {
    // Keep classes, remove IDs
    result = result.replace(/\s+id="[^"]*"/gi, '');
  }

  return result;
}

/**
 * Count math expressions in source.
 */
export function countMathExpressions(source) {
  let display = 0;
  let inline = 0;

  const displayPattern = /\$\$([\s\S]+?)\$\$/g;
  const displayRanges = [];
  let match;
  while ((match = displayPattern.exec(source)) !== null) {
    display++;
    displayRanges.push([match.index, match.index + match[0].length]);
  }

  const inlinePattern = /\$([^$\n]+?)\$/g;
  while ((match = inlinePattern.exec(source)) !== null) {
    const pos = match.index;
    const inDisplay = displayRanges.some(([start, end]) => pos >= start && pos < end);
    if (!inDisplay) inline++;
  }

  return { inline, display, total: inline + display };
}

/**
 * Validate compiled HTML.
 */
export function validate(html, source, platform) {
  const warnings = [];
  const errors = [];
  const stats = {};

  stats.paragraphs = (html.match(/<p[\s>]/g) || []).length;
  stats.headings = (html.match(/<h[1-6][\s>]/g) || []).length;
  stats.codeBlocks = (html.match(/code-block-wrapper/g) || []).length;
  stats.tables = (html.match(/<table[\s>]/g) || []).length;
  stats.links = (html.match(/<a[\s>]/g) || []).length;
  stats.images = (html.match(/<img[\s>]/g) || []).length;

  const mathCounts = countMathExpressions(source);
  stats.mathDisplay = mathCounts.display;
  stats.mathInline = mathCounts.inline;
  stats.mathTotal = mathCounts.total;

  const katexErrors = (html.match(/katex-error/g) || []).length;
  const mathErrors = (html.match(/math-error/g) || []).length;
  if (katexErrors + mathErrors > 0) {
    errors.push(`${katexErrors + mathErrors} math expression(s) failed to render`);
  }

  if (/<script[\s>]/i.test(html)) errors.push('Script tags detected');
  if (/<iframe[\s>]/i.test(html)) errors.push('Iframe tags detected');

  if (/var\(--[\w-]+\)/.test(html)) {
    warnings.push('Unresolved CSS variable(s) in output');
  }

  return { valid: errors.length === 0, errors, warnings, stats };
}
