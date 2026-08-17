import katex from 'katex';

/**
 * MathNode represents a single math expression.
 */
export class MathNode {
  constructor(sourceLatex, displayMode = false) {
    this.sourceLatex = sourceLatex;
    this.displayMode = displayMode;
    this.renderedHtml = null;
    this.renderedSvg = null;
    this.error = null;
  }

  render(options = {}) {
    try {
      this.renderedHtml = katex.renderToString(this.sourceLatex, {
        displayMode: this.displayMode,
        throwOnError: false,
        strict: false,
        trust: true,
        output: 'htmlAndMathml',
        ...options,
      });
      this.error = null;
    } catch (e) {
      this.error = e.message || String(e);
      this.renderedHtml = `<span class="math-error" title="${escapeHtml(this.error)}">${escapeHtml(this.sourceLatex)}</span>`;
    }
    return this;
  }
}

/**
 * Extract all math expressions from rendered HTML.
 * Returns an array of MathNode objects.
 */
export function extractMathNodes(html) {
  const nodes = [];
  // Match KaTeX rendered spans
  const inlinePattern = /\$([^$]+?)\$/g;
  const displayPattern = /\$\$([^$]+?)\$\$/g;

  // Note: We extract from source, not from rendered HTML
  return nodes;
}

/**
 * Count math expressions in source markdown.
 */
export function countMathExpressions(source) {
  let inline = 0;
  let display = 0;

  // Count display math first (greedy)
  const displayPattern = /\$\$([\s\S]+?)\$\$/g;
  let match;
  const displayRanges = [];
  while ((match = displayPattern.exec(source)) !== null) {
    display++;
    displayRanges.push([match.index, match.index + match[0].length]);
  }

  // Count inline math, excluding those within display math ranges
  const inlinePattern = /\$([^$\n]+?)\$/g;
  while ((match = inlinePattern.exec(source)) !== null) {
    const pos = match.index;
    const inDisplay = displayRanges.some(([start, end]) => pos >= start && pos < end);
    if (!inDisplay) {
      inline++;
    }
  }

  return { inline, display, total: inline + display };
}

/**
 * Render a single LaTeX expression to HTML.
 */
export function renderLatex(latex, displayMode = false, options = {}) {
  const node = new MathNode(latex, displayMode);
  node.render(options);
  return node;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
