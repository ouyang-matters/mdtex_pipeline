import { renderToHtml } from '../renderer/index.js';
import { loadTheme, resolveCssVariables } from '../themes/index.js';
import { extractImages, resolveImages } from '../images/index.js';
import { countMathExpressions } from '../math/index.js';
import { replaceKatexWithImages, MathOutput } from '../math/post-processor.js';
import { FormulaCache } from '../math/formula-cache.js';
import { inlineCss } from './css-inliner.js';
import { validate } from './validator.js';
import { htmlToPlainText } from './plain-text.js';
import { WeChatAdapter } from '../../platforms/wechat/index.js';
import { ZhihuAdapter } from '../../platforms/zhihu/index.js';

const adapters = {
  wechat: () => new WeChatAdapter(),
  zhihu: () => new ZhihuAdapter(),
};

export function listPlatforms() {
  return Object.keys(adapters);
}

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
 *
 * `compile()` reports progress through `onProgress` and can be cancelled with
 * an AbortSignal, because it is what the UI runs when the user asks for WeChat
 * output and it must never look frozen.
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
   *
   * @param {string} source
   * @param {object} options
   * @param {string} options.theme      theme name, path, or null when themeCss is given
   * @param {string} options.themeCss   pre-resolved CSS, overrides `theme`
   * @param {string} options.platform
   * @param {string} options.baseDir
   * @param {string} options.mathOutput
   * @param {AbortSignal} options.signal
   * @param {(event: {phase, message, done?, total?}) => void} options.onProgress
   */
  async compile(source, {
    theme = 'default',
    themeCss: providedCss = null,
    themeName = null,
    platform = 'wechat',
    baseDir = '.',
    mathOutput,
    signal = null,
    onProgress = null,
    includePlainText = false,
  } = {}) {
    const timings = {};
    const mark = async (phase, message, fn) => {
      onProgress?.({ phase, message });
      const t0 = Date.now();
      const value = await fn();
      timings[phase] = Date.now() - t0;
      return value;
    };

    const checkAborted = () => {
      if (signal?.aborted) {
        const e = new Error('Compilation cancelled.');
        e.name = 'AbortError';
        throw e;
      }
    };

    checkAborted();

    // Step 1: Render markdown to scoped HTML (with KaTeX)
    const rawHtml = await mark('render', 'Rendering Markdown…', () => renderToHtml(source, this.options));
    checkAborted();

    // Step 2: Load and prepare theme
    let themeData;
    let resolvedThemeCss;
    if (providedCss !== null) {
      themeData = { name: themeName || 'custom', css: providedCss, isBuiltin: false, isUser: false, path: null };
      resolvedThemeCss = resolveCssVariables(providedCss);
    } else {
      themeData = loadTheme(theme);
      resolvedThemeCss = resolveCssVariables(themeData.css);
    }

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
    const mathResult = await mark('formulas', 'Rendering formulas…', () =>
      replaceKatexWithImages(rawHtml, {
        mathOutput: effectiveMathOutput,
        cache: this.formulaCache,
        signal,
        onProgress: (p) => onProgress?.({
          phase: 'formulas',
          message: `Rendering formulas ${p.done}/${p.total}`,
          done: p.done,
          total: p.total,
        }),
      }));

    let html = mathResult.html;
    checkAborted();

    // Step 8: Append platform CSS overrides to theme
    let themeCss = resolvedThemeCss;
    if (adapter) {
      themeCss += '\n' + adapter.getCssOverrides();
    }

    // Step 9: Apply platform transformation
    html = adapter ? adapter.transform(html) : html;

    // Step 10: Inline CSS — one pass over the whole document, never per element
    html = await mark('inline', 'Inlining styles…', () => inlineCss(html, themeCss));
    checkAborted();

    // Step 11: Platform-specific sanitization
    html = adapter ? adapter.sanitize(html) : html;

    // Step 12: Validate (includes formula count checks)
    const validation = await mark('validate', 'Validating…', () => validate(html, source, {
      platform,
      images,
      mathResult: mathResult.stats,
    }));

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

    const plainText = includePlainText ? htmlToPlainText(html) : undefined;

    return {
      html,
      plainText,
      rawHtml,
      theme: themeData,
      images,
      mathStats,
      mathResult: mathResult.stats,
      validation,
      platform,
      mathOutput: effectiveMathOutput,
      timings,
    };
  }
}
