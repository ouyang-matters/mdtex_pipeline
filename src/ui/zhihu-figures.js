/**
 * Figures for Zhihu, which takes them only one way.
 *
 * Verified 2026-09-28 in a live Zhihu draft: an <img src="data:…"> pasted as
 * part of rich text is fetched by URL and fails ("图片导入失败"), while an image
 * pasted as a file is uploaded by Zhihu itself and becomes a native figure.
 * So the copied article carries a visible placeholder where each embedded
 * figure was, and each figure is copied on its own, as an image, to be pasted
 * over its placeholder.
 *
 * Images with an http(s) source are left in place: Zhihu imports those by URL.
 * Formula nodes (`eeimg`) are Zhihu's own and are never touched.
 */

/**
 * @param {string} html  the prepared Zhihu target
 * @param {(n: number) => string} label  placeholder text for figure n (1-based)
 * @returns {{ html: string, figures: Array<{ n: number, src: string, alt: string, placeholder: string }> }}
 */
export function splitFigures(html, label = (n) => `〔图 ${n}〕`) {
  const figures = [];
  const out = String(html ?? '').replace(/<img\b[^>]*>/gi, (tag) => {
    if (/\beeimg=/i.test(tag)) return tag;
    const src = attr(tag, 'src');
    if (!src || !/^data:image\//i.test(src)) return tag;
    const n = figures.length + 1;
    const placeholder = label(n);
    figures.push({ n, src, alt: decode(attr(tag, 'alt') || ''), placeholder });
    return `<strong>${escapeHtml(placeholder)}</strong>`;
  });
  return { html: out, figures };
}

/**
 * The figure as a PNG blob — the one image type every browser will put on the
 * clipboard. A figure already in PNG is passed through; anything else is
 * redrawn once on a canvas.
 */
export async function figureToPng(src, { doc = globalThis.document } = {}) {
  const blob = dataUriToBlob(src);
  if (blob.type === 'image/png') return blob;
  const bitmap = await createImageBitmap(blob);
  const canvas = doc.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff'; // JPEGs have no alpha; a transparent PNG would show the page behind it
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0);
  return new Promise((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('could not encode PNG'))), 'image/png'));
}

export function dataUriToBlob(src) {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(src);
  if (!m) throw new Error('not a data URI');
  const bytes = m[2]
    ? Uint8Array.from(atob(m[3]), c => c.charCodeAt(0))
    : new TextEncoder().encode(decodeURIComponent(m[3]));
  return new Blob([bytes], { type: m[1] });
}

function attr(tag, name) {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag);
  return m ? (m[2] ?? m[3]) : null;
}

function decode(s) {
  return s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
