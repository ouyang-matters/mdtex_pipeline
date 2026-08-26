/**
 * The one place that decides how a formula is sized.
 *
 * Both the builder (`post-processor.js`) and the post-CSS-inlining normalizer
 * (`normalize-sizing.js`) use these, so the styles asserted after inlining are
 * the same ones that were emitted before it. Two independent descriptions of
 * "how big is inline math" is how they drift apart.
 *
 * Inline and display are genuinely different objects and are never sized by the
 * same rule:
 *
 *   inline    intrinsic width and height, baseline-aligned, flows with text,
 *             and explicitly opts out of every responsive rule — an inline
 *             formula that stretches to the column is a bug, not a small image
 *   display   its own centred block, width capped at the column, aspect
 *             preserved, allowed to scroll rather than be cropped
 */

/** MathJax reports ex; publishing output is em so it tracks the surrounding text. */
export const EX_TO_EM = 0.44;

/** Mode marker carried by every math element through the whole pipeline. */
export const MATH_MODE_ATTR = 'data-mdtex-math';

/** Intrinsic geometry, carried so normalization can restore it rather than guess. */
export const WIDTH_ATTR = 'data-mdtex-w';
export const HEIGHT_ATTR = 'data-mdtex-h';
export const VALIGN_ATTR = 'data-mdtex-va';

/**
 * Properties that decide how big an element is, and which therefore may not be
 * inherited from a generic `img`/`svg`/block rule.
 *
 * Normalization drops every one of these from a math element and restates the
 * ones that belong there. Anything not in this list — fill, colour, opacity —
 * is left alone, because a theme is entitled to style those.
 */
export const GEOMETRY_PROPERTIES = [
  'width', 'min-width', 'max-width',
  'height', 'min-height', 'max-height',
  'display', 'float', 'object-fit', 'box-sizing', 'vertical-align',
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  // Overflow is geometry here too: a theme that sets `overflow:auto` on math
  // paints a stray scrollbar beside every equation, and promotes overflow-y on
  // the display container from visible to auto.
  'overflow', 'overflow-x', 'overflow-y',
];

/** The `<svg>` of an inline formula. */
export function inlineSvgStyle(widthEm, heightEm) {
  return `display:inline-block;width:${widthEm};height:${heightEm};`
    + 'max-width:none;margin:0;vertical-align:baseline;';
}

/**
 * The `<span>` wrapping an inline formula.
 *
 * It states the same intrinsic width and height as the SVG rather than
 * shrink-wrapping it. That redundancy is the point: a paste target that strips
 * the SVG's dimensions leaves an element with only a `viewBox`, which by
 * specification fills its container — 768px wide for a single glyph. Sized
 * explicitly, the wrapper is the container, and the formula stays the size it
 * was meant to be.
 */
export function inlineWrapperStyle(valignEm, widthEm = 'auto', heightEm = 'auto') {
  return `display:inline-block;width:${widthEm};height:${heightEm};`
    + `max-width:none;margin:0 0.1em;vertical-align:${valignEm};overflow:visible;`;
}

/** The `<img>` of an inline formula, in PNG mode. */
export function inlineImageStyle(widthEm, heightEm, valignEm) {
  return `display:inline-block;width:${widthEm};height:${heightEm};`
    + `max-width:none;margin:0 0.1em;vertical-align:${valignEm};`;
}

/**
 * The `<svg>` or `<img>` of a display equation.
 *
 * `width` is stated rather than left implicit: a theme rule that sets
 * `width:100%` would otherwise scale a short equation up to the column width.
 * `max-width` still lets a wide one shrink, and `height:auto` keeps the aspect.
 */
export function displaySvgStyle(widthEm) {
  return `display:inline-block;width:${widthEm};max-width:100%;height:auto;`
    + 'margin:0;vertical-align:middle;';
}

/** The mode and geometry attributes for a math element. */
export function geometryAttrs(mode, widthEm, heightEm, valignEm) {
  const parts = [
    `${MATH_MODE_ATTR}="${mode}"`,
    `${WIDTH_ATTR}="${widthEm}"`,
    `${HEIGHT_ATTR}="${heightEm}"`,
  ];
  if (valignEm !== null && valignEm !== undefined) parts.push(`${VALIGN_ATTR}="${valignEm}"`);
  return parts.join(' ');
}
