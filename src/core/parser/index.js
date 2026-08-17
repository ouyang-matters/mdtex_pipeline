import MarkdownIt from 'markdown-it';
import footnotePlugin from 'markdown-it-footnote';
import texmathPlugin from 'markdown-it-texmath';
import katex from 'katex';

/**
 * Create a configured markdown-it parser instance.
 * Math expressions are extracted into MathNode structures for platform-specific rendering.
 */
export function createParser(options = {}) {
  const md = new MarkdownIt({
    html: false,
    linkify: true,
    typographer: false,
    breaks: false,
    ...options,
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
      ...(options.katexOptions || {}),
    },
  });

  return md;
}

/**
 * Parse markdown source into tokens.
 * Returns { tokens, metadata } where metadata includes extracted info.
 */
export function parseMarkdown(source, options = {}) {
  const md = createParser(options);
  const env = {};
  const tokens = md.parse(source, env);

  const metadata = {
    footnotes: env.footnotes || {},
    labels: env.labels || {},
  };

  return { tokens, metadata, md, env };
}

/**
 * Render markdown source to HTML.
 */
export function renderMarkdown(source, options = {}) {
  const md = createParser(options);
  const env = {};
  return md.render(source, env);
}
