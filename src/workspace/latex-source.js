import { existsSync, readFileSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { ensureDir } from '../core/paths.js';
import { buildLatexDocument, articleRootImageStrategy } from '../core/latex/document.js';
import { createCheckpoint } from './checkpoints.js';

/**
 * The LaTeX face of a Markdown article.
 *
 * A Markdown article has one source of truth — `source.md` — and a LaTeX
 * document that follows from it. Both are visible in the editor; only one is
 * writable. That asymmetry is not a limitation of the converter, it is the
 * shape of the problem: Markdown maps into LaTeX, LaTeX does not map back.
 * `\label`, `\newcommand`, custom environments, TikZ and bibliographies have no
 * Markdown spelling, so a document that gained any of them could not be
 * expressed as Markdown again.
 *
 * Rather than let two editable copies drift, MDTeX makes the direction
 * explicit: the LaTeX view is read-only, and `adoptLatexSource` is the one-way
 * door. After adopting, LaTeX *is* the source and the Markdown is preserved in
 * a checkpoint rather than left on disk to rot beside it.
 */

/** Where the derived document is kept on disk, under the article's build output. */
export const DERIVED_DIR = join('dist', 'latex');
export const DERIVED_FILE = 'main.tex';

function derivedPath(article) {
  return article.dir ? join(article.dir, DERIVED_DIR, DERIVED_FILE) : null;
}

/**
 * The LaTeX document for an article.
 *
 * For a LaTeX article this is simply its source, reported as `derived: false`.
 * For a Markdown article it is generated — by the same builder the PDF build
 * uses, with the images left in their canonical article-relative form, because
 * this document is written at the article root rather than in a build
 * directory.
 *
 * Generation has no side effects unless `persist` is set, in which case the
 * result is also written under `dist/` so it is readable outside the UI.
 *
 * @returns {{ derived, tex, sourceFile, warnings, errors, embedded, stats, template }}
 */
export function latexSourceOf(article, { cjk = null, persist = false } = {}) {
  if (article.sourceFormat === 'latex') {
    return {
      derived: false,
      tex: article.readSource(),
      sourceFile: article.sourceFile,
      warnings: [],
      errors: [],
      embedded: [],
      stats: null,
      template: null,
    };
  }

  const images = articleRootImageStrategy({ articleRoot: article.dir, articleId: article.id });

  const document = buildLatexDocument({
    source: article.readSource(),
    title: article.title || null,
    author: article.author || '',
    language: article.language || 'en',
    template: article.pdfTemplate || undefined,
    engine: article.pdfEngine || undefined,
    cjk,
    resolveImage: images.resolveImage,
  });

  if (persist && article.dir) {
    const target = derivedPath(article);
    ensureDir(join(article.dir, DERIVED_DIR));
    // Only rewrite when the text actually changed, so a build directory does
    // not churn its mtime every time the tab is opened.
    const current = existsSync(target) ? readFileSync(target, 'utf-8') : null;
    if (current !== document.tex) writeFileSync(target, document.tex, 'utf-8');
  }

  return {
    derived: true,
    tex: document.tex,
    sourceFile: DERIVED_FILE,
    derivedPath: article.dir ? join(DERIVED_DIR, DERIVED_FILE) : null,
    warnings: [
      ...document.warnings,
      ...images.warnings,
      ...images.embedded.map(e =>
        `Embedded image will be written to ${e.canonical} when LaTeX becomes the source.`),
    ],
    errors: images.errors,
    // The buffers stay here; a caller that only wants to display the document
    // has no use for them.
    embedded: images.embedded.map(({ source, name, canonical }) => ({ source, name, canonical })),
    stats: document.stats,
    template: document.template?.id || null,
  };
}

/**
 * Make the derived LaTeX the article's source. One-way.
 *
 * Everything that could refuse the operation is checked before anything is
 * written: an article that already is LaTeX, a `main.tex` that is not ours to
 * overwrite, and any image that could not be resolved. An image error is fatal
 * rather than a warning, because adopting a document whose figures point at
 * nothing produces an article that no longer builds — and the Markdown it came
 * from is gone from the editor by then.
 *
 * @returns {{ adopted: true, tex, sourceFile, checkpoint, assets, warnings }}
 */
export function adoptLatexSource(article, { cjk = null } = {}) {
  if (article.sourceFormat === 'latex') {
    throw new Error('This article already uses LaTeX as its source.');
  }
  if (!article.dir) {
    throw new Error('The article has no directory on disk yet.');
  }

  const target = join(article.dir, DERIVED_FILE);
  if (existsSync(target)) {
    throw new Error(
      `${DERIVED_FILE} already exists in this article and is not the derived document. `
      + 'Move or delete it first.',
    );
  }

  const images = articleRootImageStrategy({ articleRoot: article.dir, articleId: article.id });
  const document = buildLatexDocument({
    source: article.readSource(),
    title: article.title || null,
    author: article.author || '',
    language: article.language || 'en',
    template: article.pdfTemplate || undefined,
    engine: article.pdfEngine || undefined,
    cjk,
    resolveImage: images.resolveImage,
  });

  if (images.errors.length) {
    const detail = images.errors.map(e => `  • ${e.message}`).join('\n');
    throw new Error(
      `The LaTeX document cannot be adopted while these images are unresolved:\n${detail}`,
    );
  }

  // The Markdown, the metadata and the theme state as they were, before any of
  // this touches the article. This is what makes adoption reversible.
  const checkpoint = createCheckpoint(article, {
    label: 'Before adopting LaTeX as the source',
    origin: 'adopt-latex',
  });

  // Embedded images become real files, because \includegraphics cannot read a
  // data URI. The names came from the content hash, so writing them cannot
  // collide with an unrelated file — but if the store hands back a different
  // name we stop rather than write a document that points at the wrong bytes.
  const assets = [];
  for (const image of images.embedded) {
    const written = article.writeAsset(image.name, image.buffer);
    if (written.name !== image.name) {
      throw new Error(
        `Embedded image was stored as ${written.name} but the document references ${image.name}.`,
      );
    }
    assets.push({ name: written.name, canonical: written.canonical, bytes: written.bytes });
  }

  writeFileSync(target, document.tex, 'utf-8');

  const previousSource = article.sourcePath;
  article.setSourceContainer('latex');

  // The Markdown is in the checkpoint. Leaving a copy at the article root would
  // recreate exactly the ambiguity this whole design exists to prevent: two
  // files, both looking like sources, only one of them read.
  if (previousSource && previousSource !== target && existsSync(previousSource)) {
    rmSync(previousSource, { force: true });
  }

  // The derived copy under dist/ described a Markdown article that no longer
  // exists.
  const derived = derivedPath(article);
  if (derived && existsSync(derived)) rmSync(derived, { force: true });

  return {
    adopted: true,
    tex: document.tex,
    sourceFile: article.sourceFile,
    checkpoint,
    assets,
    warnings: [...document.warnings, ...images.warnings],
  };
}
