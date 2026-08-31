import { createParser } from '../parser/index.js';

/**
 * Deterministic Markdown -> LaTeX conversion.
 *
 * Works on the markdown-it token stream rather than on the raw text, so math,
 * code and verbatim spans are never damaged by the escaping pass — a problem
 * that regex-based converters cannot avoid.
 *
 * Produces a document *body*; the surrounding preamble comes from the selected
 * PDF template (see templates.js).
 */

const LATEX_ESCAPES = {
  '\\': '\\textbackslash{}',
  '{': '\\{',
  '}': '\\}',
  '$': '\\$',
  '&': '\\&',
  '#': '\\#',
  '^': '\\textasciicircum{}',
  '_': '\\_',
  '~': '\\textasciitilde{}',
  '%': '\\%',
};

/** Escape a plain-text run for LaTeX. Never applied to math or verbatim. */
export function escapeLatexText(str) {
  return String(str).replace(/[\\{}$&#^_~%]/g, ch => LATEX_ESCAPES[ch]);
}

/** Escape for \texttt{} — same rules, but keep spaces from collapsing. */
function escapeInlineCode(str) {
  return escapeLatexText(str).replace(/ /g, '\\ ');
}

const SECTION_COMMANDS = [
  'section', 'subsection', 'subsubsection', 'paragraph', 'subparagraph', 'subparagraph',
];

/**
 * Convert Markdown source to a LaTeX document body.
 *
 * @param {string} source
 * @param {object} options
 * @param {boolean} options.demoteHeadings   treat `#` as the document title (default true)
 * @param {(src: string) => string} options.resolveImage  map a Markdown image src to a
 *        path usable from the build directory; return null to drop the image
 * @returns {{ body, title, warnings, stats }}
 */
export function markdownToLatexBody(source, options = {}) {
  const {
    demoteHeadings = true,
    resolveImage = (src) => src,
  } = options;

  const md = createParser();
  const env = {};
  const tokens = md.parse(source, env);

  const warnings = [];
  const stats = { headings: 0, mathInline: 0, mathBlock: 0, codeBlocks: 0, tables: 0, images: 0, links: 0 };

  // A leading level-1 heading becomes the document title rather than a section.
  let title = null;
  let startIndex = 0;
  if (demoteHeadings) {
    const first = tokens.findIndex(t => t.type !== 'front_matter');
    if (first >= 0 && tokens[first]?.type === 'heading_open' && tokens[first].tag === 'h1') {
      title = plainText(tokens[first + 1]);
      startIndex = first + 3;
    }
  }

  // Heading depth offset: with the title extracted, `##` should be \section.
  const headingOffset = title !== null ? -1 : 0;

  // markdown-it-footnote only moves definition tokens into env.footnotes.list
  // during render(); after parse() alone they are still in the main token
  // stream as footnote_open ... footnote_close blocks, keyed by meta.id.
  // Collect them from there and render each definition once, inline.
  const footnoteBodies = [];

  function ctxFor() {
    return { warnings, stats, resolveImage, headingOffset, footnoteBodies };
  }

  footnoteBodies.push(...collectFootnotes(tokens, ctxFor));

  const body = renderTokens(tokens.slice(startIndex), ctxFor()).replace(/\n{3,}/g, '\n\n').trim();

  return { body, title, warnings, stats };
}

/**
 * Extract footnote definition bodies from the parsed token stream.
 * Returns an array indexed by the id that footnote_ref tokens carry.
 */
function collectFootnotes(tokens, ctxFor) {
  const bodies = [];

  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== 'footnote_open') continue;

    const id = tokens[i].meta?.id ?? bodies.length;
    const inner = [];
    let depth = 1;

    for (let j = i + 1; j < tokens.length; j++) {
      if (tokens[j].type === 'footnote_open') depth++;
      if (tokens[j].type === 'footnote_close') {
        depth--;
        if (depth === 0) { i = j; break; }
      }
      // The back-link anchor is a rendering artefact with no LaTeX equivalent.
      if (tokens[j].type !== 'footnote_anchor') inner.push(tokens[j]);
    }

    bodies[id] = renderTokens(inner, ctxFor()).replace(/\s+/g, ' ').trim();
  }

  return bodies;
}

// ── Token rendering ──────────────────────────────────────────────────────────

function renderTokens(tokens, ctx) {
  let out = '';
  const listStack = [];

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];

    switch (t.type) {
      case 'heading_open': {
        const level = parseInt(t.tag.slice(1), 10) + ctx.headingOffset;
        const cmd = SECTION_COMMANDS[Math.max(0, Math.min(level - 1, SECTION_COMMANDS.length - 1))];
        const inline = tokens[i + 1];
        out += `\n\\${cmd}{${renderInline(inline?.children || [], ctx)}}\n`;
        ctx.stats.headings++;
        i += 2; // skip inline + heading_close
        break;
      }

      case 'paragraph_open': {
        const inline = tokens[i + 1];
        const text = renderInline(inline?.children || [], ctx).trim();
        if (text) out += `\n${text}\n`;
        i += 2;
        break;
      }

      case 'inline':
        out += renderInline(t.children || [], ctx);
        break;

      case 'math_block': {
        ctx.stats.mathBlock++;
        const latex = t.content.trim();
        // `$$ ... $$ (1)` style equation numbers arrive as math_block_eqno.
        out += `\n\\[\n${latex}\n\\]\n`;
        break;
      }

      case 'math_block_eqno': {
        ctx.stats.mathBlock++;
        const latex = t.content.trim();
        out += `\n\\begin{equation}\n${latex}\n\\end{equation}\n`;
        break;
      }

      case 'fence':
      case 'code_block': {
        ctx.stats.codeBlocks++;
        out += renderCodeBlock(t, ctx);
        break;
      }

      case 'bullet_list_open':
        listStack.push('itemize');
        out += '\n\\begin{itemize}\n';
        break;
      case 'bullet_list_close':
        listStack.pop();
        out += '\\end{itemize}\n';
        break;

      case 'ordered_list_open': {
        listStack.push('enumerate');
        const start = t.attrGet?.('start');
        out += '\n\\begin{enumerate}\n';
        if (start && Number(start) !== 1) {
          out += `\\setcounter{enumi}{${Number(start) - 1}}\n`;
        }
        break;
      }
      case 'ordered_list_close':
        listStack.pop();
        out += '\\end{enumerate}\n';
        break;

      case 'list_item_open':
        out += '\\item ';
        break;
      case 'list_item_close':
        if (!out.endsWith('\n')) out += '\n';
        break;

      case 'blockquote_open':
        out += '\n\\begin{quote}\n';
        break;
      case 'blockquote_close':
        out += '\\end{quote}\n';
        break;

      case 'hr':
        out += '\n\\par\\noindent\\rule{\\linewidth}{0.4pt}\\par\n';
        break;

      case 'table_open': {
        const { latex, consumed } = renderTable(tokens, i, ctx);
        out += latex;
        ctx.stats.tables++;
        i = consumed;
        break;
      }

      case 'footnote_block_open': {
        // Definitions were already inlined at their reference sites.
        while (i < tokens.length && tokens[i].type !== 'footnote_block_close') i++;
        break;
      }

      case 'html_block':
        ctx.warnings.push('Raw HTML block was dropped — LaTeX output cannot represent it.');
        break;

      // Structural tokens with no direct LaTeX equivalent.
      case 'heading_close':
      case 'paragraph_close':
      case 'thead_open': case 'thead_close':
      case 'tbody_open': case 'tbody_close':
      case 'tr_open': case 'tr_close':
      case 'th_open': case 'th_close':
      case 'td_open': case 'td_close':
      case 'table_close':
        break;

      default:
        if (t.children) out += renderInline(t.children, ctx);
        break;
    }
  }

  return out;
}

function renderInline(children, ctx) {
  let out = '';

  for (let i = 0; i < children.length; i++) {
    const t = children[i];

    switch (t.type) {
      case 'text':
        out += escapeLatexText(t.content);
        break;

      case 'softbreak':
        out += '\n';
        break;
      case 'hardbreak':
        out += '\\\\\n';
        break;

      case 'math_inline':
        ctx.stats.mathInline++;
        out += `\\(${t.content}\\)`;
        break;

      case 'math_inline_double':
        ctx.stats.mathBlock++;
        out += `\\[${t.content}\\]`;
        break;

      case 'code_inline':
        out += `\\texttt{${escapeInlineCode(t.content)}}`;
        break;

      case 'strong_open': out += '\\textbf{'; break;
      case 'strong_close': out += '}'; break;
      case 'em_open': out += '\\emph{'; break;
      case 'em_close': out += '}'; break;
      case 's_open': out += '\\sout{'; break;
      case 's_close': out += '}'; break;

      case 'link_open': {
        ctx.stats.links++;
        const href = t.attrGet('href') || '';
        out += `\\href{${escapeUrl(href)}}{`;
        break;
      }
      case 'link_close':
        out += '}';
        break;

      case 'image': {
        const src = t.attrGet('src') || '';
        const alt = plainText(t) || (t.attrGet('alt') || '');
        const resolved = ctx.resolveImage(src, alt);
        if (!resolved) {
          ctx.warnings.push(`Image dropped (could not be resolved for LaTeX): ${truncate(src, 60)}`);
          break;
        }
        ctx.stats.images++;
        out += '\n\\begin{figure}[htbp]\n\\centering\n'
          + `\\includegraphics[width=0.85\\linewidth,keepaspectratio]{${resolved}}\n`;
        if (alt) out += `\\caption{${escapeLatexText(alt)}}\n`;
        out += '\\end{figure}\n';
        break;
      }

      case 'footnote_ref': {
        const id = t.meta?.id ?? 0;
        const bodyText = ctx.footnoteBodies[id] ?? '';
        out += `\\footnote{${bodyText}}`;
        break;
      }

      case 'html_inline':
        ctx.warnings.push('Inline HTML was dropped — LaTeX output cannot represent it.');
        break;

      default:
        if (t.children) out += renderInline(t.children, ctx);
        else if (t.content) out += escapeLatexText(t.content);
        break;
    }
  }

  return out;
}

function renderCodeBlock(token, ctx) {
  const lang = (token.info || '').trim().split(/\s+/)[0] || '';
  const code = token.content.replace(/\n$/, '');

  // `listings` cannot contain its own end marker; fall back to verbatim when the
  // code would break out of the environment.
  if (/\\end\{lstlisting\}/.test(code)) {
    return `\n\\begin{verbatim}\n${code}\n\\end{verbatim}\n`;
  }

  const languageOption = LISTINGS_LANGUAGES[lang.toLowerCase()];
  const opts = languageOption ? `[language=${languageOption}]` : '';
  return `\n\\begin{lstlisting}${opts}\n${code}\n\\end{lstlisting}\n`;
}

/**
 * Language names the `listings` package understands. Anything not listed is
 * typeset without keyword highlighting rather than failing the build.
 */
export const LISTINGS_LANGUAGES = {
  // Shipped with the listings package.
  python: 'Python', py: 'Python',
  java: 'Java',
  c: 'C', h: 'C',
  'c++': 'C++', cpp: 'C++', cxx: 'C++', cc: 'C++', hpp: 'C++',
  csharp: '[Sharp]C', cs: '[Sharp]C',
  bash: 'bash', sh: 'sh', shell: 'bash', zsh: 'bash', console: 'bash',
  sql: 'SQL',
  r: 'R',
  matlab: 'Matlab', octave: 'Octave',
  latex: '[LaTeX]TeX', tex: '[LaTeX]TeX',
  html: 'HTML', xml: 'XML', xslt: 'XSLT',
  ruby: 'Ruby', rb: 'Ruby',
  php: 'PHP',
  haskell: 'Haskell', hs: 'Haskell',
  fortran: 'Fortran', f90: 'Fortran',
  lua: '[5.0]Lua',
  perl: 'Perl', pl: 'Perl',
  erlang: 'erlang',
  lisp: 'Lisp', scheme: 'Lisp',
  prolog: 'Prolog',
  verilog: 'Verilog', vhdl: 'VHDL',
  make: 'make', makefile: 'make',
  gnuplot: 'Gnuplot',
  ada: 'Ada', pascal: 'Pascal', cobol: 'Cobol',
  postscript: 'PostScript',
  llvm: 'LLVM',
  tcl: 'tcl',
  awk: 'Awk',

  // Defined by MDTeX in the template preamble (see templates.js).
  javascript: 'JavaScript', js: 'JavaScript', jsx: 'JavaScript', mjs: 'JavaScript',
  typescript: 'TypeScript', ts: 'TypeScript', tsx: 'TypeScript',
  rust: 'Rust', rs: 'Rust',
  go: 'Go', golang: 'Go',
  kotlin: 'Kotlin', kt: 'Kotlin',
  swift: 'Swift',
  json: 'JSON',
  yaml: 'YAML', yml: 'YAML',
};

function renderTable(tokens, startIndex, ctx) {
  let i = startIndex;
  const rows = [];
  let alignments = [];
  let inHeader = false;
  let headerRowCount = 0;

  while (i < tokens.length && tokens[i].type !== 'table_close') {
    const t = tokens[i];

    if (t.type === 'thead_open') inHeader = true;
    if (t.type === 'thead_close') inHeader = false;

    if (t.type === 'tr_open') {
      const cells = [];
      let j = i + 1;
      while (j < tokens.length && tokens[j].type !== 'tr_close') {
        if (tokens[j].type === 'th_open' || tokens[j].type === 'td_open') {
          const style = tokens[j].attrGet?.('style') || '';
          if (inHeader) {
            if (/text-align:\s*center/.test(style)) alignments.push('c');
            else if (/text-align:\s*right/.test(style)) alignments.push('r');
            else alignments.push('l');
          }
          const inline = tokens[j + 1];
          const content = inline?.type === 'inline'
            ? renderInline(inline.children || [], ctx).trim()
            : '';
          cells.push(inHeader ? `\\textbf{${content}}` : content);
        }
        j++;
      }
      rows.push({ cells, header: inHeader });
      if (inHeader) headerRowCount++;
      i = j;
    }
    i++;
  }

  const columns = Math.max(...rows.map(r => r.cells.length), 1);
  while (alignments.length < columns) alignments.push('l');
  alignments = alignments.slice(0, columns);

  let latex = '\n\\begin{table}[htbp]\n\\centering\n';
  latex += `\\begin{tabular}{${alignments.join('')}}\n\\hline\n`;

  rows.forEach((row, idx) => {
    const padded = [...row.cells];
    while (padded.length < columns) padded.push('');
    latex += padded.join(' & ') + ' \\\\\n';
    if (idx === headerRowCount - 1) latex += '\\hline\n';
  });

  latex += '\\hline\n\\end{tabular}\n\\end{table}\n';

  return { latex, consumed: i };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function plainText(token) {
  if (!token) return '';
  if (token.type === 'text') return token.content;
  if (token.children) return token.children.map(plainText).join('');
  return token.content || '';
}

function escapeUrl(url) {
  // hyperref handles most characters; % and # must still be escaped.
  return String(url).replace(/([%#])/g, '\\$1');
}

function truncate(str, n) {
  return str.length > n ? str.slice(0, n) + '…' : str;
}
