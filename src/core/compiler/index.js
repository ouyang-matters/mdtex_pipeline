import { renderToHtml } from '../renderer/index.js';
import { loadTheme, resolveCssVariables } from '../themes/index.js';
import { extractImages, resolveImages } from '../images/index.js';
import { countMathExpressions } from '../math/index.js';
import { inlineCss } from './css-inliner.js';
import { validate } from './validator.js';
import { WeChatAdapter } from '../../platforms/wechat/index.js';
import { ZhihuAdapter } from '../../platforms/zhihu/index.js';

const adapters = {
  wechat: () => new WeChatAdapter(),
  zhihu: () => new ZhihuAdapter(),
};

/**
 * Core compilation pipeline.
 *
 * Markdown source
 *   -> Markdown parser
 *   -> Internal HTML (scoped under #nice)
 *   -> Math / code / image processing
 *   -> Theme CSS
 *   -> Platform adapter
 *   -> CSS inlining + sanitization
 *   -> Preview / Clipboard / Export HTML
 */
export class Compiler {
  constructor(options = {}) {
    this.options = options;
  }

  compile(source, { theme = 'default', platform = 'wechat', baseDir = '.' } = {}) {
    // Step 1: Render markdown to scoped HTML
    const rawHtml = renderToHtml(source, this.options);

    // Step 2: Load and prepare theme
    const themeData = loadTheme(theme);
    let themeCss = resolveCssVariables(themeData.css);

    // Step 3: Extract and analyze images
    const images = extractImages(rawHtml);
    resolveImages(images, baseDir);

    // Step 4: Count math expressions
    const mathStats = countMathExpressions(source);

    // Step 5: Get platform adapter
    const adapter = adapters[platform] ? adapters[platform]() : null;

    // Step 6: Append platform CSS overrides to theme
    if (adapter) {
      themeCss += '\n' + adapter.getCssOverrides();
    }

    // Step 7: Apply platform transformation
    let html = adapter ? adapter.transform(rawHtml) : rawHtml;

    // Step 8: Inline CSS
    html = inlineCss(html, themeCss);

    // Step 9: Platform-specific sanitization
    html = adapter ? adapter.sanitize(html) : html;

    // Step 10: Validate
    const validation = validate(html, source, { platform, images });

    // Merge platform-specific validation
    if (adapter) {
      const platformValidation = adapter.validate(html);
      validation.warnings.push(...platformValidation.warnings);
      validation.errors.push(...platformValidation.errors);
      if (!platformValidation.valid) validation.valid = false;
    }

    return {
      html,
      rawHtml,
      theme: themeData,
      images,
      mathStats,
      validation,
      platform,
    };
  }
}
