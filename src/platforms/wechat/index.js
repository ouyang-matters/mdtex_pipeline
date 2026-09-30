import { PlatformAdapter } from '../base.js';

/**
 * WeChat Official Account adapter.
 *
 * WeChat editor constraints:
 * - Only inline styles survive (no <style> tags, no classes)
 * - No external resources (CSS, JS, fonts)
 * - No scripts, iframes, video, audio
 * - No position: fixed/absolute in most cases
 * - Tables must use inline styles
 * - Content images must be on the WeChat CDN; MDTeX warns about local ones
 * - Links open in WeChat browser
 * - Max content width ~100vw mobile
 * - KaTeX HTML may partially work but SVG/images are safer
 */
export const WECHAT_SAFE_BODY_BYTES = 5_000_000;

const BLOCK_START =/^<(p|section|div|ul|ol|table|pre|blockquote|h[1-6])\b/i;

/**
 * Give every list item's inline content its own <section>.
 *
 * WeChat's editor wraps an item's inline run in a <section> on paste, but an
 * item that *starts* with an inline formula keeps that formula outside and
 * wraps only what follows — so "• (X, M, μ) 是测度空间" renders as the formula
 * on one line and the prose on the next. Arriving already wrapped, the item
 * has nothing left to split.
 *
 * The wrapper closes before any block inside the item (a nested list, a
 * display equation), which stays a sibling as it was.
 */
export function wrapListItemContent(html) {
  const out = [];
  const frames = []; // one per open <li>: is its <section> still open?
  const tag = /<\/?[a-zA-Z][^>]*>/g;
  let last = 0;
  let m;
  while ((m = tag.exec(html)) !== null) {
    const token = m[0];
    out.push(html.slice(last, m.index));
    last = m.index + token.length;

    if (/^<li\b/i.test(token)) {
      const rest = html.slice(last).trimStart();
      const wrap = !BLOCK_START.test(rest) && !/^<\/li>/i.test(rest);
      out.push(token, wrap ? '<section>' : '');
      frames.push(wrap);
      continue;
    }
    if (/^<\/li>/i.test(token)) {
      if (frames.pop()) out.push('</section>');
      out.push(token);
      continue;
    }
    if (frames.length && frames[frames.length - 1] && BLOCK_START.test(token)) {
      out.push('</section>');
      frames[frames.length - 1] = false;
    }
    out.push(token);
  }
  out.push(html.slice(last));
  return out.join('');
}

export class WeChatAdapter extends PlatformAdapter {
  constructor() {
    super('wechat');
  }

  transform(html) {
    let result = html;

    // Ensure section wrappers for better WeChat rendering
    result = result.replace(/<div id="nice">/g, '<section id="nice">');
    result = result.replace(/<\/div>(\s*)$/g, '</section>$1');

    // Convert remaining divs to sections where appropriate
    result = result.replace(/<div class="code-block-wrapper">/g, '<section class="code-block-wrapper">');
    result = result.replace(/<\/div>(\s*<section class="code-block-wrapper">)/g, '</section>$1');

    // Replace div wrappers for code blocks
    result = result.replace(/<div class="code-block-wrapper">/g, '<section class="code-block-wrapper">');
    result = result.replace(/<\/div>(\s*(?:<pre|<span class="code-lang"))/g, '</section>$1');

    return result;
  }

  sanitize(html) {
    let result = html;

    // Remove any script tags
    result = result.replace(/<script[\s\S]*?<\/script>/gi, '');

    // Remove any style tags (CSS should be inlined by now)
    result = result.replace(/<style[\s\S]*?<\/style>/gi, '');

    // Remove any link tags
    result = result.replace(/<link[^>]*>/gi, '');

    // Remove iframes
    result = result.replace(/<iframe[\s\S]*?<\/iframe>/gi, '');

    // Remove on* event handlers
    result = result.replace(/\s+on\w+="[^"]*"/gi, '');
    result = result.replace(/\s+on\w+='[^']*'/gi, '');

    // Remove class attributes (they serve no purpose after inlining)
    result = result.replace(/\s+class="[^"]*"/gi, '');

    // Remove id attributes except the root #nice
    result = result.replace(/(<(?!section)[^>]*)\s+id="(?!nice)[^"]*"/gi, '$1');

    // Strip xmlns:xlink if present (WeChat may not handle it)
    result = result.replace(/\s+xmlns:xlink="[^"]*"/gi, '');

    // The recorded geometry exists for math/normalize-sizing.js, which has run
    // by now. On the clipboard it is only weight: WeChat uploads the body twice
    // per save, and a large article sits near its limit. The inline/display
    // marker itself stays — it is what says which rules an element obeys.
    result = result.replace(/\s+data-mdtex-(?:w|h|va)="[^"]*"/gi, '');

    result = wrapListItemContent(result);

    return result;
  }

  validate(html) {
    const warnings = [];
    const errors = [];

    // Every save uploads the body to WeChat's self-check, JSON-escaped (~1.4×).
    // Measured 2026-09-30: a 6.1 MB body failed that upload intermittently,
    // a 5.9 MB one passed. Above this, an edit may become unsaveable.
    const bytes = Buffer.byteLength(html, 'utf8');
    if (bytes > WECHAT_SAFE_BODY_BYTES) {
      warnings.push(
        `WeChat: the article is ${(bytes / 1e6).toFixed(1)} MB. WeChat checks the whole body on every save, `
        + `and bodies near 6 MB fail that check intermittently — the draft then cannot be saved after an edit. `
        + `Consider splitting the article in two.`,
      );
    }

    if (/<style[\s>]/i.test(html)) {
      warnings.push('WeChat: <style> tags will be stripped by the editor');
    }

    if (/<a[^>]+target="_blank"/i.test(html)) {
      warnings.push('WeChat: target="_blank" may be ignored');
    }

    // An inlined data URI travels with the paste, so it is not an image that
    // still needs uploading. Only genuine external links are counted.
    const external = (html.match(/<img[^>]+src="(?!https:\/\/mmbiz)(?!data:)[^"]*"/gi) || []).length;
    if (external > 0) {
      warnings.push(
        `WeChat: ${external} image(s) reference an external URL. WeChat re-hosts pasted images, `
        + 'but a link that WeChat cannot fetch will appear broken.',
      );
    }

    return { valid: errors.length === 0, warnings, errors };
  }

  getMathOutput(requested) {
    // WeChat keeps inline SVG made only of <path>; PNG is the user's fallback.
    return requested || 'svg';
  }

  getCssOverrides() {
    return `
      /* WeChat mobile-friendly overrides */
      #nice {
        max-width: 100%;
        overflow-x: hidden;
        word-wrap: break-word;
        overflow-wrap: break-word;
      }
      #nice pre {
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
        max-width: 100%;
      }
      #nice img {
        max-width: 100%;
        height: auto;
      }
      #nice table {
        max-width: 100%;
        overflow-x: auto;
        display: block;
      }
    `;
  }
}
