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

  /**
   * The math output mode this platform will actually receive.
   *
   * `requested` is the user's preference. A platform whose editor accepts only
   * one form of math overrides this and ignores the request, so no preference
   * can produce output that the editor strips on paste.
   */
  getMathOutput(requested) {
    return requested || 'svg';
  }
}
