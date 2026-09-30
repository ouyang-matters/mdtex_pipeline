// One decoder for the HTML entities our own renderers emit.
//
// KaTeX escapes an apostrophe as `&#x27;`, markdown-it as `&#39;`, other paths as
// `&apos;`. Three hand-written decoders each knew one spelling, so `\gamma'(t)`
// reached MathJax as `\gamma&#x27;(t)` and rendered as a "Misplaced &" error box.
// Decoding numeric references generically makes the spelling irrelevant, and a
// single pass means `&amp;lt;` becomes `&lt;` rather than `<`.

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeHtmlEntities(value) {
  return String(value).replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, ref) => {
    if (ref[0] === '#') {
      const code = ref[1] === 'x' || ref[1] === 'X'
        ? parseInt(ref.slice(2), 16)
        : parseInt(ref.slice(1), 10);
      return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    const named = NAMED[ref.toLowerCase()];
    return named === undefined ? whole : named;
  });
}
