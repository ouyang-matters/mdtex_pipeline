import { createParser } from '../parser/index.js';
import { buildCodeBlockHtml, highlightCode } from '../code/index.js';

/**
 * Create a renderer that produces HTML scoped under #nice.
 * Custom rendering rules for code blocks, images, etc.
 */
export function createRenderer(options = {}) {
  const md = createParser(options);

  // Custom fence renderer for code blocks
  md.renderer.rules.fence = (tokens, idx) => {
    const token = tokens[idx];
    const code = token.content;
    const lang = token.info.trim().split(/\s+/)[0] || '';
    return buildCodeBlockHtml(code, lang);
  };

  // Custom code_block renderer (indented code)
  md.renderer.rules.code_block = (tokens, idx) => {
    const token = tokens[idx];
    return buildCodeBlockHtml(token.content, '');
  };

  return md;
}

/**
 * Render markdown source into a complete scoped HTML document fragment.
 */
export function renderToHtml(source, options = {}) {
  const md = createRenderer(options);
  const env = {};
  const bodyHtml = md.render(source, env);

  return `<div id="nice">\n${bodyHtml}\n</div>`;
}
