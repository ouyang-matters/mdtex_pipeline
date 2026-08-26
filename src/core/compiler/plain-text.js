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
  text = text.replace(
    /<(section|span|img)\b[^>]*data-latex="([^"]*)"[^>]*data-display="true"[^>]*>[\s\S]*?(?:<\/\1>|$)/gi,
    (_, _tag, latex) => `\n$$${decodeEntities(latex)}$$\n`,
  );
  text = text.replace(
    /<(section|span)\b[^>]*data-latex="([^"]*)"[^>]*>[\s\S]*?<\/\1>/gi,
    (_, _tag, latex) => `$${decodeEntities(latex)}$`,
  );
  text = text.replace(
    /<img\b[^>]*data-latex="([^"]*)"[^>]*\/?>/gi,
    (_, latex) => `$${decodeEntities(latex)}$`,
  );

  text = text.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/(p|div|section|li|tr|h[1-6]|pre|blockquote)>/gi, '\n');
  text = text.replace(/<li\b[^>]*>/gi, '- ');
  text = text.replace(/<t[dh]\b[^>]*>/gi, '\t');
  text = text.replace(/<[^>]+>/g, '');

  text = decodeEntities(text);
  text = text.replace(/[ \t]+\n/g, '\n');
  text = text.replace(/\n{3,}/g, '\n\n');

  return text.trim();
}

function decodeEntities(str) {
  return String(str)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}
