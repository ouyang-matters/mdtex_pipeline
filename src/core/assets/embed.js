import { AssetKind, contentTypeFor } from './resolver.js';

/**
 * Asset handling for platform output (WeChat, Zhihu, exported HTML).
 *
 * A pasted article has to be self-contained. `assets/figure-01.png` means
 * nothing once the HTML is inside the WeChat editor, so every local asset is
 * resolved through the shared AssetResolver and inlined as a data URI. That is
 * what mdnice does, and it is why a pasted article shows its figures at all.
 *
 * Anything that cannot be resolved becomes a hard, diagnosable error carrying
 * the source, the article root and the expected path — never a silent broken
 * image.
 */

/** Refuse to inline anything larger than this; the editor would choke. */
export const MAX_INLINE_BYTES = 8 * 1024 * 1024;

/**
 * Rewrite every <img src> in `html` through the resolver.
 *
 * @param {string} html
 * @param {AssetResolver} resolver
 * @param {object} options
 * @param {'inline'|'url'|'keep'} options.mode
 * @param {string} options.token   appended to preview URLs in 'url' mode
 * @returns {{ html, embedded, skipped, errors, warnings }}
 */
export function applyAssetsToHtml(html, resolver, { mode = 'inline', token = null } = {}) {
  const errors = [];
  const warnings = [];
  /** src -> what actually happened to it, so validation is not guesswork. */
  const outcomes = new Map();
  let embedded = 0;
  let skipped = 0;

  const result = html.replace(/<img\b[^>]*>/gi, (tag) => {
    const srcMatch = tag.match(/\ssrc\s*=\s*"([^"]*)"/i) || tag.match(/\ssrc\s*=\s*'([^']*)'/i);
    if (!srcMatch) return tag;

    const src = decodeHtmlEntities(srcMatch[1]);
    const record = resolver.resolve(src);

    // Formula SVGs and anything already self-contained are left alone.
    if (record.kind === AssetKind.DATA) { skipped++; outcomes.set(src, 'data'); return tag; }

    if (record.kind === AssetKind.REMOTE) {
      skipped++;
      outcomes.set(src, 'remote');
      return tag;
    }

    if (!record.exists) {
      errors.push({
        message: `Image not found: ${src}`,
        diagnostic: resolver.describeFailure(src),
        source: src,
        articleRoot: resolver.articleRoot,
        expected: record.expected,
      });
      // Leave the tag in place so the image count stays honest; the build
      // reports the error rather than pretending it rendered.
      outcomes.set(src, 'missing');
      return tag;
    }

    if (record.kind === AssetKind.ABSOLUTE) {
      warnings.push(
        `Image "${truncate(src, 60)}" uses an absolute path. Move it into the article's `
        + 'assets directory so the article stays portable.',
      );
    }

    if (mode === 'keep') { skipped++; outcomes.set(src, 'kept'); return tag; }

    if (mode === 'url') {
      const url = resolver.previewUrl(src, { token });
      if (!url) { skipped++; outcomes.set(src, 'kept'); return tag; }
      embedded++;
      outcomes.set(src, 'url');
      return replaceSrc(tag, url);
    }

    // mode === 'inline'
    if (record.bytes > MAX_INLINE_BYTES) {
      warnings.push(
        `Image "${truncate(src, 60)}" is ${(record.bytes / 1024 / 1024).toFixed(1)} MB and was not `
        + 'inlined. Upload it to the platform CDN and reference it by URL.',
      );
      skipped++;
      outcomes.set(src, 'too-large');
      return tag;
    }

    const bytes = resolver.read(src);
    if (!bytes) {
      errors.push({
        message: `Image could not be read: ${src}`,
        diagnostic: resolver.describeFailure(src, { label: 'Image could not be read' }),
        source: src,
        articleRoot: resolver.articleRoot,
        expected: record.expected,
      });
      outcomes.set(src, 'unreadable');
      return tag;
    }

    embedded++;
    outcomes.set(src, 'embedded');
    const dataUri = `data:${contentTypeFor(record.canonical)};base64,${bytes.toString('base64')}`;
    return replaceSrc(tag, dataUri);
  });

  return { html: result, embedded, skipped, errors, warnings, outcomes };
}

function replaceSrc(tag, value) {
  const escaped = value.replace(/"/g, '&quot;');
  if (/\ssrc\s*=\s*"/i.test(tag)) return tag.replace(/(\ssrc\s*=\s*)"[^"]*"/i, `$1"${escaped}"`);
  return tag.replace(/(\ssrc\s*=\s*)'[^']*'/i, `$1"${escaped}"`);
}

function decodeHtmlEntities(value) {
  return String(value)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function truncate(value, max) {
  const text = String(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
