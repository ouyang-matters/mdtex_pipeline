import { mathjax } from 'mathjax-full/js/mathjax.js';
import { TeX } from 'mathjax-full/js/input/tex.js';
import { SVG } from 'mathjax-full/js/output/svg.js';
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js';
import { AllPackages } from 'mathjax-full/js/input/tex/AllPackages.js';

let _instance = null;

/**
 * Get or create the MathJax SVG rendering instance.
 * Singleton to avoid repeated initialization overhead.
 */
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
    fontCache: 'none', // No font cache — each SVG is self-contained
  });

  const doc = mathjax.document('', { InputJax: tex, OutputJax: svg });

  _instance = { adaptor, doc };
  return _instance;
}

/**
 * Render LaTeX to a self-contained SVG string.
 * The SVG uses <path> elements — no CSS or font dependencies.
 *
 * Returns { svg, width, height, verticalAlign, error }
 */
export function renderLatexToSvg(latex, displayMode = false) {
  const { adaptor, doc } = getMathJax();

  try {
    const node = doc.convert(latex, { display: displayMode });
    let svg = adaptor.outerHTML(node);

    // Extract dimensions from the MathJax SVG container
    const widthMatch = svg.match(/width="([^"]+)"/);
    const heightMatch = svg.match(/height="([^"]+)"/);
    const valignMatch = svg.match(/style="[^"]*vertical-align:\s*([^;"]+)/);

    const width = widthMatch ? widthMatch[1] : null;
    const height = heightMatch ? heightMatch[1] : null;
    const verticalAlign = valignMatch ? valignMatch[1] : null;

    // Clean up: remove the MathJax container wrapper, keep the inner SVG
    // MathJax wraps in <mjx-container><svg>...</svg></mjx-container>
    const svgMatch = svg.match(/<svg[\s\S]*<\/svg>/);
    if (svgMatch) {
      svg = svgMatch[0];
    }

    // Ensure SVG has xmlns
    if (!svg.includes('xmlns="http://www.w3.org/2000/svg"')) {
      svg = svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    }

    // Validate: non-empty SVG with actual content
    if (!svg || svg.length < 50) {
      return { svg: null, width: null, height: null, verticalAlign: null, error: 'Empty SVG output' };
    }

    return { svg, width, height, verticalAlign, error: null };
  } catch (e) {
    return { svg: null, width: null, height: null, verticalAlign: null, error: e.message || String(e) };
  }
}

/**
 * Render LaTeX to an SVG data URI suitable for <img src="...">.
 */
export function renderLatexToDataUri(latex, displayMode = false) {
  const result = renderLatexToSvg(latex, displayMode);
  if (result.error || !result.svg) return result;

  const encoded = Buffer.from(result.svg).toString('base64');
  result.dataUri = `data:image/svg+xml;base64,${encoded}`;
  return result;
}
