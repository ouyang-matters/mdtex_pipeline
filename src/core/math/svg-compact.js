/**
 * Lossless compaction of MathJax's self-contained SVG.
 *
 * WeChat keeps only <path> glyphs — no <defs>, no <use> — so every glyph is
 * written out in full at every occurrence. An article with 1,500 formulas used
 * 165 distinct paths repeated 10,000 times: 4.3 MB of a 6.1 MB body, which is
 * enough for WeChat's save-time self-check to drop the upload. The glyphs
 * cannot be shared, so each copy is made as small as it can be without
 * changing a single rendered point:
 *
 *   - path data in relative form, choosing per segment whichever of absolute
 *     or relative is shorter, with repeated command letters omitted;
 *   - a glyph's `translate(x,y)` folded into its path's opening moveto, and
 *     the wrapping <g> dropped;
 *   - <g> elements with no attributes unwrapped.
 *
 * Coordinates are font units (1000 per em). Deltas are rounded to 1/1000 of
 * a unit only to undo floating-point noise; MathJax's own values are integers
 * or short decimals and come back exactly.
 */

const ARG_COUNT = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

export function compactSvg(svg) {
  let out = String(svg);

  // Unwrap and fold until nothing changes: each pass can expose the next
  // (an inner fold leaves the outer translate holding a single path). Folding
  // works on absolute coordinates, so it runs before paths are compacted.
  for (let i = 0; i < 50; i++) {
    const before = out;
    out = unwrapBareGroups(out);
    out = foldTranslates(out);
    if (out === before) break;
  }

  return out.replace(/(<path\b[^>]*?\sd=")([^"]*)(")/g, (_, a, d, b) => a + compactPath(d) + b);
}

/** `<g>…</g>` with no attributes and no nested <g> → its contents. */
function unwrapBareGroups(svg) {
  return svg.replace(/<g>((?:(?!<g[\s>]|<\/g>)[\s\S])*)<\/g>/g, '$1');
}

/** `<g transform="translate(x,y)"><path d="M…"/></g>` → `<path d="M(x+…)(y+…)…"/>`. */
function foldTranslates(svg) {
  return svg.replace(
    /<g transform="translate\((-?[\d.]+)(?:[ ,]+(-?[\d.]+))?\)">\s*<path d="([^"]*)"(\s*\/>|><\/path>)\s*<\/g>/g,
    (whole, tx, ty, d, close) => {
      const shifted = shiftPath(d, Number(tx), Number(ty || 0));
      return shifted === null ? whole : `<path d="${shifted}"${close}`;
    },
  );
}

/** Move a path by (dx, dy): every coordinate, in absolute form. Null if unparseable. */
function shiftPath(d, dx, dy) {
  const segs = absolutise(d);
  if (!segs) return null;
  return serialise(segs.map(({ cmd, args }) => {
    if (cmd === 'H') return { cmd, args: [args[0] + dx] };
    if (cmd === 'V') return { cmd, args: [args[0] + dy] };
    return { cmd, args: args.map((v, i) => v + (i % 2 === 0 ? dx : dy)) };
  }));
}

/** The path as one absolute segment per command, or null. */
function absolutise(d) {
  const segs = parsePath(d);
  if (!segs) return null;
  const out = [];
  let cx = 0, cy = 0, sx = 0, sy = 0;
  for (const { cmd, args } of segs) {
    const upper = cmd.toUpperCase();
    const rel = cmd !== upper;
    if (upper === 'Z') { out.push({ cmd: 'Z', args: [] }); cx = sx; cy = sy; continue; }
    if (upper === 'A') return null;
    const n = ARG_COUNT[upper];
    for (let k = 0; k < args.length; k += n) {
      const chunk = args.slice(k, k + n);
      if (chunk.length < n) return null;
      const segCmd = upper === 'M' && k > 0 ? 'L' : upper;
      const abs = toAbsolute(segCmd, chunk, rel, cx, cy);
      out.push({ cmd: segCmd, args: abs });
      [cx, cy] = endPoint(segCmd, abs, cx, cy);
      if (segCmd === 'M') { sx = cx; sy = cy; }
    }
  }
  return out;
}

/** Rewrite path data in its shortest equivalent form, or return it unchanged. */
export function compactPath(d) {
  const segs = parsePath(d);
  if (!segs) return d;

  const out = [];
  let cx = 0, cy = 0, sx = 0, sy = 0;

  for (let i = 0; i < segs.length; i++) {
    const { cmd, args } = segs[i];
    const upper = cmd.toUpperCase();
    const rel = cmd !== upper;
    const n = ARG_COUNT[upper];

    if (upper === 'Z') {
      out.push({ cmd: 'z', args: [] });
      cx = sx; cy = sy;
      continue;
    }
    if (upper === 'A') return d; // arcs never appear in MathJax glyphs; don't guess

    for (let k = 0; k < args.length; k += n) {
      const chunk = args.slice(k, k + n);
      if (chunk.length < n) return d;
      // A moveto's extra pairs are linetos.
      const segCmd = upper === 'M' && k > 0 ? 'L' : upper;

      const abs = toAbsolute(segCmd, chunk, rel, cx, cy);

      // Every equivalent spelling of this segment; the shortest is written.
      const candidates = [{ cmd: segCmd, args: abs }, { cmd: segCmd.toLowerCase(), args: toRelative(segCmd, abs, cx, cy) }];
      if (segCmd === 'L' && near(abs[1], cy)) candidates.push({ cmd: 'H', args: [abs[0]] }, { cmd: 'h', args: [abs[0] - cx] });
      if (segCmd === 'L' && near(abs[0], cx)) candidates.push({ cmd: 'V', args: [abs[1]] }, { cmd: 'v', args: [abs[1] - cy] });

      // The opening moveto stays absolute.
      const pick = out.length === 0 ? candidates[0]
        : candidates.reduce((best, c) => (serialise([c]).length < serialise([best]).length ? c : best));
      out.push(pick);

      [cx, cy] = endPoint(segCmd, abs, cx, cy);
      if (segCmd === 'M') { sx = cx; sy = cy; }
    }
  }
  return serialise(out);
}

function near(a, b) {
  return Math.abs(a - b) < 5e-4;
}

function toAbsolute(cmd, a, rel, cx, cy) {
  if (!rel) return a.slice();
  switch (cmd) {
    case 'H': return [a[0] + cx];
    case 'V': return [a[0] + cy];
    default: return a.map((v, i) => v + (i % 2 === 0 ? cx : cy));
  }
}

function toRelative(cmd, a, cx, cy) {
  switch (cmd) {
    case 'H': return [a[0] - cx];
    case 'V': return [a[0] - cy];
    default: return a.map((v, i) => v - (i % 2 === 0 ? cx : cy));
  }
}

function endPoint(cmd, abs, cx, cy) {
  switch (cmd) {
    case 'H': return [abs[0], cy];
    case 'V': return [cx, abs[0]];
    default: return [abs[abs.length - 2], abs[abs.length - 1]];
  }
}

const TOKEN = /([MLHVCSQTAZmlhvcsqtaz])|(-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)/g;

function parsePath(d) {
  const segs = [];
  let current = null;
  let m;
  TOKEN.lastIndex = 0;
  const rest = d.replace(TOKEN, '').replace(/[\s,]/g, '');
  if (rest) return null; // something we do not understand — leave the path as it is
  while ((m = TOKEN.exec(d)) !== null) {
    if (m[1]) {
      current = { cmd: m[1], args: [] };
      segs.push(current);
    } else {
      if (!current) return null;
      current.args.push(Number(m[2]));
    }
  }
  return segs;
}

function num(v) {
  let s = String(Math.round(v * 1000) / 1000);
  if (s === '-0') s = '0';
  return s.replace(/^(-?)0\./, '$1.');
}

function serialise(segs) {
  let text = '';
  let lastCmd = '';
  for (const { cmd, args } of segs) {
    // A repeated command letter may be omitted — except moveto, whose
    // repetition means lineto.
    const repeat = cmd === lastCmd && cmd.toUpperCase() !== 'M' && args.length > 0;
    if (!repeat) text += cmd;
    args.forEach((v, i) => {
      const s = num(v);
      const needsSep = (i > 0 || repeat) && !s.startsWith('-')
        && !(s.startsWith('.') && /\.\d*$/.test(lastNumber(text)));
      text += (needsSep ? ' ' : '') + s;
    });
    lastCmd = cmd;
  }
  return text;
}

function lastNumber(text) {
  const m = text.match(/-?(?:\d+\.?\d*|\.\d+)$/);
  return m ? m[0] : '';
}
