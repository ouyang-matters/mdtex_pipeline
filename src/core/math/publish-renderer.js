import { mathjax } from 'mathjax-full/js/mathjax.js';
import { TeX } from 'mathjax-full/js/input/tex.js';
import { SVG } from 'mathjax-full/js/output/svg.js';
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js';
import { AllPackages } from 'mathjax-full/js/input/tex/AllPackages.js';

let _instance = null;

// 1ex ≈ 0.4313em in MathJax's default metrics.
// We convert ex→px at a fixed ratio so SVGs have deterministic pixel dimensions.
// At 16px base font: 1ex ≈ 6.9px. We use 7 for clean rounding.
const EX_TO_PX = 7;

function getMathJax() {
  if (_instance) return _instance;

  const adaptor = liteAdaptor();
  RegisterHTMLHandler(adaptor);

  const tex = new TeX({
    packages: AllPackages,
    inlineMath: [['$', '$']],
    displayMath: [['$$', '$$']],
  });

  const svg = new SVG({
    fontCache: 'none',
  });

  const doc = mathjax.document('', { InputJax: tex, OutputJax: svg });

  _instance = { adaptor, doc };
  return _instance;
}

/**
 * Render LaTeX to a self-contained SVG string with pixel dimensions.
 *
 * MathJax outputs width/height in `ex` units. We convert these to pixels
 * so the SVG has deterministic absolute dimensions when embedded as a
 * data-URI <img>. The <img> tag then uses em-based sizing to scale
 * proportionally with surrounding text.
 *
 * Returns { svg, widthPx, heightPx, widthEx, heightEx, verticalAlign, verticalAlignPx, error }
 */
export function renderLatexToSvg(latex, displayMode = false) {
  const { adaptor, doc } = getMathJax();

  try {
    const node = doc.convert(latex, { display: displayMode });
    let svg = adaptor.outerHTML(node);

    // Extract original ex-based dimensions
    const widthMatch = svg.match(/width="([\d.]+)ex"/);
    const heightMatch = svg.match(/height="([\d.]+)ex"/);
    const valignMatch = svg.match(/style="[^"]*vertical-align:\s*(-?[\d.]+)ex/);

    const widthEx = widthMatch ? parseFloat(widthMatch[1]) : 1;
    const heightEx = heightMatch ? parseFloat(heightMatch[1]) : 1;
    const verticalAlignEx = valignMatch ? parseFloat(valignMatch[1]) : 0;

    // Convert to pixels
    const widthPx = Math.ceil(widthEx * EX_TO_PX);
    const heightPx = Math.ceil(heightEx * EX_TO_PX);
    const verticalAlignPx = Math.round(verticalAlignEx * EX_TO_PX);

    // Extract the inner SVG from MathJax's container
    const svgMatch = svg.match(/<svg[\s\S]*<\/svg>/);
    if (svgMatch) {
      svg = svgMatch[0];
    }

    // Ensure xmlns
    if (!svg.includes('xmlns="http://www.w3.org/2000/svg"')) {
      svg = svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    }

    // Replace ex-based width/height with pixel values so the SVG
    // renders at a deterministic size when used as <img src="data:...">
    svg = svg.replace(/width="[\d.]+ex"/, `width="${widthPx}"`);
    svg = svg.replace(/height="[\d.]+ex"/, `height="${heightPx}"`);

    // Remove the inline style (vertical-align is handled by the <img> tag)
    svg = svg.replace(/\s*style="[^"]*"/, '');

    if (!svg || svg.length < 50) {
      return { svg: null, widthPx: 0, heightPx: 0, widthEx: 0, heightEx: 0, verticalAlign: null, verticalAlignPx: 0, error: 'Empty SVG output' };
    }

    return {
      svg,
      widthPx,
      heightPx,
      widthEx,
      heightEx,
      verticalAlign: `${verticalAlignEx}ex`,
      verticalAlignPx,
      error: null,
      // Keep legacy fields for compatibility
      width: `${widthPx}`,
      height: `${heightPx}`,
    };
  } catch (e) {
    return { svg: null, widthPx: 0, heightPx: 0, widthEx: 0, heightEx: 0, verticalAlign: null, verticalAlignPx: 0, error: e.message || String(e), width: null, height: null };
  }
}

/**
 * Render LaTeX to an SVG data URI.
 */
export function renderLatexToDataUri(latex, displayMode = false) {
  const result = renderLatexToSvg(latex, displayMode);
  if (result.error || !result.svg) return result;

  const encoded = Buffer.from(result.svg).toString('base64');
  result.dataUri = `data:image/svg+xml;base64,${encoded}`;
  return result;
}
