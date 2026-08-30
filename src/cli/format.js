/**
 * Terminal formatting.
 *
 * Colour and box drawing are decoration, and decoration that survives being
 * piped into a file is corruption. Everything here degrades: no colour when
 * the stream is not a terminal, when NO_COLOR is set, or when TERM says dumb —
 * and the plain form is still aligned and readable, because that is the form
 * that ends up in bug reports.
 */

const stream = process.stdout;

export const colourEnabled = Boolean(
  stream.isTTY
  && !process.env.NO_COLOR
  && process.env.TERM !== 'dumb'
  && !process.env.CI,
);

const CODES = {
  reset: 0,
  bold: 1,
  dim: 2,
  red: 31,
  green: 32,
  yellow: 33,
  blue: 34,
  cyan: 36,
  grey: 90,
};

function wrap(name) {
  return (text) => (colourEnabled ? `\x1b[${CODES[name]}m${text}\x1b[0m` : String(text));
}

export const bold = wrap('bold');
export const dim = wrap('dim');
export const red = wrap('red');
export const green = wrap('green');
export const yellow = wrap('yellow');
export const blue = wrap('blue');
export const cyan = wrap('cyan');
export const grey = wrap('grey');

/** Printable width, ignoring escape sequences and counting CJK as two columns. */
export function width(text) {
  const plain = String(text).replace(/\x1b\[[0-9;]*m/g, '');
  let n = 0;
  for (const ch of plain) {
    const code = ch.codePointAt(0);
    // The ranges a terminal renders double-width. Getting this wrong is what
    // makes a box with Chinese in it come out ragged.
    n += (code >= 0x1100 && (
      code <= 0x115f
      || (code >= 0x2e80 && code <= 0xa4cf)
      || (code >= 0xac00 && code <= 0xd7a3)
      || (code >= 0xf900 && code <= 0xfaff)
      || (code >= 0xfe30 && code <= 0xfe6f)
      || (code >= 0xff00 && code <= 0xff60)
      || (code >= 0xffe0 && code <= 0xffe6)
      || (code >= 0x20000 && code <= 0x3fffd)
    )) ? 2 : 1;
  }
  return n;
}

export function pad(text, target) {
  return String(text) + ' '.repeat(Math.max(0, target - width(text)));
}

/**
 * A framed block. `lines` may contain colour; the frame is measured on the
 * printable width so colour never shifts the right-hand edge.
 */
export function box(lines, { colour = cyan } = {}) {
  const inner = Math.max(...lines.map(width), 0) + 2;
  const top = colour(`┌${'─'.repeat(inner)}┐`);
  const bottom = colour(`└${'─'.repeat(inner)}┘`);
  const side = colour('│');
  const body = lines.map(line => `${side} ${pad(line, inner - 2)} ${side}`);
  return [top, ...body, bottom].join('\n');
}

/** A two-column list, aligned on the printable width of the labels. */
export function rows(pairs, { indent = '  ', gap = 2 } = {}) {
  const labelWidth = Math.max(...pairs.map(([label]) => width(label)), 0);
  return pairs
    .map(([label, value]) => `${indent}${grey(pad(label, labelWidth))}${' '.repeat(gap)}${value}`)
    .join('\n');
}

export const TICK = colourEnabled ? '✓' : 'ok';
export const CROSS = colourEnabled ? '✗' : 'x';
export const ARROW = colourEnabled ? '→' : '->';
