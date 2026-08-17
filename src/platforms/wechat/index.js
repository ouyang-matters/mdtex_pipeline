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
 * - Images must be uploaded to WeChat CDN (Phase 2)
 * - Links open in WeChat browser
 * - Max content width ~100vw mobile
 * - KaTeX HTML may partially work but SVG/images are safer
 */
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
    // Keep data- attributes for potential debugging
    result = result.replace(/\s+class="[^"]*"/gi, '');

    // Remove id attributes except the root #nice
    result = result.replace(/(<(?!section)[^>]*)\s+id="(?!nice)[^"]*"/gi, '$1');

    return result;
  }

  validate(html) {
    const warnings = [];
    const errors = [];

    if (/<style[\s>]/i.test(html)) {
      warnings.push('WeChat: <style> tags will be stripped by the editor');
    }

    if (/<a[^>]+target="_blank"/i.test(html)) {
      warnings.push('WeChat: target="_blank" may be ignored');
    }

    const imgCount = (html.match(/<img[^>]+src="(?!https:\/\/mmbiz)/gi) || []).length;
    if (imgCount > 0) {
      warnings.push(`WeChat: ${imgCount} image(s) not on WeChat CDN - will need manual upload`);
    }

    return { valid: errors.length === 0, warnings, errors };
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
