/**
 * The page-level loading bar.
 *
 * Opening an article is four steps — fetch, theme, assets, render — and on this
 * machine a short one finishes in about 20 ms while a 20 000-character article
 * with 143 formulas takes 150–200 ms. A bar that appeared for both would be a
 * flash of noise most of the time, so it waits: nothing is shown unless the
 * load is still going after `delay`, and a load that beats the delay leaves the
 * page untouched.
 *
 * The fractions are real. Each step advances the bar *before* it starts, so the
 * width means "this is what is happening now" rather than an animation timed to
 * look busy. That matters most for the last step: rendering the preview is
 * synchronous and blocks the main thread, so the bar cannot move during it —
 * it is moved, and given a frame to paint, before the work begins.
 */

const DEFAULT_DELAY_MS = 120;

let bar = null;
let fill = null;
let token = 0;
let shownCount = 0;
let showTimer = null;
let resetTimer = null;

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
export function beginTask({ delay = DEFAULT_DELAY_MS } = {}) {
  const mine = ++token;
  const current = () => mine === token;

  clearTimeout(showTimer);
  clearTimeout(resetTimer);

  showTimer = setTimeout(() => {
    if (!current() || !bar) return;
    shownCount++;
    bar.dataset.state = 'active';
    bar.setAttribute('aria-hidden', 'false');
    // Start from a visible sliver rather than zero: a bar that appears empty
    // reads as "stuck", not as "starting".
    setWidth(0.08);
  }, delay);

  return {
    get superseded() { return !current(); },

    /**
     * Show the bar now, without waiting out the delay.
     *
     * For work that blocks the main thread the delay is useless: a timer cannot
     * fire while synchronous JavaScript is running, so a bar that waits 120 ms
     * to appear never appears at all — the blocking work finishes first and
     * completes the task. A caller that is about to block must say so.
     */
    showNow() {
      if (!current() || !bar) return;
      clearTimeout(showTimer);
      if (bar.dataset.state === 'active') return;
      shownCount++;
      bar.dataset.state = 'active';
      bar.setAttribute('aria-hidden', 'false');
      if (widthFraction() < 0.08) setWidth(0.08);
    },

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
      clearTimeout(showTimer);
      if (!bar || bar.dataset.state !== 'active') {
        // Never shown, because the task beat the delay. Leave the page alone.
        if (bar) bar.dataset.state = 'idle';
        return;
      }
      setWidth(1);
      bar.dataset.state = 'done';
      resetTimer = setTimeout(() => {
        if (!current()) return;
        bar.dataset.state = 'idle';
        bar.setAttribute('aria-hidden', 'true');
        // Reset the width only once it is invisible, so it never rewinds on
        // screen.
        fill.style.transition = 'none';
        setWidth(0);
        void fill.offsetWidth;
        fill.style.transition = '';
      }, 320);
    },

    /** Give up without completing — the bar retreats rather than claiming success. */
    fail() {
      if (!current()) return;
      clearTimeout(showTimer);
      if (!bar || bar.dataset.state !== 'active') { if (bar) bar.dataset.state = 'idle'; return; }
      bar.dataset.state = 'failed';
      resetTimer = setTimeout(() => {
        if (!current()) return;
        bar.dataset.state = 'idle';
        bar.setAttribute('aria-hidden', 'true');
        fill.style.transition = 'none';
        setWidth(0);
        void fill.offsetWidth;
        fill.style.transition = '';
      }, 320);
    },
  };
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
