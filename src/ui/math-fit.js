/**
 * Display-mathematics overflow handling for the preview pane.
 *
 * Rules, in order:
 *   1. A display equation that fits does nothing.
 *   2. A display equation that is slightly too wide scales down, as long as it
 *      stays readable (never below MIN_SCALE of its natural size).
 *   3. Anything still too wide gets a horizontal scroll container of its own,
 *      styled to match MDTeX rather than the browser default. The article never
 *      becomes horizontally scrollable, and the formula is never cropped: the
 *      full expression stays reachable.
 *   4. Inline mathematics is never touched — no scaling, no scroll container —
 *      so text flow and baselines are preserved.
 */

/** Do not shrink below this fraction of natural size; smaller is unreadable. */
const MIN_SCALE = 0.72;

/** Ignore sub-pixel differences from fractional layout widths. */
const SLOP_PX = 1.5;

/**
 * Fit every display equation inside `root`.
 * Safe to call repeatedly; each call recomputes from the natural size.
 */
export function fitDisplayMath(root) {
  if (!root) return { fitted: 0, scaled: 0, scrolled: 0 };

  const stats = { fitted: 0, scaled: 0, scrolled: 0 };

  // KaTeX display maths in the preview, and the published inline-SVG form.
  const blocks = root.querySelectorAll('.katex-display, [data-mdtex-math="display"]');

  for (const block of blocks) {
    const container = ensureContainer(block);
    if (!container) continue;

    const inner = container.firstElementChild;
    if (!inner) continue;

    reset(container, inner);

    const available = container.clientWidth;
    const natural = inner.scrollWidth;
    const naturalHeight = inner.offsetHeight;

    if (!available || !natural) continue;

    if (natural <= available + SLOP_PX) {
      container.dataset.mathFit = 'natural';
      stats.fitted++;
      continue;
    }

    const scale = Math.max(available / natural, MIN_SCALE);
    applyScale(inner, scale, naturalHeight);

    if (scale > MIN_SCALE || natural * scale <= available + SLOP_PX) {
      // Shrinking was enough.
      container.dataset.mathFit = 'scaled';
      container.removeAttribute('title');
      stats.scaled++;
      continue;
    }

    // Still too wide even at the readability floor: scroll it, locally.
    // A transform does not change the layout width, so the scroll container
    // would not know how far it can scroll — set the scaled width explicitly.
    inner.style.transformOrigin = 'left top';
    inner.style.width = `${Math.ceil(natural * scale)}px`;
    container.classList.add('math-scroll');
    container.dataset.mathFit = 'scroll';
    container.title = 'This equation is wider than the column — scroll it sideways to see the rest.';
    stats.scrolled++;
  }

  return stats;
}

function reset(container, inner) {
  inner.style.transform = '';
  inner.style.transformOrigin = '';
  inner.style.marginBottom = '';
  inner.style.width = '';
  container.classList.remove('math-scroll');
  container.removeAttribute('title');
}

/**
 * Scale an equation down to fit.
 *
 * `transform: scale()` shrinks what is painted but leaves the layout box at its
 * natural size. Setting an explicit height instead would make the element's own
 * children overflow it, which is what produces a stray vertical scrollbar — so
 * the leftover vertical space is reclaimed with a negative bottom margin, which
 * affects layout without touching the element's own content box.
 */
function applyScale(inner, scale, naturalHeight) {
  inner.style.transform = `scale(${scale.toFixed(4)})`;
  inner.style.transformOrigin = 'center top';
  const reclaimed = Math.round(naturalHeight * (1 - scale));
  if (reclaimed > 0) inner.style.marginBottom = `${-reclaimed}px`;
}

/**
 * Wrap a display equation in a scroll container the first time we see it.
 * The container, not the equation, owns the overflow, so the page itself never
 * scrolls sideways.
 */
function ensureContainer(block) {
  const parent = block.parentElement;
  if (!parent) return null;

  if (parent.classList?.contains('math-block')) return parent;

  // The published form already ships its own <section> wrapper.
  if (block.dataset?.mdtexMath === 'display') {
    block.classList.add('math-block');
    return block;
  }

  const container = document.createElement('div');
  container.className = 'math-block';
  parent.insertBefore(container, block);
  container.append(block);
  return container;
}

/**
 * Re-fit on resize, coalesced to one pass per frame.
 * Returns a disposer.
 */
export function observeMathFit(root) {
  if (!root) return () => {};

  let frame = null;
  const schedule = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      fitDisplayMath(root);
    });
  };

  const observer = new ResizeObserver(schedule);
  observer.observe(root);

  return () => {
    observer.disconnect();
    if (frame) cancelAnimationFrame(frame);
  };
}
