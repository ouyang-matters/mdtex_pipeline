import { el, clear, mount, toast, confirmDialog, relativeTime } from './ui-kit.js';
import { backend } from './api.js';
import { app } from './state.js';

/**
 * The LaTeX tab.
 *
 * A Markdown article has two faces and one source. The Markdown tab edits the
 * article; the LaTeX tab shows the document that Markdown becomes — generated
 * by the backend with the same builder the PDF build uses, so the text on
 * screen is the text that compiles.
 *
 * It is read-only, and that is the design rather than a missing feature.
 * Markdown maps into LaTeX; LaTeX does not map back. `\newcommand`, `\label`,
 * TikZ and bibliographies have no Markdown spelling, so a second editable copy
 * could only diverge. "Use as source" is the one-way door: it makes LaTeX the
 * article's real source, checkpointing the Markdown on the way through.
 *
 * A LaTeX article has no second face — its source *is* LaTeX — so the tabs are
 * hidden entirely.
 */

const dom = {};
let hooks = {};
let view = 'source';
let shownFor = null;

export function initLatexView({ onBeforeLeaveEditor, onSourceAdopted, editor, editorTools = [] }) {
  hooks = { onBeforeLeaveEditor, onSourceAdopted };

  dom.editor = editor;
  dom.tools = editorTools;
  dom.tabs = document.getElementById('source-tabs');
  dom.tabSource = document.getElementById('tab-source');
  dom.tabLatex = document.getElementById('tab-latex');
  dom.panel = document.getElementById('latex-view');
  dom.notes = document.getElementById('latex-view-notes');
  dom.text = document.getElementById('latex-source');
  dom.origin = document.getElementById('latex-view-origin');
  dom.adopt = document.getElementById('btn-adopt-latex');
  dom.save = document.getElementById('btn-save-latex');
  dom.regen = document.getElementById('btn-regen-latex');
  dom.discard = document.getElementById('btn-discard-latex');

  dom.tabSource.addEventListener('click', () => showSource());
  dom.tabLatex.addEventListener('click', () => showLatex());
  dom.adopt.addEventListener('click', () => adopt());
  dom.save.addEventListener('click', () => save());
  dom.regen.addEventListener('click', () => refresh({ regenerate: true }));
  dom.discard.addEventListener('click', () => discard());
}

/** Which face is showing. The editor's own handlers use this to stay out of the way. */
export function isLatexView() {
  return view === 'latex';
}

/**
 * Reconcile the tabs with the open article.
 * Called whenever the article or its format changes; forces the editor back
 * into view when there is nothing to switch to.
 */
export function syncLatexTabs() {
  const article = app.currentArticle;
  const derivable = Boolean(article) && article.sourceFormat === 'markdown';

  dom.tabs.classList.toggle('hidden', !derivable);

  // A generated document belongs to the article it was generated from. Opening
  // a different one drops back to its source rather than leaving the previous
  // article's LaTeX on screen under a new title.
  const changed = app.currentArticleId !== shownFor;
  shownFor = app.currentArticleId;

  if (changed) current = null;
  if (view === 'latex' && (!derivable || changed)) showSource();
}

function showSource() {
  view = 'source';
  dom.tabSource.classList.add('active');
  dom.tabLatex.classList.remove('active');
  dom.editor.classList.remove('hidden');
  dom.panel.classList.add('hidden');
  setToolsEnabled(true);
  dom.editor.focus();
}

async function showLatex() {
  if (!app.currentArticleId) return;
  shownFor = app.currentArticleId;

  view = 'latex';
  dom.tabLatex.classList.add('active');
  dom.tabSource.classList.remove('active');
  dom.editor.classList.add('hidden');
  dom.panel.classList.remove('hidden');
  setToolsEnabled(false);

  // The document is generated from what is on disk, so anything still sitting
  // in the editor has to land first — otherwise the tab shows the article as
  // it was a keystroke ago.
  await hooks.onBeforeLeaveEditor?.();
  await refresh();
}

let current = null;

async function refresh({ regenerate = false } = {}) {
  dom.text.value = '';
  dom.origin.textContent = regenerate ? 'Generating…' : 'Loading…';
  setBusy(true);
  clear(dom.notes);

  let result;
  try {
    result = await backend.workspace.latex(app.currentArticleId, { regenerate });
  } catch (e) {
    current = null;
    dom.origin.textContent = '';
    setBusy(false);
    mount(dom.notes, el('div', { class: 'latex-view-note error' }, e.message));
    return;
  }

  current = result;
  dom.text.value = result.tex;
  renderNotes(result);
  setBusy(false);
  renderFooter(result);
}

/**
 * The footer says which of three states this document is in, because they
 * behave differently and guessing between them is exactly the confusion a
 * saved copy could otherwise cause.
 */
function renderFooter(result) {
  const blocked = result.errors.length > 0;

  dom.adopt.disabled = blocked;
  dom.adopt.title = blocked
    ? 'Resolve the errors above first.'
    : "Make this LaTeX the article's source. One-way.";

  dom.save.classList.toggle('hidden', result.saved && !result.stale);
  dom.save.disabled = blocked || !result.tex;
  dom.save.textContent = result.stale ? 'Save this version' : 'Save this LaTeX';

  dom.regen.classList.toggle('hidden', !result.saved);
  dom.discard.classList.toggle('hidden', !result.saved);

  clear(dom.origin);
  if (result.saved) {
    mount(dom.origin,
      el('span', { class: result.stale ? 'latex-stale-badge' : 'latex-saved-badge' },
        result.stale ? 'saved · out of date' : 'saved'),
      el('span', {}, ` ${result.savedPath} — kept ${relativeTime(result.savedAt)}.`
        + (result.stale ? ' The Markdown has changed since.' : ' Regenerate to rebuild it.')),
    );
  } else {
    mount(dom.origin, el('span', {},
      result.derivedPath
        ? `Generated from source.md — read-only. Also written to ${result.derivedPath}.`
        : 'Generated from source.md — read-only.'));
  }
}

function setBusy(busy) {
  for (const node of [dom.save, dom.regen, dom.discard, dom.adopt]) node.disabled = busy;
}

async function save() {
  if (!current?.tex) return;
  setBusy(true);
  try {
    await backend.workspace.saveLatex(app.currentArticleId, current.tex);
    toast('LaTeX saved. This tab will show it instead of generating a new one.');
    await refresh();
  } catch (e) {
    setBusy(false);
    toast(e.message, { type: 'error', timeout: 8000 });
  }
}

async function discard() {
  setBusy(true);
  try {
    await backend.workspace.discardLatex(app.currentArticleId);
    toast('Stopped keeping it. The tab generates from the Markdown again.');
    await refresh({ regenerate: true });
  } catch (e) {
    setBusy(false);
    toast(e.message, { type: 'error', timeout: 8000 });
  }
}

function renderNotes(result) {
  clear(dom.notes);
  mount(dom.notes,
    ...result.errors.map(e => el('div', { class: 'latex-view-note error' }, e.message)),
    ...result.warnings.map(w => el('div', { class: 'latex-view-note warning' }, w)),
  );
}

async function adopt() {
  const article = app.currentArticle;
  if (!article) return;

  const confirmed = await confirmDialog({
    title: 'Use LaTeX as the source?',
    message: `"${article.title}" will become a LaTeX article. This cannot be undone by switching back — `
      + 'LaTeX has no Markdown equivalent for what you can write in it.',
    detail: 'The Markdown is saved to a checkpoint first, so you can restore it from the '
      + 'Checkpoints panel. Embedded images are written into assets/.',
    confirmLabel: 'Use as source',
    danger: true,
  });
  if (!confirmed) return;

  dom.adopt.disabled = true;
  try {
    const result = await backend.workspace.adoptLatex(app.currentArticleId);
    toast(`LaTeX is now the source. The Markdown is in checkpoint "${result.checkpoint.label}".`,
      { timeout: 5000 });
    showSource();
    await hooks.onSourceAdopted?.(result);
  } catch (e) {
    dom.adopt.disabled = false;
    toast(e.message, { type: 'error', timeout: 8000 });
  }
}

function setToolsEnabled(enabled) {
  for (const node of dom.tools) {
    if (node) node.disabled = !enabled;
  }
}
