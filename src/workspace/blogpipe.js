import { existsSync } from 'fs';
import { execSync } from 'child_process';

/**
 * Blog Pipeline integration.
 *
 * MDTeX hands off articles to the separate blog-pipeline (`blogpipe` CLI)
 * for multi-repository orchestration, GitHub sync, release creation,
 * production deployment, verification, and rollback.
 *
 * MDTeX does NOT reimplement those functions.
 */
export class BlogPipelineIntegration {
  constructor() {
    this.cliPath = null;
    this.available = false;
  }

  /**
   * Detect whether the blogpipe CLI is installed and available.
   */
  detect() {
    try {
      const version = execSync('blogpipe --version', { encoding: 'utf-8', stdio: 'pipe' }).trim();
      this.available = true;
      this.cliPath = 'blogpipe';
      return { available: true, version };
    } catch {
      // Try alternative paths
      const candidates = ['blogpipe', 'blog-pipeline', 'bp'];
      for (const cmd of candidates) {
        try {
          const version = execSync(`${cmd} --version`, { encoding: 'utf-8', stdio: 'pipe' }).trim();
          this.available = true;
          this.cliPath = cmd;
          return { available: true, version, cli: cmd };
        } catch {}
      }
      return { available: false };
    }
  }

  /**
   * Hand off an article to the blog pipeline for publication.
   *
   * @param {Article} article - The article to publish
   * @param {object} options
   * @param {string} options.htmlPath - Path to compiled HTML
   * @param {string} options.pdfPath - Path to compiled PDF (optional)
   */
  async publish(article, options = {}) {
    if (!this.available) {
      return { success: false, error: 'Blog pipeline CLI not detected. Run: blogpipe --version' };
    }

    const args = [
      'publish',
      `--source "${article.sourcePath}"`,
      `--title "${article.title}"`,
      `--id "${article.id}"`,
    ];

    if (options.htmlPath) args.push(`--html "${options.htmlPath}"`);
    if (options.pdfPath) args.push(`--pdf "${options.pdfPath}"`);
    if (article.tags.length) args.push(`--tags "${article.tags.join(',')}"`);
    if (article.series) args.push(`--series "${article.series}"`);

    try {
      const output = execSync(`${this.cliPath} ${args.join(' ')}`, {
        encoding: 'utf-8',
        stdio: 'pipe',
        timeout: 300000,
      });
      return { success: true, output: output.trim() };
    } catch (e) {
      return { success: false, error: e.stderr || e.message };
    }
  }

  /**
   * Check publication status for an article.
   */
  async status(articleId) {
    if (!this.available) return { available: false };

    try {
      const output = execSync(`${this.cliPath} status --id "${articleId}"`, {
        encoding: 'utf-8',
        stdio: 'pipe',
      });
      return { available: true, status: output.trim() };
    } catch (e) {
      return { available: true, error: e.message };
    }
  }
}
