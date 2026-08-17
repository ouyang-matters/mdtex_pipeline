/**
 * Validation pass for compiled HTML.
 * Checks for common issues before copy/export.
 */
export function validate(html, source, { platform = 'wechat', images = [] } = {}) {
  const warnings = [];
  const errors = [];
  const stats = {};

  // Count elements from HTML
  stats.paragraphs = (html.match(/<p[\s>]/g) || []).length;
  stats.headings = (html.match(/<h[1-6][\s>]/g) || []).length;
  stats.tables = (html.match(/<table[\s>]/g) || []).length;
  stats.links = (html.match(/<a[\s>]/g) || []).length;
  stats.images = images.length;

  // Count code blocks from source (survives sanitization that strips classes)
  stats.codeBlocks = (source.match(/^```/gm) || []).length / 2;
  stats.codeBlocks = Math.max(0, Math.floor(stats.codeBlocks));
  // Also check indented code blocks
  if (stats.codeBlocks === 0) {
    stats.codeBlocks = (html.match(/<pre[\s>]/g) || []).length;
  }

  // Count math from source
  const displayMath = (source.match(/\$\$([\s\S]+?)\$\$/g) || []).length;
  const allDollar = (source.match(/\$([^$\n]+?)\$/g) || []).length;
  stats.mathDisplay = displayMath;
  stats.mathInline = allDollar;
  stats.mathTotal = displayMath + allDollar;

  // Check for KaTeX errors
  const katexErrors = html.match(/class="katex-error"/g) || [];
  const mathErrors = html.match(/class="math-error"/g) || [];
  if (katexErrors.length > 0 || mathErrors.length > 0) {
    const count = katexErrors.length + mathErrors.length;
    errors.push(`${count} math expression(s) failed to render`);
  }

  // Check images
  for (const img of images) {
    if (!img.src || img.src.trim() === '') {
      errors.push('Empty image src detected');
    } else if (img.isLocal && !img.exists) {
      errors.push(`Local image not found: ${img.src}`);
    } else if (img.isLocal && img.needsUpload) {
      warnings.push(`Image "${img.src}" uses a local path and will require upload`);
    }
  }

  // Check for dangerous HTML
  if (/<script[\s>]/i.test(html)) {
    errors.push('Script tags detected in output');
  }
  if (/<iframe[\s>]/i.test(html)) {
    errors.push('Iframe tags detected in output');
  }
  if (/on\w+\s*=/i.test(html)) {
    warnings.push('Possible inline event handlers detected');
  }

  // Check for remaining external stylesheets
  if (/<link[^>]+rel="stylesheet"/i.test(html)) {
    warnings.push('External stylesheet reference will not survive platform editor');
  }
  if (/<style[\s>]/i.test(html)) {
    warnings.push('Remaining <style> tag may not survive platform editor');
  }

  // Check for unresolved CSS variables
  if (/var\(--[\w-]+\)/.test(html)) {
    warnings.push('Unresolved CSS variable(s) found in inline styles');
  }

  // Platform-specific checks
  if (platform === 'wechat') {
    // WeChat strips certain attributes/elements
    if (/<video[\s>]/i.test(html)) {
      warnings.push('Video elements are not supported in WeChat articles');
    }
    if (/<audio[\s>]/i.test(html)) {
      warnings.push('Audio elements are not supported in WeChat articles');
    }
    // Check for potential horizontal overflow
    if (/<pre[^>]*style="[^"]*width\s*:\s*\d{4,}px/i.test(html)) {
      warnings.push('Code block may cause horizontal overflow on mobile');
    }
  }

  if (platform === 'zhihu') {
    if (/<details[\s>]/i.test(html)) {
      warnings.push('Details/summary elements may not work on Zhihu');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    stats,
  };
}
