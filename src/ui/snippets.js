/**
 * Language-aware snippet system for Markdown and LaTeX quick-insert.
 *
 * Each snippet defines:
 *   lang: 'markdown' | 'latex' | 'both'
 *   id: names the display label, `snippets.<id>` in the interface strings
 *   category: grouping id (e.g. 'structure', 'math', 'text')
 *   template: insertion text with $CURSOR$ marking cursor position
 *             and $SELECTION$ marking where selected text goes
 *   shortcut: optional keyboard shortcut (e.g. 'Ctrl+B')
 *
 * Only the label and the category name are interface text, and so translated.
 * The template is what lands in the user's document, and is never translated.
 */

import { t } from './i18n.js';

const STORAGE_KEY_SNIPPETS = 'publisher_user_snippets';

const BUILTIN_DEFINITIONS = [
  // ── Markdown: Structure ──────────────────────────────────────────────────
  { lang: 'markdown', category: 'structure', id: 'heading1',     template: '# $CURSOR$',              shortcut: '' },
  { lang: 'markdown', category: 'structure', id: 'heading2',     template: '## $CURSOR$',             shortcut: '' },
  { lang: 'markdown', category: 'structure', id: 'heading3',     template: '### $CURSOR$',            shortcut: '' },
  { lang: 'markdown', category: 'structure', id: 'horizontalRule', template: '\n---\n$CURSOR$',       shortcut: '' },
  { lang: 'markdown', category: 'structure', id: 'blockquote',    template: '> $SELECTION$$CURSOR$',   shortcut: '' },
  { lang: 'markdown', category: 'structure', id: 'footnote',      template: '[^$CURSOR$]: ',           shortcut: '' },

  // ── Markdown: Text ───────────────────────────────────────────────────────
  { lang: 'markdown', category: 'text',      id: 'bold',          template: '**$SELECTION$$CURSOR$**', shortcut: 'Ctrl+B' },
  { lang: 'markdown', category: 'text',      id: 'italic',        template: '*$SELECTION$$CURSOR$*',   shortcut: 'Ctrl+I' },
  { lang: 'markdown', category: 'text',      id: 'inlineCode',   template: '`$SELECTION$$CURSOR$`',  shortcut: 'Ctrl+`' },
  { lang: 'markdown', category: 'text',      id: 'link',          template: '[$SELECTION$]($CURSOR$)', shortcut: 'Ctrl+K' },
  { lang: 'markdown', category: 'text',      id: 'image',         template: '![$CURSOR$](url)',        shortcut: '' },

  // ── Markdown: Code & Lists ───────────────────────────────────────────────
  { lang: 'markdown', category: 'blocks',    id: 'codeBlock',    template: '```$CURSOR$\n\n```',      shortcut: '' },
  { lang: 'markdown', category: 'blocks',    id: 'unorderedList', template: '- $CURSOR$',             shortcut: '' },
  { lang: 'markdown', category: 'blocks',    id: 'orderedList',  template: '1. $CURSOR$',             shortcut: '' },
  { lang: 'markdown', category: 'blocks',    id: 'table',         template: '| Column 1 | Column 2 |\n|----------|----------|\n| $CURSOR$ |          |', shortcut: '' },

  // ── Markdown: Math ───────────────────────────────────────────────────────
  { lang: 'markdown', category: 'math',      id: 'inlineMath',   template: '$$$SELECTION$$CURSOR$$$', shortcut: 'Ctrl+M' },
  { lang: 'markdown', category: 'math',      id: 'displayMath',  template: '\n$$\n$SELECTION$$CURSOR$\n$$\n', shortcut: 'Ctrl+Shift+M' },

  // ── LaTeX: Structure ─────────────────────────────────────────────────────
  { lang: 'latex', category: 'structure', id: 'section',          template: '\\section{$CURSOR$}',     shortcut: '' },
  { lang: 'latex', category: 'structure', id: 'subsection',       template: '\\subsection{$CURSOR$}',  shortcut: '' },
  { lang: 'latex', category: 'structure', id: 'subsubsection',    template: '\\subsubsection{$CURSOR$}', shortcut: '' },
  { lang: 'latex', category: 'structure', id: 'label',            template: '\\label{$CURSOR$}',       shortcut: '' },
  { lang: 'latex', category: 'structure', id: 'reference',        template: '\\ref{$CURSOR$}',         shortcut: '' },
  { lang: 'latex', category: 'structure', id: 'citation',         template: '\\cite{$CURSOR$}',        shortcut: '' },

  // ── LaTeX: Text ──────────────────────────────────────────────────────────
  { lang: 'latex', category: 'text',      id: 'bold',             template: '\\textbf{$SELECTION$$CURSOR$}', shortcut: 'Ctrl+B' },
  { lang: 'latex', category: 'text',      id: 'italic',           template: '\\textit{$SELECTION$$CURSOR$}', shortcut: 'Ctrl+I' },
  { lang: 'latex', category: 'text',      id: 'emphasis',         template: '\\emph{$SELECTION$$CURSOR$}',   shortcut: '' },
  { lang: 'latex', category: 'text',      id: 'typewriter',       template: '\\texttt{$SELECTION$$CURSOR$}', shortcut: '' },

  // ── LaTeX: Math ──────────────────────────────────────────────────────────
  { lang: 'latex', category: 'math',      id: 'inlineMath',      template: '$$$SELECTION$$CURSOR$$$', shortcut: 'Ctrl+M' },
  { lang: 'latex', category: 'math',      id: 'displayEquation', template: '\\[\n$SELECTION$$CURSOR$\n\\]', shortcut: 'Ctrl+Shift+M' },
  { lang: 'latex', category: 'math',      id: 'aligned',          template: '\\begin{aligned}\n  $CURSOR$ &= \\\\\\\\\n\\end{aligned}', shortcut: '' },
  { lang: 'latex', category: 'math',      id: 'fraction',         template: '\\frac{$CURSOR$}{}',     shortcut: '' },
  { lang: 'latex', category: 'math',      id: 'sum',              template: '\\sum_{$CURSOR$}^{}',    shortcut: '' },
  { lang: 'latex', category: 'math',      id: 'integral',         template: '\\int_{$CURSOR$}^{}',    shortcut: '' },
  { lang: 'latex', category: 'math',      id: 'matrix',           template: '\\begin{pmatrix}\n  $CURSOR$ & \\\\\\\\\n  & \n\\end{pmatrix}', shortcut: '' },

  // ── LaTeX: Environments ──────────────────────────────────────────────────
  { lang: 'latex', category: 'environments', id: 'figure',        template: '\\begin{figure}[htbp]\n  \\centering\n  \\includegraphics[width=0.8\\textwidth]{$CURSOR$}\n  \\caption{}\n  \\label{fig:}\n\\end{figure}', shortcut: '' },
  { lang: 'latex', category: 'environments', id: 'table',         template: '\\begin{table}[htbp]\n  \\centering\n  \\begin{tabular}{ll}\n    \\hline\n    $CURSOR$ & \\\\\\\\\n    \\hline\n  \\end{tabular}\n  \\caption{}\n  \\label{tab:}\n\\end{table}', shortcut: '' },
  { lang: 'latex', category: 'environments', id: 'itemize',       template: '\\begin{itemize}\n  \\item $CURSOR$\n\\end{itemize}', shortcut: '' },
  { lang: 'latex', category: 'environments', id: 'enumerate',     template: '\\begin{enumerate}\n  \\item $CURSOR$\n\\end{enumerate}', shortcut: '' },
  { lang: 'latex', category: 'environments', id: 'theorem',       template: '\\begin{theorem}\n  $CURSOR$\n\\end{theorem}', shortcut: '' },
  { lang: 'latex', category: 'environments', id: 'definition',    template: '\\begin{definition}\n  $CURSOR$\n\\end{definition}', shortcut: '' },
  { lang: 'latex', category: 'environments', id: 'lemma',         template: '\\begin{lemma}\n  $CURSOR$\n\\end{lemma}', shortcut: '' },
  { lang: 'latex', category: 'environments', id: 'proof',         template: '\\begin{proof}\n  $CURSOR$\n\\end{proof}', shortcut: '' },
  { lang: 'latex', category: 'environments', id: 'quotation',     template: '\\begin{quote}\n  $CURSOR$\n\\end{quote}', shortcut: '' },
  { lang: 'latex', category: 'environments', id: 'includegraphics', template: '\\includegraphics[width=$CURSOR$\\textwidth]{}', shortcut: '' },
];

/**
 * The built-in snippets, each with a `label` that reads the current interface
 * language every time it is shown — so a language change needs no rebuild.
 */
export const BUILTIN_SNIPPETS = BUILTIN_DEFINITIONS.map(definition => Object.defineProperty(
  { ...definition }, 'label', { get: () => t(`snippets.${definition.id}`), enumerable: true },
));

const CATEGORIES = new Set(['structure', 'text', 'blocks', 'math', 'environments', 'other']);

/**
 * The display name of a category. Built-in category ids — and a user snippet
 * spelling one the old way ('Math') — are translated; any other name is the
 * user's own and is shown as written.
 */
export function categoryLabel(category) {
  const id = String(category || 'other').toLowerCase();
  return CATEGORIES.has(id) ? t(`snippets.category.${id}`) : category;
}

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
    const cat = categoryLabel(s.category);
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
