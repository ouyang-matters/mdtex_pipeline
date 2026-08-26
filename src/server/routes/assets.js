import { readFileSync } from 'fs';
import { sendJson, sendBuffer, notFound, badRequest } from '../http.js';
import { ArticleLibrary } from '../../workspace/library.js';
import { AssetResolver, contentTypeFor } from '../../core/assets/resolver.js';

/**
 * Article asset serving.
 *
 * A browser cannot load `assets/figure-01.png` from an article directory on
 * disk, and it must not be asked to: a `file://` URL would either be blocked
 * or would leak the whole filesystem into the page. Instead the preview asks
 * for the same canonical path through the backend, which resolves it against
 * the one article root everything else uses.
 *
 *     canonical source   assets/figure-01.png          <- what is in the file
 *     preview URL        /api/assets/<id>/assets/figure-01.png?v=<hash>
 *
 * The preview URL is a rendering detail. It is never written back into the
 * article source.
 */
export function assetRoutes(ctx) {
  const library = () => new ArticleLibrary(ctx.workspaceRoot);

  const resolverFor = (id) => {
    const entry = library().getEntryById(id);
    if (!entry) throw notFound(`No article with id ${id}`);
    return { article: entry.article, resolver: entry.article.assetResolver() };
  };

  return {
    /**
     * Serve one asset. The path segment after the article id is the canonical
     * article-relative path, so nested asset directories work unchanged.
     */
    'GET /api/assets/:id/*': async (req, res, { params, query }) => {
      const { resolver } = resolverFor(params.id);
      const canonical = params['*'];
      if (!canonical) throw badRequest('An asset path is required.');

      const record = resolver.resolve(canonical);

      if (!record.exists) {
        // Diagnosable: the preview shows the reason, not a broken image icon.
        sendJson(res, 404, {
          error: 'Asset not found',
          diagnostic: resolver.describeFailure(canonical),
          source: record.src,
          articleRoot: resolver.articleRoot,
          expected: record.expected,
          reason: record.error,
        });
        return;
      }

      const hash = resolver.hashOf(canonical);
      const etag = hash ? `"${hash}"` : null;

      // A content hash is a perfect validator: identical content, identical
      // ETag, so a replaced image is never served from a stale cache.
      if (etag && req.headers['if-none-match'] === etag) {
        res.writeHead(304, { ETag: etag, 'Cache-Control': 'no-cache' });
        res.end();
        return;
      }

      const headers = { 'Cache-Control': 'no-cache' };
      if (etag) headers.ETag = etag;
      // A versioned request is immutable by construction: the version *is* the
      // content hash, so it can be cached hard.
      if (query.get('v') && query.get('v') === hash) {
        headers['Cache-Control'] = 'private, max-age=31536000, immutable';
      }

      sendBuffer(res, 200, readFileSync(record.absolutePath), contentTypeFor(canonical), headers);
    },

    /** The article's asset manifest, with hashes for cache busting. */
    'GET /api/assets/:id': async (req, res, { params }) => {
      const { article, resolver } = resolverFor(params.id);
      sendJson(res, 200, {
        articleId: article.id,
        articleRoot: resolver.articleRoot,
        assets: resolver.list().map(a => ({
          name: a.name,
          canonical: a.canonical,
          bytes: a.bytes,
          hash: a.hash,
        })),
      });
    },

    /**
     * Resolve references without fetching them.
     *
     * The preview uses this to turn canonical paths into loadable URLs, and to
     * report a precise diagnostic for anything that cannot be resolved.
     */
    'POST /api/assets/:id/resolve': async (req, res, { params }) => {
      const { readJson } = await import('../http.js');
      const body = await readJson(req);
      const sources = Array.isArray(body.sources) ? body.sources : [];

      const { resolver } = resolverFor(params.id);

      sendJson(res, 200, {
        articleRoot: resolver.articleRoot,
        resolved: sources.map((src) => {
          const record = resolver.resolve(src);
          return {
            src,
            kind: record.kind,
            canonical: record.canonical,
            exists: record.exists,
            hash: record.exists ? resolver.hashOf(src) : null,
            url: record.exists ? resolver.previewUrl(src) : null,
            expected: record.expected,
            error: record.error,
            diagnostic: record.exists ? null : resolver.describeFailure(src),
          };
        }),
      });
    },
  };
}
