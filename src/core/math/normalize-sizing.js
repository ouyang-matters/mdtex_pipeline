import {
  MATH_MODE_ATTR, WIDTH_ATTR, HEIGHT_ATTR, VALIGN_ATTR, GEOMETRY_PROPERTIES,
  inlineSvgStyle, inlineWrapperStyle, inlineImageStyle, displaySvgStyle,
} from './sizing.js';

/**
 * Restore formula sizing after CSS inlining.
 *
 * Inlining is where a formula's size stops being ours. juice folds every
 * matching rule into the element's `style` attribute, and a rule as ordinary as
 *
 *     #nice svg { width: 100%; height: auto; display: block; }
 *
 * lands on inline math along with everything else. A CSS `width` outranks the
 * `width="0.885em"` presentation attribute, so a one-glyph formula like $K$ is
 * stretched to the full column width. Longer formulas are already close to that
 * width and barely change, and display equations carry their own explicit
 * styles — which is why the symptom looks intermittent and specific to short
 * inline math when it is neither.
 *
 * Declaring the properties up front (see `sizing.js`) fixes the common case,
 * but not a theme rule that outranks them — `!important`, or a more specific
 * selector — because juice appends the winner *after* our declarations, and in
 * a style attribute the last one wins. So this runs afterwards and has the
 * final word.
 *
 * It drops every geometry property from each math element and restates the ones
 * that belong there, from the intrinsic dimensions recorded on the element when
 * it was built. Non-geometry declarations — fill, colour, opacity — are left
 * alone: a theme is entitled to those.
 *
 * Idempotent: the geometry is read from data attributes, not from the style, so
 * running it twice produces the same result.
 */

const MATH_ELEMENT = new RegExp(
  `<(svg|span|img|section)\\b([^>]*\\b${MATH_MODE_ATTR}="[^"]*"[^>]*)>`,
  'gi',
);

export function normalizeMathSizing(html) {
  if (!html || !html.includes(MATH_MODE_ATTR)) {
    return { html, normalized: 0, stripped: 0 };
  }

  let normalized = 0;
  let stripped = 0;

  const out = html.replace(MATH_ELEMENT, (whole, tagName, attrs) => {
    const tag = tagName.toLowerCase();
    const mode = attrValue(attrs, MATH_MODE_ATTR);
    const width = attrValue(attrs, WIDTH_ATTR);
    const height = attrValue(attrs, HEIGHT_ATTR);
    const valign = attrValue(attrs, VALIGN_ATTR);

    const authoritative = styleFor(tag, mode, width, height, valign);
    if (!authoritative) return whole;

    const existing = parseDeclarations(attrValue(attrs, 'style') || '');
    const kept = existing.filter(d => !GEOMETRY_PROPERTIES.includes(d.property));
    stripped += existing.length - kept.length;
    normalized++;

    const style = kept.map(d => `${d.property}:${d.value}`).join(';');
    const merged = style ? `${style};${authoritative}` : authoritative;

    const selfClosing = whole.trimEnd().endsWith('/>');
    return `<${tagName}${setStyle(attrs, merged)}${selfClosing ? ' /' : ''}>`;
  });

  return { html: out, normalized, stripped };
}

/** The sizing a given element is entitled to, or null to leave it alone. */
function styleFor(tag, mode, width, height, valign) {
  const w = width || 'auto';
  const h = height || 'auto';
  const va = valign || '0em';

  if (mode === 'inline') {
    if (tag === 'svg') return inlineSvgStyle(w, h);
    if (tag === 'img') return inlineImageStyle(w, h, va);
    if (tag === 'span') return inlineWrapperStyle(va, w, h);
    return null;
  }

  if (mode === 'display') {
    if (tag === 'svg' || tag === 'img') return displaySvgStyle(w);
    // The centred block that holds the equation, and the scroll container
    // around it. Neither may be forced to a width, but both keep the margins
    // and alignment they were built with.
    if (tag === 'section') {
      // The scroll container: a wide equation scrolls horizontally rather than
      // being cropped, and never grows a vertical scrollbar.
      return 'display:block;max-width:100%;margin:1em 0;'
        + 'overflow-x:auto;overflow-y:visible;';
    }
    return null;
  }

  if (mode === 'display-box' && tag === 'section') {
    return 'display:inline-block;max-width:100%;margin:0;overflow:visible;';
  }

  return null;
}

/** Read one attribute's value out of a raw attribute string. */
function attrValue(attrs, name) {
  const match = attrs.match(new RegExp(`\\b${name}="([^"]*)"`, 'i'));
  return match ? match[1] : null;
}

/** Replace (or add) the style attribute in a raw attribute string. */
function setStyle(attrs, style) {
  if (/\bstyle="[^"]*"/i.test(attrs)) {
    return attrs.replace(/\bstyle="[^"]*"/i, `style="${style}"`);
  }
  return `${attrs.trimEnd()} style="${style}"`;
}

/**
 * Split a style attribute into declarations, last occurrence winning.
 *
 * A style attribute may legitimately contain the same property twice — that is
 * exactly how juice appends an `!important` winner — and the later one is the
 * one in effect. Collapsing to the last occurrence keeps that meaning.
 */
function parseDeclarations(style) {
  const byProperty = new Map();
  for (const part of splitDeclarations(style)) {
    const colon = part.indexOf(':');
    if (colon < 1) continue;
    const property = part.slice(0, colon).trim().toLowerCase();
    const value = part.slice(colon + 1).trim();
    if (!property || !value) continue;
    byProperty.set(property, value);
  }
  return [...byProperty].map(([property, value]) => ({ property, value }));
}

/** Split on semicolons that are not inside a url(...) or a quoted string. */
function splitDeclarations(style) {
  const parts = [];
  let current = '';
  let depth = 0;
  let quote = null;

  for (const char of style) {
    if (quote) {
      if (char === quote) quote = null;
      current += char;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; current += char; continue; }
    if (char === '(') depth++;
    if (char === ')') depth = Math.max(0, depth - 1);
    if (char === ';' && depth === 0) { parts.push(current); current = ''; continue; }
    current += char;
  }
  if (current.trim()) parts.push(current);
  return parts;
}
