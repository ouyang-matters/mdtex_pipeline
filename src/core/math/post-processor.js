import { renderLatexToSvg, renderLatexToDataUri } from './publish-renderer.js';
import { svgToPngDataUri } from './svg-to-png.js';
import { FormulaCache } from './formula-cache.js';

/**
 * Math output modes for publishing.
 */
export const MathOutput = {
  SVG: 'svg',    // Inline SVG (primary, best WeChat compat)
  PNG: 'png',    // PNG <img> fallback
  AUTO: 'auto',  // SVG preferred
};

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
 */
export async function replaceKatexWithImages(html, options = {}) {
  const { mathOutput = MathOutput.SVG, cache = new FormulaCache() } = options;

  const errors = [];
  const stats = { inlineRendered: 0, displayRendered: 0, cached: 0, errors: 0 };

  // Process display math first (wrapped in <section><eqn>...</eqn></section>)
  html = await replacePattern(
    html,
    /<section>\s*<eqn>([\s\S]*?)<\/eqn>\s*<\/section>/g,
    true,
    mathOutput, cache, stats, errors,
  );

  // Process inline math (<eq>...</eq>)
  html = await replacePattern(
    html,
    /<eq>([\s\S]*?)<\/eq>/g,
    false,
    mathOutput, cache, stats, errors,
  );

  return { html, stats, errors };
}

async function replacePattern(html, pattern, displayMode, mathOutput, cache, stats, errors) {
  const matches = [];
  let match;

  while ((match = pattern.exec(html)) !== null) {
    matches.push({
      fullMatch: match[0],
      content: match[1],
      index: match.index,
    });
  }

  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i];

    const latex = extractLatex(m.content);
    if (!latex) {
      errors.push(`Could not extract LaTeX from math element at position ${m.index}`);
      stats.errors++;
      continue;
    }

    // Check cache
    let cached = cache.get(latex, displayMode);
    if (cached && !cached.error && cached.svg) {
      // Regenerate PNG if needed
      if (mathOutput === MathOutput.PNG && !cached.pngDataUri) {
        try {
          const dataUriResult = renderLatexToDataUri(latex, displayMode);
          const pngResult = await svgToPngDataUri(dataUriResult.pxSvg || cached.svg, { scale: 3 });
          cached.pngDataUri = pngResult.pngDataUri;
          cache.set(latex, displayMode, { ...cached, pngBuffer: pngResult.pngBuffer });
        } catch { /* fall back to SVG */ }
      }

      const replacement = buildFormulaHtml(cached, latex, displayMode, mathOutput);
      html = html.slice(0, m.index) + replacement + html.slice(m.index + m.fullMatch.length);
      if (displayMode) stats.displayRendered++; else stats.inlineRendered++;
      stats.cached++;
      continue;
    }

    // Render to SVG
    const svgResult = renderLatexToSvg(latex, displayMode);
    if (svgResult.error || !svgResult.svg) {
      errors.push(`Failed to render formula: ${latex.slice(0, 50)}... — ${svgResult.error}`);
      stats.errors++;
      continue;
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

    // Generate PNG if requested
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
          errors.push(`PNG conversion failed: ${latex.slice(0, 50)}... — ${e.message}`);
          stats.errors++;
          continue;
        }
      }
    }

    cache.set(latex, displayMode, asset);

    const replacement = buildFormulaHtml(asset, latex, displayMode, mathOutput);
    html = html.slice(0, m.index) + replacement + html.slice(m.index + m.fullMatch.length);
    if (displayMode) stats.displayRendered++; else stats.inlineRendered++;
  }

  return html;
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
 * - Display: centered section with the SVG inside
 * - Inline: span wrapper with vertical-align for baseline alignment
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

  // Prepare the inline SVG with proper sizing
  let svg = asset.svg;

  if (displayMode) {
    // Display equation: centered block.
    // Set SVG width to 100% of container with preserved aspect ratio via viewBox.
    // The container constrains the maximum visual width.
    // Wide equations scale down; narrow ones center naturally.
    const maxWidthEm = (asset.widthEx * 0.44).toFixed(2); // ex → em approx

    // Replace SVG width/height: use max-width container + auto sizing via viewBox
    svg = svg.replace(/width="[\d.]+ex"/, `width="${maxWidthEm}em"`);
    svg = svg.replace(/height="[\d.]+ex"/, '');  // remove height, let viewBox control aspect ratio

    return `<section data-latex="${escapedLatex}" data-display="true" `
      + `style="text-align:center;margin:1em 0;overflow-x:auto;overflow-y:visible;">`
      + `<section style="display:inline-block;max-width:100%;">`
      + svg
      + `</section></section>`;
  } else {
    // Inline equation: SVG sized relative to surrounding text.
    // Use em-based dimensions so the formula scales with font-size.
    const heightEm = (asset.heightEx * 0.44).toFixed(3);
    const widthEm = (asset.widthEx * 0.44).toFixed(3);
    const valignEm = (asset.verticalAlignEx * 0.44).toFixed(3);

    svg = svg.replace(/width="[\d.]+ex"/, `width="${widthEm}em"`);
    svg = svg.replace(/height="[\d.]+ex"/, `height="${heightEm}em"`);

    return `<span data-latex="${escapedLatex}" data-display="false" `
      + `style="display:inline-block;vertical-align:${valignEm}em;margin:0 0.1em;">`
      + svg
      + `</span>`;
  }
}

function buildPngFallback(asset, escapedLatex, displayMode) {
  const src = asset.pngDataUri;
  if (displayMode) {
    const widthEm = (asset.widthEx * 0.44).toFixed(2);
    return `<section data-latex="${escapedLatex}" data-display="true" `
      + `style="text-align:center;margin:1em 0;overflow-x:auto;">`
      + `<img src="${src}" alt="${escapedLatex}" `
      + `style="max-width:100%;width:${widthEm}em;height:auto;vertical-align:middle;" />`
      + `</section>`;
  } else {
    const heightEm = (asset.heightEx * 0.44).toFixed(3);
    const valignEm = (asset.verticalAlignEx * 0.44).toFixed(3);
    return `<img src="${src}" alt="${escapedLatex}" data-latex="${escapedLatex}" data-display="false" `
      + `style="height:${heightEm}em;vertical-align:${valignEm}em;margin:0 0.1em;display:inline;" />`;
  }
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
