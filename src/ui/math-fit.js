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
 *
 * The DOM shape this produces:
 *
 *   .math-block            overflow container, full column width
 *     .math-sizer          sized to the PAINTED dimensions, centred
 *       .katex-display     scaled with a transform from its top-left corner
 *
 * The sizer exists because `transform: scale()` changes what is painted but
 * not the layout box. Without it the container would still measure the
 * equation at full width, and hiding that overflow would crop an equation that
 * visually fits perfectly well.
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

    const sizer = container.querySelector(':scope > .math-sizer');
    const inner = sizer ? sizer.firstElementChild : container.firstElementChild;
    if (!inner) continue;

    reset(container, sizer, inner);

    const available = container.clientWidth;
    const natural = inner.scrollWidth;
    const naturalHeight = inner.offsetHeight;

    if (!available || !natural) continue;

    if (natural <= available + SLOP_PX) {
      container.dataset.mathFit = 'natural';
      stats.fitted++;
      continue;
    }

    const wanted = available / natural;

    if (wanted >= MIN_SCALE) {
      // Shrinking is enough: scale, and size the wrapper to the painted box so
      // the container measures what it can actually see.
      applyScale(sizer, inner, wanted, natural, naturalHeight);
      container.dataset.mathFit = 'scaled';
      stats.scaled++;
      continue;
    }

    // Too wide to shrink readably: scroll it, locally, at the readability floor.
    applyScale(sizer, inner, MIN_SCALE, natural, naturalHeight);
    if (sizer) sizer.style.margin = '0';   // scroll from the left edge, not centred
    container.classList.add('math-scroll');
    container.dataset.mathFit = 'scroll';
    container.title = 'This equation is wider than the column — scroll it sideways to see the rest.';
    stats.scrolled++;
  }

  return stats;
}

function reset(container, sizer, inner) {
  inner.style.transform = '';
  inner.style.transformOrigin = '';
  inner.style.width = '';
  if (sizer) {
    sizer.style.width = '';
    sizer.style.height = '';
    sizer.style.margin = '';
  }
  container.classList.remove('math-scroll');
  container.removeAttribute('title');
}

function applyScale(sizer, inner, scale, naturalWidth, naturalHeight) {
  inner.style.transformOrigin = 'left top';
  inner.style.transform = `scale(${scale.toFixed(4)})`;
  // Pin the inner layout width so the transform has a stable box to scale, even
  // once the sizer around it becomes narrower than the equation.
  inner.style.width = `${Math.ceil(naturalWidth)}px`;

  if (!sizer) return;
  sizer.style.width = `${Math.ceil(naturalWidth * scale)}px`;
  sizer.style.height = `${Math.ceil(naturalHeight * scale)}px`;
}

/**
 * Wrap a display equation in a scroll container plus sizer the first time we
 * see it. The container, not the equation, owns the overflow, so the page
 * itself never scrolls sideways.
 */
function ensureContainer(block) {
  const parent = block.parentElement;
  if (!parent) return null;

  // Already wrapped.
  if (parent.classList?.contains('math-sizer')) return parent.parentElement;
  if (parent.classList?.contains('math-block')) return parent;

  // Published output ships its own <section> wrapper and an SVG that already
  // carries max-width:100%; it needs the container class but no restructuring.
  if (block.dataset?.mdtexMath === 'display') {
    block.classList.add('math-block');
    return block;
  }

  const container = document.createElement('div');
  container.className = 'math-block';
  const sizer = document.createElement('div');
  sizer.className = 'math-sizer';

  parent.insertBefore(container, block);
  container.append(sizer);
  sizer.append(block);

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
