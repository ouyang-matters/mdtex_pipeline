import { el } from './ui-kit.js';
import { diffLines, diffSequences } from '../core/diff.js';
import { renderMarkdown } from './browser-compiler.js';
import { t } from './i18n.js';

/**
 * Showing an AI edit on both sides of the workspace.
 *
 * While a proposal is under review, the source pane shows a line diff and the
 * preview shows one merged document — removed blocks in red, added blocks in
 * green — so the change can be judged as source and as the reader will see it.
 * Once applied, the new lines and blocks glow and fade, so the eye can find
 * what changed in the live document.
 *
 * Both sides are decided by the same diff (core/diff.js), over lines and over
 * rendered top-level blocks respectively; nothing here guesses at positions.
 */

const SETTLE_MS = 3600;

let review = null;   // { node, editor } while a proposal is shown

/** Top-level blocks of a rendered Markdown document, as elements. */
function renderedBlocks(source) {
  const template = document.createElement('template');
  template.innerHTML = renderMarkdown(source);
  const root = template.content.querySelector('#nice');
  return root ? [...root.children] : [];
}

/** Which blocks of `newSource`'s rendering are new, and the merged sequence. */
export function blockDiff(oldSource, newSource) {
  const before = renderedBlocks(oldSource);
  const after = renderedBlocks(newSource);
  const ops = diffSequences(before.map(b => b.outerHTML), after.map(b => b.outerHTML));
  return { ops, before, after };
}

/**
 * Show a proposal.
 *
 * @param {object} o
 * @param {HTMLTextAreaElement} o.editor
 * @param {string} o.oldSource              what the editor holds now
 * @param {string} o.newSource              what the AI proposes
 * @param {{added:number, removed:number}} o.stats
 * @param {(html: string) => HTMLElement} o.paintPreview   paints HTML into the preview, returns its root
 * @param {() => void} o.onApply
 * @param {() => void} o.onDiscard
 */
export function showProposal({ editor, oldSource, newSource, stats, paintPreview, onApply, onDiscard }) {
  clearProposal();

  // ── Source side: a line diff in place of the editor ──
  const lines = el('div', { class: 'ai-review-lines' });
  let firstChange = null;
  for (const op of diffLines(oldSource, newSource)) {
    const row = el('div', { class: `ai-line ${op.type === 'insert' ? 'add' : op.type === 'delete' ? 'del' : ''}`.trim() },
      el('span', { class: 'ai-line-sign' }, op.type === 'insert' ? '+' : op.type === 'delete' ? '−' : ' '),
      el('span', { class: 'ai-line-text' }, op.line || ' '));
    if (!firstChange && op.type !== 'equal') firstChange = row;
    lines.append(row);
  }

  const node = el('div', { class: 'ai-review' },
    el('div', { class: 'ai-review-bar' },
      el('span', { class: 'ai-review-title' }, t('app.review.title')),
      el('span', { class: 'diff-stat' },
        el('span', { class: 'added' }, `+${stats?.added ?? 0}`),
        el('span', { class: 'removed' }, `−${stats?.removed ?? 0}`)),
      el('button', { class: 'btn btn-xs', type: 'button', onClick: () => onDiscard() }, t('app.review.discard')),
      el('button', { class: 'btn btn-primary btn-xs', type: 'button', onClick: () => onApply() }, t('app.review.apply')),
    ),
    lines,
  );

  editor.classList.add('hidden');
  editor.after(node);
  review = { node, editor };
  firstChange?.scrollIntoView({ block: 'center' });

  // ── Preview side: one merged document ──
  // Consecutive added (or removed) blocks share one highlight, so a paragraph
  // with two equations reads as one change, as it does in the source.
  const { ops, before, after } = blockDiff(oldSource, newSource);
  const merged = document.createElement('div');
  merged.id = 'nice';
  for (const run of runsOf(ops)) {
    if (run.type === 'equal') {
      for (const op of run.ops) merged.append(after[op.newIndex]);
      continue;
    }
    const group = document.createElement('div');
    group.className = `ai-group ${run.type === 'insert' ? 'ai-group-add' : 'ai-group-del'}`;
    for (const op of run.ops) group.append(run.type === 'insert' ? after[op.newIndex] : before[op.oldIndex]);
    merged.append(group);
  }
  const root = paintPreview(merged.outerHTML);
  root?.querySelector('.ai-group')?.scrollIntoView({ block: 'center' });
}

/** Consecutive operations of the same type, as runs. */
function runsOf(ops) {
  const runs = [];
  for (const op of ops) {
    const last = runs[runs.length - 1];
    if (last && last.type === op.type) last.ops.push(op);
    else runs.push({ type: op.type, ops: [op] });
  }
  return runs;
}

/** Take the proposal off screen. The caller repaints the preview. */
export function clearProposal() {
  if (!review) return;
  review.node.remove();
  review.editor.classList.remove('hidden');
  review = null;
}

export function isReviewing() {
  return review !== null;
}

/**
 * After an edit has been applied and both sides repainted: let what changed
 * glow and settle.
 *
 * @param {object} o
 * @param {HTMLTextAreaElement} o.editor
 * @param {HTMLElement} o.previewRoot   the repainted preview's #nice
 */
export function flashApplied({ editor, previewRoot, oldSource, newSource }) {
  // Preview: the same block diff, applied to the live preview by position.
  // Post-processing (assets, math fitting) changes blocks' insides, never
  // how many there are, so the indices line up.
  if (previewRoot) {
    const { ops } = blockDiff(oldSource, newSource);
    const live = [...previewRoot.children];
    let first = null;
    for (const run of runsOf(ops)) {
      if (run.type !== 'insert') continue;
      const blocks = run.ops.map(op => live[op.newIndex]).filter(Boolean);
      if (!blocks.length) continue;
      // Wrapped only while it settles, then unwrapped: the live preview is left
      // exactly as the renderer made it.
      const group = document.createElement('div');
      group.className = 'ai-group ai-group-applied';
      blocks[0].before(group);
      group.append(...blocks);
      first = first || group;
      setTimeout(() => {
        if (group.parentNode) group.replaceWith(...group.childNodes);
      }, SETTLE_MS + 200);
    }
    first?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  // Source: bars over the inserted line ranges.
  const ranges = [];
  for (const op of diffLines(oldSource, newSource)) {
    if (op.type !== 'insert') continue;
    const last = ranges[ranges.length - 1];
    if (last && last.end === op.newIndex) last.end = op.newIndex + 1;
    else ranges.push({ start: op.newIndex, end: op.newIndex + 1 });
  }
  if (!ranges.length) return;

  const tops = lineTops(editor, newSource, ranges.flatMap(r => [r.start, r.end]));
  const layer = el('div', { class: 'ai-editor-marks' });
  const track = el('div', { class: 'ai-editor-marks-track' });
  layer.append(track);
  for (const range of ranges) {
    const top = tops.get(range.start);
    const bottom = tops.get(range.end);
    track.append(el('div', { class: 'ai-line-applied', style: { top: `${top}px`, height: `${Math.max(8, bottom - top)}px` } }));
  }

  Object.assign(layer.style, {
    top: `${editor.offsetTop}px`, left: `${editor.offsetLeft}px`,
    width: `${editor.clientWidth}px`, height: `${editor.clientHeight}px`,
  });
  editor.after(layer);

  const follow = () => { track.style.transform = `translateY(${-editor.scrollTop}px)`; };
  editor.scrollTop = Math.max(0, tops.get(ranges[0].start) - editor.clientHeight / 3);
  follow();
  editor.addEventListener('scroll', follow);

  setTimeout(() => {
    editor.removeEventListener('scroll', follow);
    layer.remove();
  }, SETTLE_MS + 200);
}

/**
 * Pixel offsets of line starts inside a wrapping textarea, measured with a
 * mirror of the same box — a line count times line-height drifts as soon as a
 * paragraph wraps.
 */
function lineTops(editor, text, indices) {
  const cs = getComputedStyle(editor);
  const mirror = document.createElement('div');
  for (const p of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'wordSpacing',
    'paddingTop', 'paddingLeft', 'paddingRight', 'tabSize']) {
    mirror.style[p] = cs[p];
  }
  Object.assign(mirror.style, {
    position: 'absolute', visibility: 'hidden', whiteSpace: 'pre-wrap', overflowWrap: 'break-word',
    boxSizing: 'border-box', width: `${editor.clientWidth}px`, top: '0', left: '-99999px',
  });

  const lines = text.split('\n');
  const wanted = new Set(indices);
  const markers = new Map();
  lines.forEach((line, i) => {
    if (wanted.has(i)) {
      const m = document.createElement('span');
      markers.set(i, m);
      mirror.append(m);
    }
    mirror.append(document.createTextNode(line + (i < lines.length - 1 ? '\n' : '')));
  });
  const end = document.createElement('span');
  mirror.append(end);
  document.body.append(mirror);

  const tops = new Map();
  for (const i of indices) tops.set(i, (markers.get(i) || end).offsetTop);
  mirror.remove();
  return tops;
}
