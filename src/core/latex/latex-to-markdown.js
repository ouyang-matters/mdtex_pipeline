import { LISTINGS_LANGUAGES } from './markdown-to-latex.js';

/**
 * Deterministic LaTeX -> Markdown conversion — the inverse of
 * `markdownToLatexBody`, and only that. This does not attempt to read
 * arbitrary hand-written LaTeX: `\label`, `\newcommand`, custom environments,
 * TikZ and bibliographies have no Markdown spelling, and a converter that
 * tried to guess one for them would corrupt a document quietly.
 *
 * What it does instead is invert the *closed* grammar `markdownToLatexBody`
 * itself emits — sections, emphasis, links, images, tables, code, math,
 * lists, footnotes, quotes, a rule. Anything outside that grammar is left in
 * the output verbatim and reported in `warnings`, never dropped and never
 * guessed at, so a caller can show the user exactly what would not come back
 * as Markdown before committing to the conversion.
 */

const HEADING_LEVELS = { section: 1, subsection: 2, subsubsection: 3, paragraph: 4, subparagraph: 5 };

const REVERSE_LISTINGS = (() => {
  const canonical = {
    Python: 'python', Java: 'java', C: 'c', 'C++': 'cpp', '[Sharp]C': 'csharp',
    bash: 'bash', sh: 'sh', SQL: 'sql', R: 'r', Matlab: 'matlab', Octave: 'octave',
    '[LaTeX]TeX': 'latex', HTML: 'html', XML: 'xml', XSLT: 'xslt', Ruby: 'ruby',
    PHP: 'php', Haskell: 'haskell', Fortran: 'fortran', '[5.0]Lua': 'lua',
    Perl: 'perl', erlang: 'erlang', Lisp: 'lisp', Prolog: 'prolog',
    Verilog: 'verilog', VHDL: 'vhdl', make: 'make', Gnuplot: 'gnuplot',
    Ada: 'ada', Pascal: 'pascal', Cobol: 'cobol', PostScript: 'postscript',
    LLVM: 'llvm', tcl: 'tcl', Awk: 'awk', JavaScript: 'javascript',
    TypeScript: 'typescript', Rust: 'rust', Go: 'go', Kotlin: 'kotlin',
    Swift: 'swift', JSON: 'json', YAML: 'yaml',
  };
  const known = new Set(Object.values(LISTINGS_LANGUAGES));
  for (const value of known) {
    if (!(value in canonical)) canonical[value] = value.replace(/^\[[^\]]*\]/, '').toLowerCase();
  }
  return canonical;
})();

/**
 * Convert a LaTeX document (as saved to `main.tex`) to a Markdown body.
 *
 * @param {string} tex
 * @returns {{ markdown, title, warnings, stats }}
 */
export function latexToMarkdownBody(tex) {
  const warnings = [];
  const unsupported = new Set();
  const stats = { headings: 0, mathInline: 0, mathBlock: 0, codeBlocks: 0, tables: 0, images: 0, links: 0 };
  const ctx = { warnings, unsupported, stats };

  const title = extractTitle(tex);

  let body = tex;
  const beginIdx = tex.indexOf('\\begin{document}');
  const endIdx = tex.lastIndexOf('\\end{document}');
  if (beginIdx !== -1 && endIdx !== -1 && endIdx > beginIdx) {
    body = tex.slice(beginIdx + '\\begin{document}'.length, endIdx);
  } else {
    warnings.push('No \\begin{document} … \\end{document} found; treating the whole input as the body.');
  }
  body = body.replace(/\\maketitle/g, '');

  let markdown = parseBlocks(body, ctx, Boolean(title)).trim();
  if (title) markdown = `# ${title}\n\n${markdown}`;

  if (unsupported.size) {
    warnings.push(`LaTeX with no Markdown spelling was left as-is: ${[...unsupported].sort().join(', ')}`);
  }

  return { markdown, title, warnings, stats };
}

function extractTitle(tex) {
  const idx = tex.indexOf('\\title{');
  if (idx === -1) return null;
  const g = readGroup(tex, idx + '\\title'.length);
  const text = unescapeLatexEscapes(g.content).trim();
  return text || null;
}

// ── Balanced-brace / bracket reading ────────────────────────────────────────

/** str[i] must be '{'. Returns the matched content and the index after '}'. */
function readGroup(str, i) {
  if (str[i] !== '{') return { content: '', end: i };
  let depth = 0;
  const start = i + 1;
  for (let j = i; j < str.length; j++) {
    const c = str[j];
    if (c === '\\') { j++; continue; }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return { content: str.slice(start, j), end: j + 1 };
    }
  }
  return { content: str.slice(start), end: str.length };
}

/** str[i] must be '['. Returns the matched content and the index after ']'. */
function readBracket(str, i) {
  if (str[i] !== '[') return null;
  let depth = 0;
  const start = i + 1;
  for (let j = i; j < str.length; j++) {
    const c = str[j];
    if (c === '\\') { j++; continue; }
    if (c === '[') depth++;
    else if (c === ']') {
      depth--;
      if (depth === 0) return { content: str.slice(start, j), end: j + 1 };
    }
  }
  return null;
}

/**
 * The matching `\end{name}` for a `\begin{name}[...]` at `beginIdx`, treating
 * any nested `\begin{...}` / `\end{...}` pair as balanced brackets. Correct
 * for lists, quotes, figures and tables, which can legitimately nest other
 * environments; code and math environments are matched separately, by literal
 * search, because their content is not LaTeX and must not be parsed as such.
 */
function findEnvEnd(text, beginIdx) {
  const m = /^\\begin\{([a-zA-Z*]+)\}(?:\[[^\]]*\])?/.exec(text.slice(beginIdx));
  const name = m[1];
  let depth = 1;
  const re = /\\begin\{[a-zA-Z*]+\}|\\end\{[a-zA-Z*]+\}/g;
  re.lastIndex = beginIdx + m[0].length;
  let match;
  while ((match = re.exec(text))) {
    if (match[0].startsWith('\\begin')) depth++;
    else {
      depth--;
      if (depth === 0) {
        return {
          name,
          contentStart: beginIdx + m[0].length,
          contentEnd: match.index,
          end: match.index + match[0].length,
        };
      }
    }
  }
  return { name, contentStart: beginIdx + m[0].length, contentEnd: text.length, end: text.length };
}

// ── Escapes ──────────────────────────────────────────────────────────────────

/** Reverse of LATEX_ESCAPES in markdown-to-latex.js. No command handling. */
function unescapeLatexEscapes(str) {
  let out = '';
  let i = 0;
  while (i < str.length) {
    if (str[i] === '\\') {
      if (str.startsWith('\\textbackslash{}', i)) { out += '\\'; i += 16; continue; }
      if (str.startsWith('\\textasciicircum{}', i)) { out += '^'; i += 18; continue; }
      if (str.startsWith('\\textasciitilde{}', i)) { out += '~'; i += 17; continue; }
      const next = str[i + 1];
      if (next && '{}$&#_%'.includes(next)) { out += next; i += 2; continue; }
    }
    out += str[i];
    i += 1;
  }
  return out;
}

/** Reverse of escapeInlineCode: undo the space-escape, then the general escapes. */
function unescapeInlineCode(str) {
  return unescapeLatexEscapes(str.replace(/\\ /g, ' '));
}

/** hyperref escaping reverses to plain %, # — the only two escapeUrl touches. */
function unescapeUrl(str) {
  return str.replace(/\\([%#])/g, '$1');
}

// ── Inline conversion ────────────────────────────────────────────────────────

/** Protects `\( … \)` and `\[ … \]` spans, then walks the rest for commands and escapes. */
function convertInline(str, ctx) {
  const placeholders = [];
  let protectedStr = '';
  let i = 0;
  while (i < str.length) {
    if (str.startsWith('\\(', i)) {
      const close = str.indexOf('\\)', i + 2);
      const end = close === -1 ? str.length : close + 2;
      const inner = str.slice(i + 2, close === -1 ? str.length : close);
      ctx.stats.mathInline++;
      protectedStr += placeholderFor(placeholders, `$${inner}$`);
      i = end;
      continue;
    }
    if (str.startsWith('\\[', i)) {
      const close = str.indexOf('\\]', i + 2);
      const end = close === -1 ? str.length : close + 2;
      const inner = str.slice(i + 2, close === -1 ? str.length : close);
      ctx.stats.mathBlock++;
      protectedStr += placeholderFor(placeholders, `$$${inner}$$`);
      i = end;
      continue;
    }
    protectedStr += str[i];
    i += 1;
  }

  let out = convertCommands(protectedStr, ctx);
  for (let k = 0; k < placeholders.length; k++) {
    out = out.replace(`@MATH${k}@`, placeholders[k]);
  }
  return out;
}

function placeholderFor(placeholders, value) {
  const token = `@MATH${placeholders.length}@`;
  placeholders.push(value);
  return token;
}

const WRAPPERS = { textbf: '**', emph: '*', sout: '~~' };

function convertCommands(str, ctx) {
  let out = '';
  let i = 0;
  while (i < str.length) {
    const c = str[i];
    if (c !== '\\') { out += c; i += 1; continue; }

    // `\\` — a hard line break, emitted as "\\\\\n" by the forward converter.
    if (str[i + 1] === '\\') {
      out += '  \n';
      i += 2;
      if (str[i] === '\n') i += 1;
      continue;
    }

    const m = /^\\([a-zA-Z]+)(\*?)/.exec(str.slice(i));
    if (m) {
      const name = m[1];
      const j = i + m[0].length;

      if (WRAPPERS[name] && str[j] === '{') {
        const g = readGroup(str, j);
        const wrap = WRAPPERS[name];
        out += `${wrap}${convertCommands(g.content, ctx)}${wrap}`;
        i = g.end;
        continue;
      }
      if (name === 'texttt' && str[j] === '{') {
        const g = readGroup(str, j);
        out += '`' + unescapeInlineCode(g.content) + '`';
        i = g.end;
        continue;
      }
      if (name === 'href' && str[j] === '{') {
        const g1 = readGroup(str, j);
        if (str[g1.end] === '{') {
          const g2 = readGroup(str, g1.end);
          ctx.stats.links++;
          out += `[${convertCommands(g2.content, ctx)}](${unescapeUrl(g1.content)})`;
          i = g2.end;
          continue;
        }
      }
      if (name === 'footnote' && str[j] === '{') {
        const g = readGroup(str, j);
        out += `^[${convertCommands(g.content, ctx)}]`;
        i = g.end;
        continue;
      }
      if (name === 'textbackslash' || name === 'textasciicircum' || name === 'textasciitilde') {
        out += name === 'textbackslash' ? '\\' : name === 'textasciicircum' ? '^' : '~';
        i = j;
        if (str[i] === '{' && str[i + 1] === '}') i += 2;
        continue;
      }

      // Unknown command: kept verbatim, along with one following group if any,
      // and reported rather than silently absorbed into the text around it.
      ctx.unsupported.add(`\\${name}${m[2] || ''}`);
      out += `\\${name}${m[2] || ''}`;
      i = j;
      if (str[i] === '{') {
        const g = readGroup(str, i);
        out += str.slice(i, g.end);
        i = g.end;
      }
      continue;
    }

    const next = str[i + 1];
    if (next && '{}$&#_%'.includes(next)) { out += next; i += 2; continue; }
    out += c;
    i += 1;
  }
  return out;
}

// ── Block conversion ─────────────────────────────────────────────────────────

const BLOCK_STARTERS = [
  '\\begin{itemize}', '\\begin{enumerate}', '\\begin{quote}', '\\begin{figure}',
  '\\begin{table}', '\\begin{lstlisting}', '\\begin{verbatim}', '\\begin{equation}', '\\[',
];

function startsBlock(str) {
  if (BLOCK_STARTERS.some(s => str.startsWith(s))) return true;
  if (/^\\(sub)*section\{|^\\subparagraph\{|^\\paragraph\{/.test(str)) return true;
  if (/^\\par\\noindent\\rule\{\\linewidth\}\{[\d.]+pt\}\\par/.test(str)) return true;
  return false;
}

function parseBlocks(text, ctx, titled) {
  const parts = [];
  const n = text.length;
  let i = 0;

  const skipBlank = () => {
    while (i < n) {
      let j = i;
      while (j < n && (text[j] === ' ' || text[j] === '\t')) j++;
      if (text[j] === '\n') { i = j + 1; continue; }
      i = j;
      break;
    }
  };

  while (i < n) {
    skipBlank();
    if (i >= n) break;
    const rest = text.slice(i);

    if (rest.startsWith('\\begin{itemize}')) {
      const r = parseList(text, i, ctx, titled);
      parts.push(r.markdown); i = r.end; continue;
    }
    if (rest.startsWith('\\begin{enumerate}')) {
      const r = parseList(text, i, ctx, titled);
      parts.push(r.markdown); i = r.end; continue;
    }
    if (rest.startsWith('\\begin{quote}')) {
      const r = parseQuote(text, i, ctx, titled);
      parts.push(r.markdown); i = r.end; continue;
    }
    if (rest.startsWith('\\begin{figure}')) {
      const r = parseFigure(text, i, ctx);
      parts.push(r.markdown); i = r.end; continue;
    }
    if (rest.startsWith('\\begin{table}')) {
      const r = parseTable(text, i, ctx);
      parts.push(r.markdown); i = r.end; continue;
    }
    if (rest.startsWith('\\begin{lstlisting}') || rest.startsWith('\\begin{verbatim}')) {
      const r = parseCode(text, i, ctx);
      parts.push(r.markdown); i = r.end; continue;
    }
    if (rest.startsWith('\\begin{equation}')) {
      const r = parseEquation(text, i, ctx);
      parts.push(r.markdown); i = r.end; continue;
    }
    if (rest.startsWith('\\[')) {
      const close = text.indexOf('\\]', i + 2);
      const end = close === -1 ? n : close + 2;
      ctx.stats.mathBlock++;
      parts.push(`$$${text.slice(i + 2, close === -1 ? n : close).trim()}$$`);
      i = end; continue;
    }

    const heading = /^\\(section|subsection|subsubsection|subparagraph|paragraph)\{/.exec(rest);
    if (heading) {
      const cmd = heading[1];
      const braceIdx = i + heading[0].length - 1;
      const g = readGroup(text, braceIdx);
      const level = Math.min(HEADING_LEVELS[cmd] + (titled ? 1 : 0), 6);
      ctx.stats.headings++;
      parts.push(`${'#'.repeat(level)} ${convertInline(g.content, ctx).trim()}`);
      i = g.end; continue;
    }

    const hr = /^\\par\\noindent\\rule\{\\linewidth\}\{[\d.]+pt\}\\par/.exec(rest);
    if (hr) { parts.push('---'); i += hr[0].length; continue; }

    let j = i;
    while (j < n) {
      if (text[j] === '\n' && text[j + 1] === '\n') break;
      if (text[j] === '\n' && startsBlock(text.slice(j + 1))) break;
      j++;
    }
    const raw = text.slice(i, j).trim();
    if (raw) parts.push(convertInline(raw, ctx).trim());
    i = j;
  }

  return parts.filter(Boolean).join('\n\n');
}

function parseList(text, beginIdx, ctx, titled) {
  const env = findEnvEnd(text, beginIdx);
  const ordered = env.name === 'enumerate';
  let content = text.slice(env.contentStart, env.contentEnd);

  let start = 1;
  const counter = /^\s*\\setcounter\{enumi\}\{(\d+)\}/.exec(content);
  if (counter) {
    start = Number(counter[1]) + 1;
    content = content.slice(counter[0].length);
  }

  // Split into top-level `\item` entries — top-level meaning not inside a
  // nested environment, so a nested list stays part of its parent item.
  const itemStarts = [];
  let depth = 0;
  const re = /\\begin\{[a-zA-Z*]+\}|\\end\{[a-zA-Z*]+\}|\\item\b/g;
  let match;
  while ((match = re.exec(content))) {
    if (match[0].startsWith('\\begin')) depth++;
    else if (match[0].startsWith('\\end')) depth--;
    else if (depth === 0) itemStarts.push(match.index + match[0].length);
  }

  const lines = [];
  itemStarts.forEach((s, idx) => {
    const e = idx + 1 < itemStarts.length
      ? content.lastIndexOf('\\item', itemStarts[idx + 1])
      : content.length;
    const raw = content.slice(s, e).trim();
    const body = parseBlocks(raw, ctx, titled);
    const [first, ...rest] = body.split('\n\n');
    const marker = ordered ? `${start + idx}. ` : '- ';
    const indent = ' '.repeat(marker.length);
    let line = marker + (first || '').replace(/\n/g, `\n${indent}`);
    if (rest.length) {
      line += '\n\n' + rest.map(b => indent + b.replace(/\n/g, `\n${indent}`)).join('\n\n');
    }
    lines.push(line);
  });

  return { markdown: lines.join('\n'), end: env.end };
}

function parseQuote(text, beginIdx, ctx, titled) {
  const env = findEnvEnd(text, beginIdx);
  const inner = parseBlocks(text.slice(env.contentStart, env.contentEnd), ctx, titled);
  const markdown = inner.split('\n').map(l => (l ? `> ${l}` : '>')).join('\n');
  return { markdown, end: env.end };
}

function parseFigure(text, beginIdx, ctx) {
  const env = findEnvEnd(text, beginIdx);
  const content = text.slice(env.contentStart, env.contentEnd);

  const gIdx = content.indexOf('\\includegraphics');
  let path = '';
  if (gIdx !== -1) {
    let k = gIdx + '\\includegraphics'.length;
    if (content[k] === '[') { const b = readBracket(content, k); if (b) k = b.end; }
    if (content[k] === '{') { const g = readGroup(content, k); path = g.content; }
  }

  let caption = '';
  const cIdx = content.indexOf('\\caption{');
  if (cIdx !== -1) {
    const g = readGroup(content, cIdx + '\\caption'.length);
    caption = unescapeLatexEscapes(g.content);
  }

  ctx.stats.images++;
  return { markdown: `![${caption}](${path})`, end: env.end };
}

function parseTable(text, beginIdx, ctx) {
  const env = findEnvEnd(text, beginIdx);
  const content = text.slice(env.contentStart, env.contentEnd);

  const tIdx = content.indexOf('\\begin{tabular}');
  if (tIdx === -1) {
    ctx.unsupported.add('table without tabular');
    return { markdown: '', end: env.end };
  }
  const alignIdx = tIdx + '\\begin{tabular}'.length;
  const alignGroup = readGroup(content, alignIdx);
  const aligns = alignGroup.content.replace(/[^lcr]/g, '').split('');

  const tabEnd = content.indexOf('\\end{tabular}', alignGroup.end);
  const body = content.slice(alignGroup.end, tabEnd === -1 ? content.length : tabEnd);

  const rows = body
    .split('\\\\')
    .map(r => r.trim())
    .filter(r => r && r !== '\\hline')
    .map(r => r.replace(/^\\hline\s*/, '').replace(/\s*\\hline$/, '').trim())
    .filter(Boolean);

  const parsedRows = rows.map(row => row.split(' & ').map(cell => cell.trim()));

  ctx.stats.tables++;
  if (!parsedRows.length) return { markdown: '', end: env.end };

  const columns = Math.max(...parsedRows.map(r => r.length), aligns.length, 1);
  while (aligns.length < columns) aligns.push('l');

  const cellText = (raw) => {
    const wrapped = /^\\textbf\{([\s\S]*)\}$/.exec(raw);
    return convertInline(wrapped ? wrapped[1] : raw, ctx).trim();
  };

  const [headerRow, ...bodyRows] = parsedRows;
  const header = headerRow.map(cellText);
  while (header.length < columns) header.push('');

  const delimiter = aligns.slice(0, columns).map(a => (a === 'c' ? ':---:' : a === 'r' ? '---:' : '---'));

  const lines = [
    `| ${header.join(' | ')} |`,
    `| ${delimiter.join(' | ')} |`,
    ...bodyRows.map((row) => {
      const cells = row.map(cellText);
      while (cells.length < columns) cells.push('');
      return `| ${cells.join(' | ')} |`;
    }),
  ];

  return { markdown: lines.join('\n'), end: env.end };
}

function parseCode(text, beginIdx, ctx) {
  const isVerbatim = text.startsWith('\\begin{verbatim}', beginIdx);
  const envName = isVerbatim ? 'verbatim' : 'lstlisting';
  const endTag = `\\end{${envName}}`;

  const optMatch = /^\\begin\{lstlisting\}(?:\[language=(.+?)\])?\n?/.exec(text.slice(beginIdx));
  const headerLen = isVerbatim
    ? `\\begin{verbatim}`.length
    : optMatch[0].length;
  const contentStart = beginIdx + headerLen;

  const endIdx = text.indexOf(endTag, contentStart);
  const contentEnd = endIdx === -1 ? text.length : endIdx;
  const end = endIdx === -1 ? text.length : endIdx + endTag.length;

  let code = text.slice(contentStart, contentEnd);
  code = code.replace(/^\n/, '').replace(/\n$/, '');

  const lang = !isVerbatim && optMatch[1] ? REVERSE_LISTINGS[optMatch[1]] || '' : '';

  ctx.stats.codeBlocks++;
  return { markdown: `\`\`\`${lang}\n${code}\n\`\`\``, end };
}

function parseEquation(text, beginIdx, ctx) {
  const endTag = '\\end{equation}';
  const contentStart = beginIdx + '\\begin{equation}'.length;
  const endIdx = text.indexOf(endTag, contentStart);
  const contentEnd = endIdx === -1 ? text.length : endIdx;
  const end = endIdx === -1 ? text.length : endIdx + endTag.length;

  ctx.stats.mathBlock++;
  ctx.warnings.push('An \\begin{equation} block became $$ … $$ — the equation-number marker is not something Markdown can express.');
  return { markdown: `$$${text.slice(contentStart, contentEnd).trim()}$$`, end };
}
