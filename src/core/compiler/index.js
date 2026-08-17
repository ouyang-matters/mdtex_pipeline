import { renderToHtml } from '../renderer/index.js';
import { loadTheme, resolveCssVariables } from '../themes/index.js';
import { extractImages, resolveImages } from '../images/index.js';
import { countMathExpressions } from '../math/index.js';
import { replaceKatexWithImages, MathOutput } from '../math/post-processor.js';
import { FormulaCache } from '../math/formula-cache.js';
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
 *   -> Markdown parser (KaTeX for preview-quality HTML)
 *   -> Scoped HTML under #nice
 *   -> [Publish mode] Replace KaTeX math with SVG/PNG assets
 *   -> Theme CSS
 *   -> Platform adapter transforms
 *   -> CSS inlining + sanitization
 *   -> Validation
 *   -> Preview / Clipboard / Export HTML
 */
export class Compiler {
  constructor(options = {}) {
    this.options = options;
    this.formulaCache = new FormulaCache();
  }

  /**
   * Compile for preview (synchronous, KaTeX HTML math).
   */
  compilePreview(source, { theme = 'default', platform = 'wechat', baseDir = '.' } = {}) {
    const rawHtml = renderToHtml(source, this.options);
    const themeData = loadTheme(theme);
    const themeCss = resolveCssVariables(themeData.css);
    const mathStats = countMathExpressions(source);

    return { html: rawHtml, themeCss, theme: themeData, mathStats, platform };
  }

  /**
   * Compile for publishing (async — renders math to SVG/PNG assets).
   */
  async compile(source, { theme = 'default', platform = 'wechat', baseDir = '.', mathOutput } = {}) {
    // Step 1: Render markdown to scoped HTML (with KaTeX)
    const rawHtml = renderToHtml(source, this.options);

    // Step 2: Load and prepare theme
    const themeData = loadTheme(theme);
    let themeCss = resolveCssVariables(themeData.css);

    // Step 3: Extract and analyze images
    const images = extractImages(rawHtml);
    resolveImages(images, baseDir);

    // Step 4: Count math expressions from source
    const mathStats = countMathExpressions(source);

    // Step 5: Get platform adapter
    const adapter = adapters[platform] ? adapters[platform]() : null;

    // Step 6: Determine math output mode
    const effectiveMathOutput = mathOutput
      || (adapter ? adapter.getMathOutput() : MathOutput.SVG);

    // Step 7: Replace KaTeX math with publishing assets
    const mathResult = await replaceKatexWithImages(rawHtml, {
      mathOutput: effectiveMathOutput,
      cache: this.formulaCache,
    });

    let html = mathResult.html;

    // Step 8: Append platform CSS overrides to theme
    if (adapter) {
      themeCss += '\n' + adapter.getCssOverrides();
    }

    // Step 9: Apply platform transformation
    html = adapter ? adapter.transform(html) : html;

    // Step 10: Inline CSS
    html = inlineCss(html, themeCss);

    // Step 11: Platform-specific sanitization
    html = adapter ? adapter.sanitize(html) : html;

    // Step 12: Validate (includes formula count checks)
    const validation = validate(html, source, {
      platform,
      images,
      mathResult: mathResult.stats,
    });

    // Add math rendering errors
    for (const e of mathResult.errors) {
      validation.errors.push(e);
      validation.valid = false;
    }

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
      mathResult: mathResult.stats,
      validation,
      platform,
      mathOutput: effectiveMathOutput,
    };
  }
}
