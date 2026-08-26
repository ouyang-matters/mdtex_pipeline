import { renderLatexToSvg, renderLatexToDataUri } from './publish-renderer.js';
import { svgToPngDataUri } from './svg-to-png.js';
import { FormulaCache } from './formula-cache.js';
import {
  EX_TO_EM, geometryAttrs, inlineSvgStyle, inlineWrapperStyle, inlineImageStyle, displaySvgStyle,
} from './sizing.js';

/**
 * Math output modes for publishing.
 */
export const MathOutput = {
  SVG: 'svg',    // Inline SVG (primary, best WeChat compat)
  PNG: 'png',    // PNG <img> fallback
  AUTO: 'auto',  // SVG preferred
};

const DISPLAY_PATTERN = /<section>\s*<eqn>([\s\S]*?)<\/eqn>\s*<\/section>/g;
const INLINE_PATTERN = /<eq>([\s\S]*?)<\/eq>/g;

/**
 * Post-process rendered HTML to replace KaTeX math elements with
 * self-contained publishing representations.
 *
 * For SVG mode: embeds the MathJax SVG directly inline in the HTML
 * (not as <img src="data:...">). This is the mdnice-style approach
 * that survives WeChat paste because the SVG contains only <path>
 * elements with no external CSS/font dependencies.
 *
 * For PNG mode: falls back to <img src="data:image/png;base64,...">
 * for maximum compatibility.
 *
 * Reports progress as `{ done, total }` so callers can show
 * "Rendering formulas 18/42", and honours an AbortSignal between formulas.
 */
export async function replaceKatexWithImages(html, options = {}) {
  const {
    mathOutput = MathOutput.SVG,
    cache = new FormulaCache(),
    onProgress = null,
    signal = null,
    yieldEvery = 12,
  } = options;

  const errors = [];
  const stats = { inlineRendered: 0, displayRendered: 0, cached: 0, errors: 0, total: 0 };

  // Collect every match up front so progress has a real denominator and each
  // replacement can be applied by index without rescanning the document.
  const matches = [
    ...collectMatches(html, DISPLAY_PATTERN, true),
    ...collectMatches(html, INLINE_PATTERN, false),
  ].sort((a, b) => a.index - b.index);

  stats.total = matches.length;
  onProgress?.({ done: 0, total: matches.length });

  const replacements = new Array(matches.length).fill(null);
  let done = 0;

  for (let i = 0; i < matches.length; i++) {
    if (signal?.aborted) throw abortError();

    const m = matches[i];
    const latex = extractLatex(m.content);
    if (!latex) {
      errors.push(`Could not extract LaTeX from math element at position ${m.index}`);
      stats.errors++;
      done++;
      continue;
    }

    const outcome = await renderOne(latex, m.displayMode, mathOutput, cache);
    if (outcome.error) {
      errors.push(outcome.error);
      stats.errors++;
    } else {
      replacements[i] = buildFormulaHtml(outcome.asset, latex, m.displayMode, mathOutput);
      if (m.displayMode) stats.displayRendered++; else stats.inlineRendered++;
      if (outcome.fromCache) stats.cached++;
    }

    done++;
    onProgress?.({ done, total: matches.length });

    // Yield to the event loop periodically so a long article does not block
    // health checks, cancellation or a second concurrent build.
    if (yieldEvery > 0 && done % yieldEvery === 0) {
      await new Promise(r => setImmediate(r));
    }
  }

  // Apply replacements back-to-front so earlier indices stay valid.
  let result = html;
  for (let i = matches.length - 1; i >= 0; i--) {
    const replacement = replacements[i];
    if (replacement === null) continue;
    const m = matches[i];
    result = result.slice(0, m.index) + replacement + result.slice(m.index + m.fullMatch.length);
  }

  return { html: result, stats, errors };
}

function collectMatches(html, pattern, displayMode) {
  const found = [];
  pattern.lastIndex = 0;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    found.push({
      fullMatch: match[0],
      content: match[1],
      index: match.index,
      displayMode,
    });
  }
  return found;
}

async function renderOne(latex, displayMode, mathOutput, cache) {
  const cached = cache.get(latex, displayMode);
  if (cached && !cached.error && cached.svg) {
    if (mathOutput === MathOutput.PNG && !cached.pngDataUri) {
      try {
        const dataUriResult = renderLatexToDataUri(latex, displayMode);
        const pngResult = await svgToPngDataUri(dataUriResult.pxSvg || cached.svg, { scale: 3 });
        cached.pngDataUri = pngResult.pngDataUri;
        cache.set(latex, displayMode, { ...cached, pngBuffer: pngResult.pngBuffer });
      } catch { /* fall back to SVG */ }
    }
    return { asset: cached, fromCache: true, error: null };
  }

  const svgResult = renderLatexToSvg(latex, displayMode);
  if (svgResult.error || !svgResult.svg) {
    return { asset: null, fromCache: false, error: `Failed to render formula: ${latex.slice(0, 50)}… — ${svgResult.error}` };
  }

  const asset = {
    svg: svgResult.svg,
    widthEx: svgResult.widthEx,
    heightEx: svgResult.heightEx,
    verticalAlignEx: svgResult.verticalAlignEx,
    viewBox: svgResult.viewBox,
    dataUri: null,
    pngDataUri: null,
    pngBuffer: null,
    error: null,
  };

  if (mathOutput === MathOutput.PNG || mathOutput === MathOutput.AUTO) {
    try {
      const dataUriResult = renderLatexToDataUri(latex, displayMode);
      asset.dataUri = dataUriResult.dataUri;
      if (mathOutput === MathOutput.PNG) {
        const pngResult = await svgToPngDataUri(dataUriResult.pxSvg, { scale: 3 });
        asset.pngDataUri = pngResult.pngDataUri;
        asset.pngBuffer = pngResult.pngBuffer;
      }
    } catch (e) {
      if (mathOutput === MathOutput.PNG) {
        return { asset: null, fromCache: false, error: `PNG conversion failed: ${latex.slice(0, 50)}… — ${e.message}` };
      }
    }
  }

  cache.set(latex, displayMode, asset);
  return { asset, fromCache: false, error: null };
}

function abortError() {
  const e = new Error('Compilation cancelled.');
  e.name = 'AbortError';
  return e;
}

/**
 * Extract LaTeX source from KaTeX-rendered HTML.
 */
function extractLatex(katexHtml) {
  const match = katexHtml.match(/<annotation encoding="application\/x-tex">([\s\S]*?)<\/annotation>/);
  if (match) return decodeHtmlEntities(match[1].trim());

  const dataMatch = katexHtml.match(/data-latex="([^"]*)"/);
  if (dataMatch) return decodeHtmlEntities(dataMatch[1]);

  return null;
}

/**
 * Build the publishing HTML for a formula.
 *
 * SVG mode: Embeds the SVG directly inline, wrapped in a <section> container.
 * This is the approach used by mdnice and doocs/md for WeChat compatibility.
 * The SVG itself contains only <path> elements — no CSS classes, no <defs>,
 * no external dependencies.
 *
 * The container uses inline styles that survive WeChat paste:
 * - Display: centered section that scrolls horizontally if the equation is
 *   genuinely wider than the column. The SVG keeps its full viewBox, so the
 *   expression is never cropped.
 * - Inline: span wrapper with vertical-align for baseline alignment, and
 *   explicitly no overflow container, so text flow and baselines are preserved.
 *
 * PNG mode: Falls back to <img> tags with PNG data URIs.
 */
function buildFormulaHtml(asset, latex, displayMode, mathOutput = MathOutput.SVG) {
  const escapedLatex = escapeAttr(latex);

  if (mathOutput === MathOutput.PNG && asset.pngDataUri) {
    return buildPngFallback(asset, escapedLatex, displayMode);
  }

  // SVG inline mode (primary)
  if (!asset.svg) return `<span data-latex="${escapedLatex}">[formula]</span>`;

  let svg = asset.svg;

  const widthEm = `${(asset.widthEx * EX_TO_EM).toFixed(3)}em`;
  const heightEm = `${(asset.heightEx * EX_TO_EM).toFixed(3)}em`;
  const valignEm = `${(asset.verticalAlignEx * EX_TO_EM).toFixed(3)}em`;

  svg = svg.replace(/width="[\d.]+ex"/, `width="${widthEm}"`);
  svg = svg.replace(/height="[\d.]+ex"/, `height="${heightEm}"`);

  if (displayMode) {
    // Display equation: centered block that shrinks to the column width when it
    // can, and scrolls when shrinking further would make it unreadable. The
    // viewBox is left untouched, so nothing is cropped.
    svg = svg.replace('<svg', `<svg ${geometryAttrs('display', widthEm, heightEm, null)} `
      + `style="${displaySvgStyle(widthEm)}"`);

    return `<section data-latex="${escapedLatex}" data-display="true" data-mdtex-math="display" `
      + `style="text-align:center;margin:1em 0;max-width:100%;overflow-x:auto;overflow-y:visible;">`
      + `<section data-mdtex-math="display-box" style="display:inline-block;max-width:100%;margin:0;">`
      + svg
      + `</section></section>`;
  }

  // Inline equation: sized in em so it scales with the surrounding text.
  //
  // Every property that could stretch it is stated explicitly rather than left
  // to default. A theme rule as ordinary as `#nice svg { width: 100% }` is
  // inlined onto this element by juice, and a CSS width beats the `width="…"`
  // presentation attribute — which turns a one-glyph formula like $K$ into a
  // full-column-width image while longer formulas, already near that width,
  // look almost unchanged. `math/normalize-sizing.js` is the backstop for
  // rules that outrank these declarations; this is the first line of defence.
  svg = svg.replace('<svg', `<svg ${geometryAttrs('inline', widthEm, heightEm, valignEm)} `
    + `style="${inlineSvgStyle(widthEm, heightEm)}"`);

  return `<span data-latex="${escapedLatex}" data-display="false" `
    + `${geometryAttrs('inline', widthEm, heightEm, valignEm)} `
    + `style="${inlineWrapperStyle(valignEm, widthEm, heightEm)}">`
    + svg
    + `</span>`;
}

function buildPngFallback(asset, escapedLatex, displayMode) {
  const src = asset.pngDataUri;
  const widthEm = `${(asset.widthEx * EX_TO_EM).toFixed(3)}em`;
  const heightEm = `${(asset.heightEx * EX_TO_EM).toFixed(3)}em`;

  if (displayMode) {
    return `<section data-latex="${escapedLatex}" data-display="true" data-mdtex-math="display" `
      + `style="text-align:center;margin:1em 0;max-width:100%;overflow-x:auto;overflow-y:visible;">`
      + `<img src="${src}" alt="${escapedLatex}" `
      + `${geometryAttrs('display', widthEm, heightEm, null)} `
      + `style="${displaySvgStyle(widthEm)}" />`
      + `</section>`;
  }

  const valignEm = `${(asset.verticalAlignEx * EX_TO_EM).toFixed(3)}em`;
  return `<img src="${src}" alt="${escapedLatex}" data-latex="${escapedLatex}" data-display="false" `
    + `${geometryAttrs('inline', widthEm, heightEm, valignEm)} `
    + `style="${inlineImageStyle(widthEm, heightEm, valignEm)}" />`;
}

function escapeAttr(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function decodeHtmlEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
