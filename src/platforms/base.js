/**
 * Base platform adapter interface.
 * All platform adapters must implement these methods.
 */
export class PlatformAdapter {
  constructor(name) {
    this.name = name;
  }

  /**
   * Apply platform-specific transformations to HTML.
   */
  transform(html) {
    return html;
  }

  /**
   * Sanitize HTML for the target platform.
   * Remove elements/attributes that won't survive the platform editor.
   */
  sanitize(html) {
    return html;
  }

  /**
   * Validate HTML against platform-specific constraints.
   */
  validate(html) {
    return { valid: true, warnings: [], errors: [] };
  }

  /**
   * Get platform-specific CSS overrides.
   */
  getCssOverrides() {
    return '';
  }
}
