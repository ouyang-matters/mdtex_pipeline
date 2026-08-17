import { renderLatexToSvg, renderLatexToDataUri } from './publish-renderer.js';
import { svgToPngDataUri } from './svg-to-png.js';
import { FormulaCache } from './formula-cache.js';

/**
 * Math output modes for publishing.
 */
export const MathOutput = {
  SVG: 'svg',
  PNG: 'png',
  AUTO: 'auto', // SVG preferred, PNG fallback
};

/**
 * Post-process rendered HTML to replace KaTeX math elements with
 * self-contained image assets for publishing.
 *
 * Extracts LaTeX from <annotation> elements, renders to SVG/PNG,
 * replaces KaTeX DOM with <img> tags.
 *
 * @param {string} html - Rendered HTML containing KaTeX output
 * @param {object} options
 * @param {string} options.mathOutput - 'svg', 'png', or 'auto'
 * @param {FormulaCache} options.cache - Optional formula cache
 * @returns {Promise<{ html: string, stats: object, errors: string[] }>}
 */
export async function replaceKatexWithImages(html, options = {}) {
  const { mathOutput = MathOutput.SVG, cache = new FormulaCache() } = options;

  const errors = [];
  const stats = { inlineRendered: 0, displayRendered: 0, cached: 0, errors: 0 };

  // Process display math first (they're wrapped in <section><eqn>...</eqn></section>)
  html = await replacePattern(
    html,
    /<section>\s*<eqn>([\s\S]*?)<\/eqn>\s*<\/section>/g,
    true, // displayMode
    mathOutput, cache, stats, errors,
  );

  // Process inline math (<eq>...</eq>)
  html = await replacePattern(
    html,
    /<eq>([\s\S]*?)<\/eq>/g,
    false, // inline
    mathOutput, cache, stats, errors,
  );

  return { html, stats, errors };
}

/**
 * Replace all matches of a pattern with rendered formula images.
 */
async function replacePattern(html, pattern, displayMode, mathOutput, cache, stats, errors) {
  const matches = [];
  let match;

  // Collect all matches first (can't do async replacements in a regex callback)
  while ((match = pattern.exec(html)) !== null) {
    matches.push({
      fullMatch: match[0],
      content: match[1],
      index: match.index,
    });
  }

  // Process in reverse order to preserve indices
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i];

    // Extract LaTeX from the <annotation> element
    const latex = extractLatex(m.content);
    if (!latex) {
      errors.push(`Could not extract LaTeX from math element at position ${m.index}`);
      stats.errors++;
      continue;
    }

    // Check cache
    let cached = cache.get(latex, displayMode);
    if (cached && !cached.error) {
      // If PNG is requested but only SVG is cached, generate PNG from cached SVG
      if (mathOutput === MathOutput.PNG && !cached.pngDataUri && cached.svg) {
        try {
          const pngResult = await svgToPngDataUri(cached.svg, { scale: 3 });
          cached.pngDataUri = pngResult.pngDataUri;
          cache.set(latex, displayMode, { ...cached, pngBuffer: pngResult.pngBuffer });
        } catch { /* fall back to SVG */ }
      }
      const imgTag = buildImgTag(cached, latex, displayMode, mathOutput);
      html = html.slice(0, m.index) + imgTag + html.slice(m.index + m.fullMatch.length);
      if (displayMode) stats.displayRendered++; else stats.inlineRendered++;
      stats.cached++;
      continue;
    }

    // Render to SVG
    const svgResult = renderLatexToSvg(latex, displayMode);
    if (svgResult.error || !svgResult.svg) {
      errors.push(`Failed to render formula: ${latex.slice(0, 50)}... — ${svgResult.error}`);
      stats.errors++;
      // Keep the original KaTeX HTML rather than dropping the formula
      continue;
    }

    // Build the asset
    const asset = {
      svg: svgResult.svg,
      width: svgResult.width,
      height: svgResult.height,
      verticalAlign: svgResult.verticalAlign,
      dataUri: null,
      pngDataUri: null,
      pngBuffer: null,
      error: null,
    };

    // Generate data URIs based on output mode
    if (mathOutput === MathOutput.SVG || mathOutput === MathOutput.AUTO) {
      const encoded = Buffer.from(svgResult.svg).toString('base64');
      asset.dataUri = `data:image/svg+xml;base64,${encoded}`;
    }

    if (mathOutput === MathOutput.PNG || mathOutput === MathOutput.AUTO) {
      try {
        const pngResult = await svgToPngDataUri(svgResult.svg, { scale: 3 });
        asset.pngDataUri = pngResult.pngDataUri;
        asset.pngBuffer = pngResult.pngBuffer;
      } catch (e) {
        if (mathOutput === MathOutput.PNG) {
          errors.push(`PNG conversion failed for: ${latex.slice(0, 50)}... — ${e.message}`);
          stats.errors++;
          continue;
        }
        // AUTO mode: SVG is fine, PNG failed, non-fatal
      }
    }

    // Cache the result
    cache.set(latex, displayMode, asset);

    // Build <img> tag
    const imgTag = buildImgTag(asset, latex, displayMode, mathOutput);
    html = html.slice(0, m.index) + imgTag + html.slice(m.index + m.fullMatch.length);
    if (displayMode) stats.displayRendered++; else stats.inlineRendered++;
  }

  return html;
}

/**
 * Extract LaTeX source from KaTeX-rendered HTML.
 * Looks for <annotation encoding="application/x-tex"> content.
 */
function extractLatex(katexHtml) {
  const match = katexHtml.match(/<annotation encoding="application\/x-tex">([\s\S]*?)<\/annotation>/);
  if (match) {
    return decodeHtmlEntities(match[1].trim());
  }

  // Fallback: try to find LaTeX in data attributes
  const dataMatch = katexHtml.match(/data-latex="([^"]*)"/);
  if (dataMatch) {
    return decodeHtmlEntities(dataMatch[1]);
  }

  return null;
}

/**
 * Build an <img> tag for a rendered formula.
 */
function buildImgTag(asset, latex, displayMode, mathOutput = MathOutput.SVG) {
  // Choose source based on output mode
  let src;
  if (mathOutput === MathOutput.PNG) {
    src = asset.pngDataUri || asset.dataUri;
  } else {
    src = asset.dataUri || asset.pngDataUri;
  }
  if (!src) return `<span class="math-error">[formula rendering failed]</span>`;

  const escapedLatex = escapeAttr(latex);

  if (displayMode) {
    // Display equation: centered block, responsive
    return `<section style="text-align:center;margin:1em 0;overflow-x:auto;overflow-y:hidden;">`
      + `<img src="${src}" `
      + `alt="${escapedLatex}" `
      + `data-latex="${escapedLatex}" `
      + `data-display="true" `
      + `style="max-width:100%;height:auto;vertical-align:middle;" `
      + `/>`
      + `</section>`;
  } else {
    // Inline equation: vertically aligned with text
    const valign = asset.verticalAlign || '-0.25ex';
    // Parse height for sizing relative to surrounding text
    const heightStyle = asset.height ? `height:${asset.height};` : 'height:1.2em;';

    return `<img src="${src}" `
      + `alt="${escapedLatex}" `
      + `data-latex="${escapedLatex}" `
      + `data-display="false" `
      + `style="${heightStyle}vertical-align:${valign};margin:0 0.15em;display:inline;" `
      + `/>`;
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
