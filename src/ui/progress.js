/**
 * The page-level loading bar.
 *
 * Opening an article shows it. Always — a bar that decides for itself when it
 * is worth appearing is a bar nobody ever sees, because most articles open in
 * about 20 ms and only a very long one takes 150–200 ms.
 *
 * What stops that being a flicker is a floor, not a threshold: once shown, the
 * bar stays for `MIN_VISIBLE_MS` before it is allowed to complete. A fast load
 * therefore reads as a deliberate transition rather than a glitch, and a slow
 * one is covered for as long as it actually takes.
 *
 * The fractions are real. Each step advances the bar *before* it starts, so the
 * width means "this is what is happening now" rather than an animation timed to
 * look busy. That matters most for the last step: rendering the preview is
 * synchronous and blocks the main thread, so the bar cannot move during it —
 * it is moved, and given a frame to paint, before the work begins.
 */

/** How long the bar stays up once shown, so a quick load is not a flicker. */
const MIN_VISIBLE_MS = 420;

let bar = null;
let fill = null;
let token = 0;
let shownCount = 0;
let resetTimer = null;
let shownAt = 0;

export function initPageProgress(parent = document.body) {
  if (bar) return bar;
  fill = document.createElement('div');
  fill.className = 'page-progress-fill';
  bar = document.createElement('div');
  bar.className = 'page-progress';
  bar.dataset.state = 'idle';
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-hidden', 'true');
  bar.append(fill);
  parent.prepend(bar);
  return bar;
}

/** How many times the bar has actually been shown. The e2e checks read this. */
export function progressShownCount() {
  return shownCount;
}

/**
 * Begin a task. The returned handle is inert once a later task has started, so
 * clicking through the library quickly cannot leave an abandoned load driving
 * the bar backwards.
 */
export function beginTask() {
  const mine = ++token;
  const current = () => mine === token;

  clearTimeout(resetTimer);

  // Shown immediately. There is nothing to decide: the user asked for an
  // article and this says it is being fetched.
  if (bar) {
    shownCount++;
    shownAt = performance.now();
    bar.dataset.state = 'active';
    bar.setAttribute('aria-hidden', 'false');
    // Start from a visible sliver rather than zero: a bar that appears empty
    // reads as "stuck", not as "starting".
    fill.style.transition = 'none';
    setWidth(0);
    void fill.offsetWidth;
    fill.style.transition = '';
    setWidth(0.08);
  }

  return {
    get superseded() { return !current(); },

    /** Move to a fraction of the whole task. Never backwards. */
    to(fraction) {
      if (!current()) return;
      setWidth(Math.max(widthFraction(), Math.min(fraction, 0.97)));
    },

    /**
     * Move to `fraction`, then resolve once the browser has actually painted
     * it. Two frames, because a callback scheduled inside the current frame
     * runs before that frame is presented — one is not enough to guarantee the
     * new width is on screen before a blocking call starts.
     */
    async paint(fraction) {
      this.to(fraction);
      if (!current() || bar?.dataset.state !== 'active') return;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    },

    /** Finish: rush to full, then fade out and reset. */
    done() {
      if (!current()) return;
      // Hold it for the rest of its minimum life. Completing 20 ms after
      // appearing is the flicker this exists to avoid.
      const held = performance.now() - shownAt;
      const wait = Math.max(0, MIN_VISIBLE_MS - held);
      resetTimer = setTimeout(() => finish('done'), wait);
    },

    /** Give up without completing — the bar retreats rather than claiming success. */
    fail() {
      if (!current()) return;
      const held = performance.now() - shownAt;
      resetTimer = setTimeout(() => finish('failed'), Math.max(0, MIN_VISIBLE_MS - held));
    },
  };
}

/** Run the bar out: full (or not), fade, then reset while invisible. */
function finish(state) {
  if (!bar || bar.dataset.state !== 'active') return;
  if (state === 'done') setWidth(1);
  bar.dataset.state = state;

  resetTimer = setTimeout(() => {
    if (bar.dataset.state === 'active') return;   // a new task took over
    bar.dataset.state = 'idle';
    bar.setAttribute('aria-hidden', 'true');
    // Reset the width only once it is invisible, so it never rewinds on screen.
    fill.style.transition = 'none';
    setWidth(0);
    void fill.offsetWidth;
    fill.style.transition = '';
  }, 320);
}

function setWidth(fraction) {
  if (!fill) return;
  fill.style.width = `${(fraction * 100).toFixed(2)}%`;
  bar?.setAttribute('aria-valuenow', String(Math.round(fraction * 100)));
}

function widthFraction() {
  const raw = parseFloat(fill?.style.width || '0');
  return Number.isFinite(raw) ? raw / 100 : 0;
}
