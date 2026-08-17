/**
 * Browser-side KaTeX-to-image converter for publishing clipboard.
 *
 * Converts KaTeX-rendered math elements in the live DOM to self-contained
 * SVG data URI images, removing dependency on KaTeX CSS.
 *
 * Strategy: render KaTeX HTML + CSS in a hidden container, measure it,
 * draw to a foreignObject SVG, serialize to data URI.
 */

import katexCssUrl from 'katex/dist/katex.min.css?url';

let _katexCss = null;

async function getKatexCss() {
  if (_katexCss) return _katexCss;
  try {
    const resp = await fetch(katexCssUrl);
    _katexCss = await resp.text();
  } catch {
    // Fallback: extract from existing page stylesheets
    for (const sheet of document.styleSheets) {
      try {
        const rules = Array.from(sheet.cssRules || []);
        if (rules.some(r => r.cssText?.includes('.katex'))) {
          _katexCss = rules.map(r => r.cssText).join('\n');
          break;
        }
      } catch { /* cross-origin */ }
    }
  }
  return _katexCss || '';
}

/**
 * Replace all KaTeX math elements in an HTML string with SVG data URI images.
 * Works in the browser by rendering KaTeX HTML in a hidden container.
 *
 * @param {string} html - HTML containing KaTeX-rendered math (<eq>, <eqn> elements)
 * @param {string} themeCss - Resolved theme CSS
 * @returns {Promise<string>} HTML with math replaced by <img> tags
 */
export async function replaceKatexWithImagesInBrowser(html, themeCss) {
  const katexCss = await getKatexCss();

  // Create a hidden container for rendering
  const container = document.createElement('div');
  container.style.cssText = 'position:absolute;left:-9999px;top:-9999px;visibility:hidden;';
  container.innerHTML = `<style>${katexCss}\n${themeCss}</style>\n${html}`;
  document.body.appendChild(container);

  try {
    // Process display math
    const displayMaths = container.querySelectorAll('eqn');
    for (const eqn of displayMaths) {
      const annotation = eqn.querySelector('annotation[encoding="application/x-tex"]');
      const latex = annotation?.textContent?.trim() || '';
      const katexEl = eqn.querySelector('.katex-display') || eqn.querySelector('.katex');
      if (!katexEl) continue;

      const imgTag = await katexElementToImg(katexEl, latex, true, katexCss);
      if (imgTag) {
        const section = eqn.closest('section') || eqn.parentElement;
        const wrapper = document.createElement('section');
        wrapper.style.cssText = 'text-align:center;margin:1em 0;overflow-x:auto;overflow-y:hidden;';
        wrapper.innerHTML = imgTag;
        section.replaceWith(wrapper);
      }
    }

    // Process inline math
    const inlineMaths = container.querySelectorAll('eq');
    for (const eq of inlineMaths) {
      const annotation = eq.querySelector('annotation[encoding="application/x-tex"]');
      const latex = annotation?.textContent?.trim() || '';
      const katexEl = eq.querySelector('.katex');
      if (!katexEl) continue;

      const imgTag = await katexElementToImg(katexEl, latex, false, katexCss);
      if (imgTag) {
        const img = document.createElement('span');
        img.innerHTML = imgTag;
        eq.replaceWith(img.firstChild);
      }
    }

    // Remove the injected style tag
    const styleTag = container.querySelector('style');
    if (styleTag) styleTag.remove();

    return container.innerHTML;
  } finally {
    document.body.removeChild(container);
  }
}

/**
 * Convert a KaTeX DOM element to an <img> tag with SVG data URI.
 */
async function katexElementToImg(katexEl, latex, displayMode, katexCss) {
  try {
    // Measure the element
    const rect = katexEl.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;

    const scale = 2; // 2x for retina
    const width = Math.ceil(rect.width * scale);
    const height = Math.ceil(rect.height * scale);

    // Get the computed styles of the katex element
    const computedStyle = window.getComputedStyle(katexEl);
    const fontSize = computedStyle.fontSize;
    const color = computedStyle.color;

    // Clone and inline critical styles
    const clone = katexEl.cloneNode(true);

    // Build SVG with foreignObject
    const svgHtml = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${rect.width} ${rect.height}">
      <foreignObject width="${rect.width}" height="${rect.height}">
        <div xmlns="http://www.w3.org/1999/xhtml" style="font-size:${fontSize};color:${color};margin:0;padding:0;">
          <style>${katexCss}</style>
          ${clone.outerHTML}
        </div>
      </foreignObject>
    </svg>`;

    const dataUri = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgHtml)));

    const escapedLatex = escapeAttr(latex);

    if (displayMode) {
      return `<img src="${dataUri}" alt="${escapedLatex}" data-latex="${escapedLatex}" data-display="true" style="max-width:100%;height:auto;vertical-align:middle;" />`;
    } else {
      return `<img src="${dataUri}" alt="${escapedLatex}" data-latex="${escapedLatex}" data-display="false" style="height:${rect.height}px;vertical-align:middle;margin:0 0.15em;display:inline;" />`;
    }
  } catch {
    return null;
  }
}

function escapeAttr(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
