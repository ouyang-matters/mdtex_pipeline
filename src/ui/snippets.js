/**
 * Language-aware snippet system for Markdown and LaTeX quick-insert.
 *
 * Each snippet defines:
 *   lang: 'markdown' | 'latex' | 'both'
 *   label: display name
 *   category: grouping (e.g. 'Structure', 'Math', 'Text')
 *   template: insertion text with $CURSOR$ marking cursor position
 *             and $SELECTION$ marking where selected text goes
 *   shortcut: optional keyboard shortcut (e.g. 'Ctrl+B')
 */

const STORAGE_KEY_SNIPPETS = 'publisher_user_snippets';

export const BUILTIN_SNIPPETS = [
  // ── Markdown: Structure ──────────────────────────────────────────────────
  { lang: 'markdown', category: 'Structure', label: 'Heading 1',     template: '# $CURSOR$',              shortcut: '' },
  { lang: 'markdown', category: 'Structure', label: 'Heading 2',     template: '## $CURSOR$',             shortcut: '' },
  { lang: 'markdown', category: 'Structure', label: 'Heading 3',     template: '### $CURSOR$',            shortcut: '' },
  { lang: 'markdown', category: 'Structure', label: 'Horizontal Rule', template: '\n---\n$CURSOR$',       shortcut: '' },
  { lang: 'markdown', category: 'Structure', label: 'Blockquote',    template: '> $SELECTION$$CURSOR$',   shortcut: '' },
  { lang: 'markdown', category: 'Structure', label: 'Footnote',      template: '[^$CURSOR$]: ',           shortcut: '' },

  // ── Markdown: Text ───────────────────────────────────────────────────────
  { lang: 'markdown', category: 'Text',      label: 'Bold',          template: '**$SELECTION$$CURSOR$**', shortcut: 'Ctrl+B' },
  { lang: 'markdown', category: 'Text',      label: 'Italic',        template: '*$SELECTION$$CURSOR$*',   shortcut: 'Ctrl+I' },
  { lang: 'markdown', category: 'Text',      label: 'Inline Code',   template: '`$SELECTION$$CURSOR$`',  shortcut: 'Ctrl+`' },
  { lang: 'markdown', category: 'Text',      label: 'Link',          template: '[$SELECTION$]($CURSOR$)', shortcut: 'Ctrl+K' },
  { lang: 'markdown', category: 'Text',      label: 'Image',         template: '![$CURSOR$](url)',        shortcut: '' },

  // ── Markdown: Code & Lists ───────────────────────────────────────────────
  { lang: 'markdown', category: 'Blocks',    label: 'Code Block',    template: '```$CURSOR$\n\n```',      shortcut: '' },
  { lang: 'markdown', category: 'Blocks',    label: 'Unordered List', template: '- $CURSOR$',             shortcut: '' },
  { lang: 'markdown', category: 'Blocks',    label: 'Ordered List',  template: '1. $CURSOR$',             shortcut: '' },
  { lang: 'markdown', category: 'Blocks',    label: 'Table',         template: '| Column 1 | Column 2 |\n|----------|----------|\n| $CURSOR$ |          |', shortcut: '' },

  // ── Markdown: Math ───────────────────────────────────────────────────────
  { lang: 'markdown', category: 'Math',      label: 'Inline Math',   template: '$$$SELECTION$$CURSOR$$$', shortcut: 'Ctrl+M' },
  { lang: 'markdown', category: 'Math',      label: 'Display Math',  template: '\n$$\n$SELECTION$$CURSOR$\n$$\n', shortcut: 'Ctrl+Shift+M' },

  // ── LaTeX: Structure ─────────────────────────────────────────────────────
  { lang: 'latex', category: 'Structure', label: 'Section',          template: '\\section{$CURSOR$}',     shortcut: '' },
  { lang: 'latex', category: 'Structure', label: 'Subsection',       template: '\\subsection{$CURSOR$}',  shortcut: '' },
  { lang: 'latex', category: 'Structure', label: 'Subsubsection',    template: '\\subsubsection{$CURSOR$}', shortcut: '' },
  { lang: 'latex', category: 'Structure', label: 'Label',            template: '\\label{$CURSOR$}',       shortcut: '' },
  { lang: 'latex', category: 'Structure', label: 'Reference',        template: '\\ref{$CURSOR$}',         shortcut: '' },
  { lang: 'latex', category: 'Structure', label: 'Citation',         template: '\\cite{$CURSOR$}',        shortcut: '' },

  // ── LaTeX: Text ──────────────────────────────────────────────────────────
  { lang: 'latex', category: 'Text',      label: 'Bold',             template: '\\textbf{$SELECTION$$CURSOR$}', shortcut: 'Ctrl+B' },
  { lang: 'latex', category: 'Text',      label: 'Italic',           template: '\\textit{$SELECTION$$CURSOR$}', shortcut: 'Ctrl+I' },
  { lang: 'latex', category: 'Text',      label: 'Emphasis',         template: '\\emph{$SELECTION$$CURSOR$}',   shortcut: '' },
  { lang: 'latex', category: 'Text',      label: 'Typewriter',       template: '\\texttt{$SELECTION$$CURSOR$}', shortcut: '' },

  // ── LaTeX: Math ──────────────────────────────────────────────────────────
  { lang: 'latex', category: 'Math',      label: 'Inline Math',      template: '$$$SELECTION$$CURSOR$$$', shortcut: 'Ctrl+M' },
  { lang: 'latex', category: 'Math',      label: 'Display Equation', template: '\\[\n$SELECTION$$CURSOR$\n\\]', shortcut: 'Ctrl+Shift+M' },
  { lang: 'latex', category: 'Math',      label: 'Aligned',          template: '\\begin{aligned}\n  $CURSOR$ &= \\\\\\\\\n\\end{aligned}', shortcut: '' },
  { lang: 'latex', category: 'Math',      label: 'Fraction',         template: '\\frac{$CURSOR$}{}',     shortcut: '' },
  { lang: 'latex', category: 'Math',      label: 'Sum',              template: '\\sum_{$CURSOR$}^{}',    shortcut: '' },
  { lang: 'latex', category: 'Math',      label: 'Integral',         template: '\\int_{$CURSOR$}^{}',    shortcut: '' },
  { lang: 'latex', category: 'Math',      label: 'Matrix',           template: '\\begin{pmatrix}\n  $CURSOR$ & \\\\\\\\\n  & \n\\end{pmatrix}', shortcut: '' },

  // ── LaTeX: Environments ──────────────────────────────────────────────────
  { lang: 'latex', category: 'Environments', label: 'Figure',        template: '\\begin{figure}[htbp]\n  \\centering\n  \\includegraphics[width=0.8\\textwidth]{$CURSOR$}\n  \\caption{}\n  \\label{fig:}\n\\end{figure}', shortcut: '' },
  { lang: 'latex', category: 'Environments', label: 'Table',         template: '\\begin{table}[htbp]\n  \\centering\n  \\begin{tabular}{ll}\n    \\hline\n    $CURSOR$ & \\\\\\\\\n    \\hline\n  \\end{tabular}\n  \\caption{}\n  \\label{tab:}\n\\end{table}', shortcut: '' },
  { lang: 'latex', category: 'Environments', label: 'Itemize',       template: '\\begin{itemize}\n  \\item $CURSOR$\n\\end{itemize}', shortcut: '' },
  { lang: 'latex', category: 'Environments', label: 'Enumerate',     template: '\\begin{enumerate}\n  \\item $CURSOR$\n\\end{enumerate}', shortcut: '' },
  { lang: 'latex', category: 'Environments', label: 'Theorem',       template: '\\begin{theorem}\n  $CURSOR$\n\\end{theorem}', shortcut: '' },
  { lang: 'latex', category: 'Environments', label: 'Definition',    template: '\\begin{definition}\n  $CURSOR$\n\\end{definition}', shortcut: '' },
  { lang: 'latex', category: 'Environments', label: 'Lemma',         template: '\\begin{lemma}\n  $CURSOR$\n\\end{lemma}', shortcut: '' },
  { lang: 'latex', category: 'Environments', label: 'Proof',         template: '\\begin{proof}\n  $CURSOR$\n\\end{proof}', shortcut: '' },
  { lang: 'latex', category: 'Environments', label: 'Quotation',     template: '\\begin{quote}\n  $CURSOR$\n\\end{quote}', shortcut: '' },
  { lang: 'latex', category: 'Environments', label: 'Includegraphics', template: '\\includegraphics[width=$CURSOR$\\textwidth]{}', shortcut: '' },
];

/**
 * Get snippets filtered by language.
 */
export function getSnippetsForLang(lang) {
  const all = [...BUILTIN_SNIPPETS, ...loadUserSnippets()];
  return all.filter(s => s.lang === lang || s.lang === 'both');
}

/**
 * Get all snippets grouped by category.
 */
export function getSnippetsGrouped(lang) {
  const snippets = getSnippetsForLang(lang);
  const groups = {};
  for (const s of snippets) {
    const cat = s.category || 'Other';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(s);
  }
  return groups;
}

/**
 * Apply a snippet template at the cursor position.
 * Replaces $SELECTION$ with current selection, positions cursor at $CURSOR$.
 */
export function applySnippet(textarea, snippet) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selection = textarea.value.substring(start, end);
  const before = textarea.value.substring(0, start);
  const after = textarea.value.substring(end);

  let text = snippet.template;
  text = text.replace(/\$SELECTION\$/g, selection);

  const cursorMarker = '$CURSOR$';
  const cursorPos = text.indexOf(cursorMarker);
  text = text.replace(/\$CURSOR\$/g, '');

  textarea.value = before + text + after;

  const newCursorPos = cursorPos >= 0 ? start + cursorPos : start + text.length;
  textarea.selectionStart = textarea.selectionEnd = newCursorPos;
  textarea.dispatchEvent(new Event('input'));
  textarea.focus();
}

/**
 * Load user-defined snippets from localStorage.
 */
export function loadUserSnippets() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_SNIPPETS);
    return stored ? JSON.parse(stored) : [];
  } catch { return []; }
}

/**
 * Save user-defined snippets to localStorage.
 */
export function saveUserSnippets(snippets) {
  localStorage.setItem(STORAGE_KEY_SNIPPETS, JSON.stringify(snippets));
}

/**
 * Auto-close delimiters map by language.
 */
export const AUTO_CLOSE = {
  markdown: {
    '`': '`',
    '$': '$',
    '*': '*',
    '[': ']',
    '(': ')',
    '{': '}',
  },
  latex: {
    '{': '}',
    '[': ']',
    '(': ')',
    '$': '$',
  },
};

/**
 * Handle auto-close for a keypress event on a textarea.
 * Returns true if the event was handled.
 */
export function handleAutoClose(textarea, e, lang) {
  const pairs = AUTO_CLOSE[lang] || {};
  const ch = e.key;
  const closer = pairs[ch];

  if (!closer) return false;

  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;

  // If there's a selection, wrap it
  if (start !== end) {
    e.preventDefault();
    const selected = textarea.value.substring(start, end);
    const before = textarea.value.substring(0, start);
    const after = textarea.value.substring(end);
    textarea.value = before + ch + selected + closer + after;
    textarea.selectionStart = start + 1;
    textarea.selectionEnd = end + 1;
    textarea.dispatchEvent(new Event('input'));
    return true;
  }

  // If next char is the same closer, just move past it
  if (textarea.value[start] === ch && ch === closer) {
    e.preventDefault();
    textarea.selectionStart = textarea.selectionEnd = start + 1;
    return true;
  }

  // Auto-close: insert pair
  e.preventDefault();
  const before = textarea.value.substring(0, start);
  const after = textarea.value.substring(start);
  textarea.value = before + ch + closer + after;
  textarea.selectionStart = textarea.selectionEnd = start + 1;
  textarea.dispatchEvent(new Event('input'));
  return true;
}
