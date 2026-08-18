import { mathjax } from 'mathjax-full/js/mathjax.js';
import { TeX } from 'mathjax-full/js/input/tex.js';
import { SVG } from 'mathjax-full/js/output/svg.js';
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js';
import { AllPackages } from 'mathjax-full/js/input/tex/AllPackages.js';

let _instance = null;

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
    fontCache: 'none', // Self-contained: each SVG has its own <path> glyphs
  });

  const doc = mathjax.document('', { InputJax: tex, OutputJax: svg });

  _instance = { adaptor, doc };
  return _instance;
}

/**
 * Render LaTeX to a self-contained, WeChat-safe inline SVG string.
 *
 * MathJax with fontCache:'none' outputs SVGs containing only <path> elements —
 * no <defs>, <use>, id, class, or clip-path attributes. This is critical for
 * WeChat compatibility, which strips those constructs.
 *
 * The SVG retains its original ex-based width/height and viewBox for accurate
 * intrinsic dimensions. The container wrapper handles display sizing.
 *
 * Returns { svg, widthEx, heightEx, verticalAlignEx, viewBox, error }
 */
export function renderLatexToSvg(latex, displayMode = false) {
  const { adaptor, doc } = getMathJax();

  try {
    const node = doc.convert(latex, { display: displayMode });
    let svg = adaptor.outerHTML(node);

    // Extract original ex-based dimensions from MathJax output
    const widthMatch = svg.match(/width="([\d.]+)ex"/);
    const heightMatch = svg.match(/height="([\d.]+)ex"/);
    const valignMatch = svg.match(/style="[^"]*vertical-align:\s*(-?[\d.]+)ex/);
    const viewBoxMatch = svg.match(/viewBox="([^"]+)"/);

    const widthEx = widthMatch ? parseFloat(widthMatch[1]) : 1;
    const heightEx = heightMatch ? parseFloat(heightMatch[1]) : 1;
    const verticalAlignEx = valignMatch ? parseFloat(valignMatch[1]) : 0;
    const viewBox = viewBoxMatch ? viewBoxMatch[1] : '0 0 100 100';

    // Extract the inner SVG from MathJax's <mjx-container> wrapper
    const svgMatch = svg.match(/<svg[\s\S]*<\/svg>/);
    if (svgMatch) {
      svg = svgMatch[0];
    }

    // Ensure xmlns for standalone SVG validity
    if (!svg.includes('xmlns="http://www.w3.org/2000/svg"')) {
      svg = svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    }

    // Strip MathJax's inline style attribute (vertical-align is handled by the wrapper)
    svg = svg.replace(/\s*style="[^"]*"/, '');

    // Strip role and focusable attributes (unnecessary noise, WeChat may choke)
    svg = svg.replace(/\s*role="[^"]*"/, '');
    svg = svg.replace(/\s*focusable="[^"]*"/, '');

    // Strip data-mml-node and data-c attributes to reduce size
    svg = svg.replace(/\s*data-mml-node="[^"]*"/g, '');
    svg = svg.replace(/\s*data-c="[^"]*"/g, '');
    svg = svg.replace(/\s*data-mjx-texclass="[^"]*"/g, '');

    if (!svg || svg.length < 50) {
      return { svg: null, widthEx: 0, heightEx: 0, verticalAlignEx: 0, viewBox: '', error: 'Empty SVG output' };
    }

    return {
      svg,
      widthEx,
      heightEx,
      verticalAlignEx,
      viewBox,
      error: null,
    };
  } catch (e) {
    return { svg: null, widthEx: 0, heightEx: 0, verticalAlignEx: 0, viewBox: '', error: e.message || String(e) };
  }
}

/**
 * Render LaTeX to an SVG data URI (for PNG conversion or fallback).
 */
export function renderLatexToDataUri(latex, displayMode = false) {
  const result = renderLatexToSvg(latex, displayMode);
  if (result.error || !result.svg) return result;

  // For data URI, convert ex dimensions to pixels for deterministic rendering
  const EX_TO_PX = 7;
  let pxSvg = result.svg;
  pxSvg = pxSvg.replace(/width="[\d.]+ex"/, `width="${Math.ceil(result.widthEx * EX_TO_PX)}"`);
  pxSvg = pxSvg.replace(/height="[\d.]+ex"/, `height="${Math.ceil(result.heightEx * EX_TO_PX)}"`);

  const encoded = Buffer.from(pxSvg).toString('base64');
  result.dataUri = `data:image/svg+xml;base64,${encoded}`;
  result.pxSvg = pxSvg;
  return result;
}
