import hljs from 'highlight.js';

/**
 * Render a code block with syntax highlighting.
 * Returns deterministic HTML suitable for CSS inlining.
 */
export function highlightCode(code, language = '') {
  let highlighted;
  let detectedLang = language;

  if (language && hljs.getLanguage(language)) {
    try {
      const result = hljs.highlight(code, { language, ignoreIllegals: true });
      highlighted = result.value;
      detectedLang = language;
    } catch {
      highlighted = escapeHtml(code);
    }
  } else if (language) {
    // Unknown language, render without highlighting
    highlighted = escapeHtml(code);
  } else {
    // Auto-detect
    try {
      const result = hljs.highlightAuto(code);
      highlighted = result.value;
      detectedLang = result.language || '';
    } catch {
      highlighted = escapeHtml(code);
    }
  }

  return { html: highlighted, language: detectedLang };
}

/**
 * Build complete code block HTML.
 * Mobile-friendly: uses overflow-x auto and max-width 100%.
 */
export function buildCodeBlockHtml(code, language = '') {
  const { html, language: lang } = highlightCode(code, language);
  const langClass = lang ? ` hljs language-${lang}` : ' hljs';
  const langLabel = lang ? `<span class="code-lang">${escapeHtml(lang)}</span>` : '';

  return `<div class="code-block-wrapper">
${langLabel}<pre class="code-block"><code class="${langClass}">${html}</code></pre>
</div>`;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
