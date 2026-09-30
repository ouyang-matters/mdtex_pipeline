import { decodeHtmlEntities } from '../html-entities.js';

/**
 * Plain-text rendering of compiled HTML.
 *
 * Used for the `text/plain` clipboard flavour, so pasting into a plain-text
 * field yields readable prose rather than a wall of markup. Formulas fall back
 * to their LaTeX source, which is preserved in the `data-latex` attribute.
 */
export function htmlToPlainText(html) {
  let text = String(html ?? '');

  // Formula nodes carry their source; use it instead of dropping the maths.
  //
  // Each formula is set aside behind a placeholder and restored only after
  // the markup is gone. Decoded TeX such as `a<b` would otherwise be read as
  // the start of a tag and stripped along with everything up to the next `>`.
  const formulas = [];
  const setAside = (tag, latex) => {
    const tex = decodeEntities(latex);
    formulas.push(/data-display="true"/i.test(tag) ? `\n$$${tex}$$\n` : `$${tex}$`);
    return `\u0000${formulas.length - 1}\u0000`;
  };
  // <img> is void: the formula is the tag alone.
  text = text.replace(/<img\b[^>]*\bdata-latex="([^"]*)"[^>]*>/gi, (tag, latex) => setAside(tag, latex));
  text = text.replace(
    /(<(section|span)\b[^>]*\bdata-latex="([^"]*)"[^>]*>)[\s\S]*?<\/\2>/gi,
    (_, tag, _name, latex) => setAside(tag, latex),
  );

  text = text.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/(p|div|section|li|tr|h[1-6]|pre|blockquote)>/gi, '\n');
  text = text.replace(/<li\b[^>]*>/gi, '- ');
  text = text.replace(/<t[dh]\b[^>]*>/gi, '\t');
  text = text.replace(/<[^>]+>/g, '');

  text = decodeEntities(text);
  text = text.replace(/\u0000(\d+)\u0000/g, (_, i) => formulas[Number(i)]);
  text = text.replace(/[ \t]+\n/g, '\n');
  text = text.replace(/\n{3,}/g, '\n\n');

  return text.trim();
}

// Plain text wants an ordinary space where the page had a non-breaking one.
function decodeEntities(str) {
  return decodeHtmlEntities(str).replace(/ /g, ' ');
}
