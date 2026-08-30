import { extname } from 'path';
import { markdownToLatexBody, escapeLatexText } from './markdown-to-latex.js';
import { loadPdfTemplate, renderPdfTemplate, buildFontSetup, DEFAULT_TEMPLATE } from './templates.js';
import { DEFAULT_ENGINE } from './environment.js';
import { AssetResolver, AssetKind, LATEX_IMAGE_EXTENSIONS, ASSET_DIR, hashBytes } from '../assets/resolver.js';

/**
 * One implementation of "what LaTeX does this Markdown article become".
 *
 * There is exactly one such function because there are two callers that must
 * never disagree: the PDF build, which materialises a throwaway project in a
 * build directory, and the LaTeX view in the editor, which shows the user the
 * document they would get if they adopted LaTeX as the article's source. If
 * those two produced different text, the view would be a lie — you would adopt
 * what you read and compile something else.
 *
 * The callers differ in exactly one respect: how an image reference becomes a
 * path LaTeX can use. That is the `resolveImage` parameter, and nothing else.
 */

/**
 * Build a complete LaTeX document from Markdown.
 *
 * @param {object} options
 * @param {string} options.source        Markdown source
 * @param {object|null} options.cjk      a plan from core/latex/cjk.js, when the
 *        document needs a CJK script
 * @param {(src: string) => string|null} options.resolveImage
 *        maps an image reference to a path usable from the document's
 *        directory; returning null drops the image
 * @returns {{ tex, body, title, template, warnings, stats }}
 */
export function buildLatexDocument({
  source,
  title = null,
  author = '',
  date = '',
  language = 'en',
  template: templateId = DEFAULT_TEMPLATE,
  engine = DEFAULT_ENGINE,
  cjk = null,
  resolveImage = (src) => src,
}) {
  const { body, title: derivedTitle, warnings: convWarnings, stats } =
    markdownToLatexBody(source, { resolveImage });

  const effectiveTitle = title || derivedTitle || null;
  const template = loadPdfTemplate(templateId);
  const font = buildFontSetup({ engine, language, cjk });

  const tex = renderPdfTemplate(template, {
    fontSetup: font.setup,
    title: effectiveTitle ? escapeLatexText(effectiveTitle) : '',
    author: author ? escapeLatexText(author) : '',
    date: date ? escapeLatexText(date) : '',
    titleBlock: effectiveTitle ? '\\maketitle\n' : '',
    body,
  });

  return {
    tex,
    body,
    title: effectiveTitle,
    template,
    warnings: [...convWarnings, ...font.warnings],
    stats,
  };
}

/**
 * An image strategy for a document that will live at the article root.
 *
 * Article-relative references are kept exactly as they are — that is the whole
 * point of the canonical form, and latexmk running in the article directory
 * resolves `assets/figure-01.png` the same way the preview and the WeChat
 * renderer do. Nothing is written to disk here: the resolver only reports what
 * *would* have to be written, so generating the view has no side effects and
 * adopting it can act on the same list.
 *
 * @returns {{ resolveImage, warnings, errors, embedded }}
 *   `embedded` lists data-URI images with the asset name they were given, so
 *   the caller can materialise them if it is about to commit the document.
 */
export function articleRootImageStrategy({ articleRoot = null, articleId = null } = {}) {
  const resolver = new AssetResolver({ articleRoot, articleId });
  const warnings = [];
  const errors = [];
  const embedded = [];
  const seen = new Map();

  const fail = (src, message) => {
    errors.push({ source: src, message });
    seen.set(src, null);
    return null;
  };

  const resolveImage = (src) => {
    if (seen.has(src)) return seen.get(src);

    const record = resolver.resolve(src);

    if (record.kind === AssetKind.DATA) {
      const match = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(src);
      if (!match) return fail(src, 'Embedded image could not be parsed: malformed data URI.');

      const ext = mimeToExtension(match[1]);
      if (!ext) {
        return fail(src, `Embedded image has a type LaTeX cannot use: ${match[1]}. `
          + `LaTeX supports ${LATEX_IMAGE_EXTENSIONS.join(', ')}.`);
      }

      let buffer;
      try {
        buffer = match[2]
          ? Buffer.from(match[3], 'base64')
          : Buffer.from(decodeURIComponent(match[3]), 'utf-8');
      } catch (e) {
        return fail(src, `Embedded image could not be decoded: ${e.message}`);
      }
      if (!buffer.length) return fail(src, 'Embedded image is empty.');

      // Named by content, not by position. A generated document must be a pure
      // function of the source: if the name depended on how many images came
      // before it, adding one at the top would rewrite every reference below,
      // and the file already sitting in assets/ would no longer be the one the
      // document points at.
      const name = `embedded-${hashBytes(buffer)}${ext}`;
      const canonical = `${ASSET_DIR}/${name}`;
      embedded.push({ source: src, name, canonical, buffer });
      seen.set(src, canonical);
      return canonical;
    }

    if (record.kind === AssetKind.REMOTE) {
      warnings.push(`Remote image is dropped — LaTeX cannot fetch it: ${truncate(src, 70)}`);
      seen.set(src, null);
      return null;
    }

    if (record.kind === AssetKind.ESCAPING) {
      return fail(src, record.error || 'The path points outside the article directory.');
    }

    if (!record.exists) {
      return fail(src, `Image not found: ${src}`);
    }

    const ext = extname(record.absolutePath).toLowerCase();
    if (!LATEX_IMAGE_EXTENSIONS.includes(ext)) {
      return fail(src, `LaTeX cannot use "${ext}" images: ${src}. `
        + `Convert it to one of ${LATEX_IMAGE_EXTENSIONS.join(', ')} first.`);
    }

    if (record.kind === AssetKind.ABSOLUTE) {
      warnings.push(
        `Image "${truncate(src, 60)}" uses an absolute path, so the article stops being `
        + 'portable. Move it into the article\'s assets directory.',
      );
    }

    seen.set(src, record.canonical);
    return record.canonical;
  };

  return { resolveImage, warnings, errors, embedded };
}

export function mimeToExtension(mime) {
  const map = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'application/pdf': '.pdf',
  };
  return map[String(mime).toLowerCase()] || null;
}

function truncate(value, max) {
  const text = String(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
