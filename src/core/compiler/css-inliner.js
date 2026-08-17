import juice from 'juice';

/**
 * Inline CSS styles into HTML elements.
 * Uses juice for proper CSS specificity handling.
 */
export function inlineCss(html, css) {
  // Wrap HTML with style tag for juice to process
  const fullHtml = `<style>${css}</style>\n${html}`;

  const result = juice(fullHtml, {
    removeStyleTags: true,
    preserveMediaQueries: false,
    preserveFontFaces: false,
    preserveKeyFrames: false,
    preserveImportant: false,
    applyStyleTags: true,
    insertPreservedExtraCss: false,
    resolveCSSVariables: true,
    inlinePseudoElements: true,
    applyWidthAttributes: false,
    applyHeightAttributes: false,
    applyAttributesTableElements: false,
  });

  return result;
}
