import { el, clear, mount, toast, confirmDialog, relativeTime } from './ui-kit.js';
import { backend } from './api.js';
import { app } from './state.js';
import { t } from './i18n.js';

/**
 * The Markdown / LaTeX tabs.
 *
 * Every article has two faces and one source: whichever format the article is
 * *not* currently written in is always shown as a generated preview, never a
 * second editable copy — two editable copies could only drift. The tab
 * matching the article's actual `sourceFormat` is the primary, editable one;
 * the other is read-only, and "use as source" is the one-way door that swaps
 * which is which, checkpointing the face it replaces.
 *
 * The two directions are not equally safe, so they are not equally eager.
 * Markdown -> LaTeX is a pure, lossless-for-what-it-covers function: the
 * LaTeX preview regenerates the instant its tab opens. LaTeX -> Markdown is
 * best-effort — `\label`, `\newcommand`, custom environments, TikZ and
 * bibliographies have no Markdown spelling — so nothing is generated until
 * the user explicitly asks with "Preview conversion".
 */

const dom = {};
let hooks = {};
let view = 'primary'; // 'primary' | 'preview'
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

  dom.mdPanel = document.getElementById('markdown-view');
  dom.mdNotes = document.getElementById('markdown-view-notes');
  dom.mdText = document.getElementById('markdown-source');
  dom.mdOrigin = document.getElementById('markdown-view-origin');
  dom.mdPreview = document.getElementById('btn-preview-markdown');
  dom.mdAdopt = document.getElementById('btn-adopt-markdown');

  dom.tabSource.addEventListener('click', () => {
    if (isLatexSourced()) showMarkdownPreview(); else showPrimary();
  });
  dom.tabLatex.addEventListener('click', () => {
    if (isLatexSourced()) showPrimary(); else showLatexPreview();
  });

  dom.adopt.addEventListener('click', () => adoptLatex());
  dom.save.addEventListener('click', () => save());
  dom.regen.addEventListener('click', () => refreshLatex({ regenerate: true }));
  dom.discard.addEventListener('click', () => discard());

  dom.mdPreview.addEventListener('click', () => previewMarkdown());
  dom.mdAdopt.addEventListener('click', () => adoptMarkdown());
}

function isLatexSourced() {
  return app.currentArticle?.sourceFormat === 'latex';
}

function primaryTab() { return isLatexSourced() ? dom.tabLatex : dom.tabSource; }
function previewTab() { return isLatexSourced() ? dom.tabSource : dom.tabLatex; }

/** The label of whichever tab is currently editable — used outside this module for messages. */
export function primaryTabLabel() {
  return isLatexSourced() ? 'LaTeX' : 'Markdown';
}

/** Which face is showing. The editor's own handlers use this to stay out of the way. */
export function isPreviewView() {
  return view === 'preview';
}

let shownFormat = null;

/**
 * Reconcile the tabs with the open article.
 * Called whenever the article or its format changes.
 */
export function syncLatexTabs() {
  const article = app.currentArticle;
  dom.tabs.classList.toggle('hidden', !article);

  // A generated preview belongs to the article — and the format — it was
  // generated from. Opening a different article, or converting this one to
  // the other format, drops back to the primary tab rather than leaving
  // stale preview text on screen, or the wrong tab highlighted as primary.
  const changed = app.currentArticleId !== shownFor || (article?.sourceFormat ?? null) !== shownFormat;
  shownFor = app.currentArticleId;
  shownFormat = article?.sourceFormat ?? null;

  if (changed) { latexCurrent = null; markdownCurrent = null; showPrimary(); }
}

function showPrimary() {
  view = 'primary';
  primaryTab().classList.add('active');
  previewTab().classList.remove('active');
  dom.editor.classList.remove('hidden');
  dom.panel.classList.add('hidden');
  dom.mdPanel.classList.add('hidden');
  setToolsEnabled(true);
  dom.editor.focus();
}

async function showLatexPreview() {
  if (!app.currentArticleId) return;
  shownFor = app.currentArticleId;

  view = 'preview';
  dom.tabLatex.classList.add('active');
  dom.tabSource.classList.remove('active');
  dom.editor.classList.add('hidden');
  dom.mdPanel.classList.add('hidden');
  dom.panel.classList.remove('hidden');
  setToolsEnabled(false);

  // The document is generated from what is on disk, so anything still sitting
  // in the editor has to land first — otherwise the tab shows the article as
  // it was a keystroke ago.
  await hooks.onBeforeLeaveEditor?.();
  await refreshLatex();
}

let latexCurrent = null;

async function refreshLatex({ regenerate = false } = {}) {
  dom.text.value = '';
  // The state is also a data attribute, so nothing has to match the (translated) text.
  dom.origin.dataset.state = regenerate ? 'generating' : 'loading';
  dom.origin.textContent = regenerate ? t('latex.origin.generating') : t('latex.origin.loading');
  setLatexBusy(true);
  clear(dom.notes);

  let result;
  try {
    result = await backend.workspace.latex(app.currentArticleId, { regenerate });
  } catch (e) {
    latexCurrent = null;
    dom.origin.dataset.state = 'error';
    dom.origin.textContent = '';
    setLatexBusy(false);
    mount(dom.notes, el('div', { class: 'latex-view-note error' }, e.message));
    return;
  }

  latexCurrent = result;
  dom.text.value = result.tex;
  renderLatexNotes(result);
  setLatexBusy(false);
  renderLatexFooter(result);
}

/**
 * The footer says which of three states this document is in, because they
 * behave differently and guessing between them is exactly the confusion a
 * saved copy could otherwise cause.
 */
function renderLatexFooter(result) {
  const blocked = result.errors.length > 0;

  dom.adopt.disabled = blocked;
  dom.adopt.title = blocked
    ? t('latex.adopt.blocked')
    : t('latex.adopt.title');

  dom.save.classList.toggle('hidden', result.saved && !result.stale);
  dom.save.disabled = blocked || !result.tex;
  dom.save.textContent = result.stale ? t('latex.save.version') : t('latex.save.latex');

  dom.regen.classList.toggle('hidden', !result.saved);
  dom.discard.classList.toggle('hidden', !result.saved);

  clear(dom.origin);
  dom.origin.dataset.state = result.saved ? (result.stale ? 'saved-stale' : 'saved') : 'generated';
  if (result.saved) {
    mount(dom.origin,
      el('span', { class: result.stale ? 'latex-stale-badge' : 'latex-saved-badge' },
        result.stale ? t('latex.badge.stale') : t('latex.badge.saved')),
      el('span', {}, ' ', t(result.stale ? 'latex.origin.savedStale' : 'latex.origin.savedFresh', {
        path: result.savedPath, when: relativeTime(result.savedAt),
      })),
    );
  } else {
    mount(dom.origin, el('span', {},
      result.derivedPath
        ? t('latex.origin.generatedAlso', { path: result.derivedPath })
        : t('latex.origin.generated')));
  }
}

function setLatexBusy(busy) {
  for (const node of [dom.save, dom.regen, dom.discard, dom.adopt]) node.disabled = busy;
}

async function save() {
  if (!latexCurrent?.tex) return;
  setLatexBusy(true);
  try {
    await backend.workspace.saveLatex(app.currentArticleId, latexCurrent.tex);
    toast(t('latex.toast.saved'));
    await refreshLatex();
  } catch (e) {
    setLatexBusy(false);
    toast(e.message, { type: 'error', timeout: 8000 });
  }
}

async function discard() {
  setLatexBusy(true);
  try {
    await backend.workspace.discardLatex(app.currentArticleId);
    toast(t('latex.toast.discarded'));
    await refreshLatex({ regenerate: true });
  } catch (e) {
    setLatexBusy(false);
    toast(e.message, { type: 'error', timeout: 8000 });
  }
}

function renderLatexNotes(result) {
  clear(dom.notes);
  mount(dom.notes,
    ...result.errors.map(e => el('div', { class: 'latex-view-note error' }, e.message)),
    ...result.warnings.map(w => el('div', { class: 'latex-view-note warning' }, w)),
  );
}

async function adoptLatex() {
  const article = app.currentArticle;
  if (!article) return;

  const confirmed = await confirmDialog({
    title: t('latex.adoptDialog.title'),
    message: t('latex.adoptDialog.message', { title: article.title }),
    detail: t('latex.adoptDialog.detail'),
    confirmLabel: t('latex.adoptDialog.confirm'),
    danger: true,
  });
  if (!confirmed) return;

  dom.adopt.disabled = true;
  try {
    const result = await backend.workspace.adoptLatex(app.currentArticleId);
    toast(t('latex.toast.adopted', { label: result.checkpoint.label }), { timeout: 5000 });
    await hooks.onSourceAdopted?.(result);
  } catch (e) {
    dom.adopt.disabled = false;
    toast(e.message, { type: 'error', timeout: 8000 });
  }
}

// ── The Markdown recovered from a LaTeX article ──────────────────────────────

let markdownCurrent = null;

async function showMarkdownPreview() {
  if (!app.currentArticleId) return;
  shownFor = app.currentArticleId;

  view = 'preview';
  dom.tabSource.classList.add('active');
  dom.tabLatex.classList.remove('active');
  dom.editor.classList.add('hidden');
  dom.panel.classList.add('hidden');
  dom.mdPanel.classList.remove('hidden');
  setToolsEnabled(false);

  await hooks.onBeforeLeaveEditor?.();
  renderMarkdownPlaceholder();
}

function renderMarkdownPlaceholder() {
  markdownCurrent = null;
  dom.mdText.value = '';
  clear(dom.mdNotes);
  dom.mdOrigin.dataset.state = 'placeholder';
  dom.mdOrigin.textContent = t('latex.md.placeholder');
  dom.mdPreview.classList.remove('hidden');
  dom.mdPreview.disabled = false;
  dom.mdAdopt.classList.add('hidden');
}

async function previewMarkdown() {
  dom.mdPreview.disabled = true;
  dom.mdOrigin.dataset.state = 'converting';
  dom.mdOrigin.textContent = t('latex.md.converting');

  let result;
  try {
    result = await backend.workspace.markdownFromLatex(app.currentArticleId);
  } catch (e) {
    dom.mdPreview.disabled = false;
    dom.mdOrigin.dataset.state = 'error';
    dom.mdOrigin.textContent = '';
    toast(e.message, { type: 'error', timeout: 8000 });
    return;
  }

  markdownCurrent = result;
  dom.mdText.value = result.markdown;
  clear(dom.mdNotes);
  mount(dom.mdNotes, ...result.warnings.map(w => el('div', { class: 'latex-view-note warning' }, w)));
  dom.mdOrigin.dataset.state = 'preview';
  dom.mdOrigin.textContent = t('latex.md.preview');
  dom.mdPreview.classList.add('hidden');
  dom.mdAdopt.classList.remove('hidden');
  dom.mdAdopt.disabled = false;
}

async function adoptMarkdown() {
  const article = app.currentArticle;
  if (!article || !markdownCurrent) return;

  const warningText = markdownCurrent.warnings.length ? `\n\n${markdownCurrent.warnings.join(' ')}` : '';
  const confirmed = await confirmDialog({
    title: t('latex.mdDialog.title'),
    // The conversion warnings come from the backend and are appended as they are.
    message: t('latex.mdDialog.message', { title: article.title }) + warningText,
    detail: t('latex.mdDialog.detail'),
    confirmLabel: t('latex.mdDialog.confirm'),
    danger: true,
  });
  if (!confirmed) return;

  dom.mdAdopt.disabled = true;
  try {
    const result = await backend.workspace.adoptMarkdown(app.currentArticleId);
    toast(t('latex.toast.converted', { label: result.checkpoint.label }), { timeout: 5000 });
    await hooks.onSourceAdopted?.(result);
  } catch (e) {
    dom.mdAdopt.disabled = false;
    toast(e.message, { type: 'error', timeout: 8000 });
  }
}

function setToolsEnabled(enabled) {
  for (const node of dom.tools) {
    if (node) node.disabled = !enabled;
  }
}
