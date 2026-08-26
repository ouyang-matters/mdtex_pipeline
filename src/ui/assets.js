import { api, backend } from './api.js';
import { app } from './state.js';

/**
 * Article assets in the browser.
 *
 * The canonical source always says `assets/figure-01.png`. A browser cannot
 * load that — it would resolve against the page origin and 404, which is
 * exactly why imported images were invisible in the preview.
 *
 * So the preview *renders* through a backend URL:
 *
 *     source      assets/figure-01.png
 *     rendered    /api/assets/<article-id>/assets/figure-01.png?v=<hash>
 *
 * The rewrite happens on the rendered HTML, never on the source text, so the
 * preview URL cannot leak back into the article. The `?v=` is the asset's
 * content hash: replace an image and the URL changes, so the browser can never
 * show a stale cached version.
 */

/** name/canonical -> content hash, for the open article. */
let manifest = new Map();
let manifestArticleId = null;

/** Load the asset manifest for an article. Cheap, and safe to call often. */
export async function refreshAssetManifest(articleId) {
  manifest = new Map();
  manifestArticleId = articleId || null;
  if (!articleId) return manifest;

  try {
    const data = await backend.assets.manifest(articleId);
    for (const asset of data.assets || []) {
      manifest.set(asset.canonical, asset.hash);
      manifest.set(asset.name, asset.hash);
    }
    app.assetRoot = data.articleRoot || null;
  } catch {
    // An article with no assets directory yet is not an error.
  }
  return manifest;
}

/** Record a hash locally so a just-imported image renders without a round trip. */
export function noteAsset(canonical, hash) {
  if (!canonical) return;
  manifest.set(canonical, hash || String(Date.now()));
  const name = canonical.split('/').pop();
  if (name) manifest.set(name, hash || String(Date.now()));
}

/** Whether a reference is an article-relative asset path. */
export function isArticleRelative(src) {
  const value = String(src || '').trim();
  if (!value) return false;
  if (/^data:/i.test(value)) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return false;
  if (value.startsWith('//')) return false;
  if (value.startsWith('/')) return false;
  if (/^[a-zA-Z]:[\\/]/.test(value)) return false;
  return true;
}

/**
 * The URL the preview should load a canonical asset path from.
 * Returns null when there is no open article to resolve against.
 */
export function assetUrl(src, articleId = app.currentArticleId) {
  if (!articleId || !isArticleRelative(src)) return null;

  // Normalise to POSIX and drop any leading ./ — the canonical form.
  const canonical = String(src).replace(/\\/g, '/').replace(/^\.\//, '');

  let decoded = canonical;
  try { decoded = decodeURIComponent(canonical); } catch { /* keep as written */ }

  const version = manifest.get(decoded) || manifest.get(canonical);
  const path = decoded.split('/').map(encodeURIComponent).join('/');

  const params = [];
  if (version) params.push(`v=${encodeURIComponent(version)}`);
  if (api.token) params.push(`token=${encodeURIComponent(api.token)}`);

  return `${api.base}/assets/${encodeURIComponent(articleId)}/${path}`
    + (params.length ? `?${params.join('&')}` : '');
}

/**
 * Rewrite every article-relative <img> in a rendered HTML string.
 *
 * This runs *before* the HTML reaches the document, and that ordering matters.
 * If `assets/figure-01.png` is ever assigned to a live element, the browser
 * immediately requests it against the page origin. That request is doomed, and
 * its `error` event can arrive after a later DOM rewrite has already pointed
 * the element at the backend — marking a perfectly good image as missing. The
 * only way to win that race is to never start it.
 *
 * The rewrite happens on the rendered HTML, never on the Markdown, so the
 * preview URL cannot leak back into the article source.
 */
export function rewriteAssetHtml(html, articleId = app.currentArticleId) {
  if (!html || !/<img/i.test(html)) return html;

  // A <template>'s content is inert: nothing inside it loads.
  const template = document.createElement('template');
  template.innerHTML = html;
  rewriteImages(template.content, articleId);
  return template.innerHTML;
}

/** Point article-relative images at the backend. Shared by both entry points. */
function rewriteImages(root, articleId) {
  let rewritten = 0;
  let unresolved = 0;

  for (const img of root.querySelectorAll('img')) {
    const original = img.getAttribute('data-mdtex-src') ?? img.getAttribute('src') ?? '';
    if (!isArticleRelative(original)) continue;

    // Remember the canonical reference for diagnostics.
    img.setAttribute('data-mdtex-src', original);

    const url = assetUrl(original, articleId);
    if (!url) {
      unresolved++;
      img.removeAttribute('src');
      img.setAttribute('data-mdtex-unresolved', 'This article has not been saved to disk yet.');
      continue;
    }

    if (img.getAttribute('src') !== url) img.setAttribute('src', url);
    rewritten++;
  }

  return { rewritten, unresolved };
}

/**
 * Attach failure handling to a rendered preview that is now in the document.
 *
 * Images were already pointed at the backend by `rewriteAssetHtml`; this adds
 * the diagnostics that need a live element, and rewrites anything that reached
 * the DOM by another route.
 */
export function resolvePreviewAssets(root, articleId = app.currentArticleId) {
  if (!root) return { rewritten: 0, unresolved: 0 };

  const counts = rewriteImages(root, articleId);

  for (const img of root.querySelectorAll('img')) {
    const original = img.getAttribute('data-mdtex-src');
    if (!original) continue;

    const unresolvable = img.getAttribute('data-mdtex-unresolved');
    if (unresolvable) {
      markMissing(img, original, unresolvable);
      continue;
    }

    // An image that already failed while the HTML was being parsed never fires
    // `error` again, so check the settled state as well as listening.
    if (img.complete && img.naturalWidth === 0) {
      markMissing(img, original, null);
      continue;
    }

    img.addEventListener('error', () => {
      // Ignore a stale event from a src this element no longer has.
      if (img.naturalWidth > 0) return;
      markMissing(img, original, null);
    }, { once: true });
  }

  return counts;
}

/**
 * Replace a broken image with something that says what went wrong.
 *
 * A browser's broken-image icon carries no information. The placeholder names
 * the reference and, once the backend has answered, the article root and the
 * path that was expected.
 */
function markMissing(img, source, reason) {
  if (img.dataset.mdtexMissing === '1') return;
  img.dataset.mdtexMissing = '1';

  const placeholder = document.createElement('span');
  placeholder.className = 'asset-missing';
  placeholder.setAttribute('role', 'img');
  placeholder.setAttribute('aria-label', `Image not found: ${source}`);

  const title = document.createElement('strong');
  title.textContent = 'Image not found';

  const path = document.createElement('code');
  path.textContent = source;

  const detail = document.createElement('span');
  detail.className = 'asset-missing-detail';
  detail.textContent = reason || 'Resolving…';

  placeholder.append(title, path, detail);
  img.replaceWith(placeholder);

  if (reason) return;

  // Ask the backend where it looked, so the message is actionable.
  backend.assets
    .resolve(app.currentArticleId, [source])
    .then((data) => {
      const record = data.resolved?.[0];
      if (!record) return;

      // The file being present changes the diagnosis entirely: this is a
      // corrupt or non-image file, not a path problem, and saying "not found"
      // would send the reader looking for a file that is already there.
      if (record.exists && !record.error) {
        title.textContent = 'Image could not be displayed';
        placeholder.setAttribute('aria-label', `Image could not be displayed: ${source}`);
      }

      detail.textContent = '';
      appendLine(detail, 'Article root', data.articleRoot);
      appendLine(detail, record.exists ? 'Found at' : 'Expected', record.expected);
      appendLine(
        detail,
        'Reason',
        record.error
          || (record.exists ? 'The file is on disk but is not a readable image.' : null),
      );
    })
    .catch(() => { detail.textContent = 'The backend could not be reached.'; });
}

function appendLine(parent, label, value) {
  if (!value) return;
  const line = document.createElement('span');
  line.className = 'asset-missing-line';
  const key = document.createElement('em');
  key.textContent = `${label}: `;
  const val = document.createElement('code');
  val.textContent = value;
  line.append(key, val);
  parent.append(line);
}

/**
 * Import an image into the open article.
 *
 * The single implementation behind the toolbar button, drag-and-drop and
 * clipboard paste — three code paths with three path behaviours is how the
 * source ends up with a mix of data URIs, absolute paths and relative paths.
 *
 * Transactional: the backend copies the file and verifies it landed before
 * returning, and only then is a reference inserted. A reference is never
 * written for an asset that failed to copy.
 *
 * @returns {{ reference, canonical, name, hash } | null}
 */
export async function importImage(file, { articleId = app.currentArticleId, replace = false } = {}) {
  if (!articleId) {
    const error = new Error('Open an article before inserting images.');
    error.code = 'NO_ARTICLE';
    throw error;
  }
  if (!file || file.size === 0) {
    throw new Error('That file is empty.');
  }

  const dataBase64 = await fileToBase64(file);
  const result = await backend.workspace.uploadAsset(
    articleId,
    file.name || 'image.png',
    dataBase64,
    { replace },
  );

  // The asset exists on disk; record its hash so the preview shows it at once.
  noteAsset(result.canonical || result.asset.canonical, result.asset.hash);

  return {
    reference: result.reference,
    canonical: result.canonical || result.asset.canonical,
    name: result.asset.name,
    hash: result.asset.hash,
    reused: result.asset.reused,
  };
}

export function fileToBase64(file) {
  return new Promise((resolvePromise, rejectPromise) => {
    const reader = new FileReader();
    reader.onload = () => resolvePromise(String(reader.result).split(',')[1] || '');
    reader.onerror = () => rejectPromise(reader.error || new Error('The file could not be read.'));
    reader.readAsDataURL(file);
  });
}
