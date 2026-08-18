/**
 * AI Backend abstraction for article editing and style modification.
 *
 * Backends implement a common interface so the editor doesn't care
 * whether Claude is running locally, remotely, or via API.
 */

/**
 * Base class for AI backends.
 */
export class AIBackend {
  constructor(name) {
    this.name = name;
    this.connected = false;
  }

  /**
   * Check if the backend is available.
   */
  async isAvailable() {
    return false;
  }

  /**
   * Send a prompt with article context, receive edits.
   *
   * @param {object} request
   * @param {string} request.prompt - User instruction
   * @param {string} request.articleSource - Current article content
   * @param {string} request.articleMeta - Article metadata (JSON)
   * @param {string} request.themeCss - Current theme CSS (for style edits)
   * @param {string} request.targetScope - 'content' | 'theme' | 'metadata'
   * @param {object} request.context - Additional context
   *
   * @returns {Promise<{
   *   success: boolean,
   *   edits: Array<{ file: string, content: string, diff?: string }>,
   *   message?: string,
   *   error?: string,
   * }>}
   */
  async execute(request) {
    throw new Error(`${this.name}: execute() not implemented`);
  }
}

/**
 * Local Claude Code backend.
 * Invokes the locally installed, already-authenticated Claude Code CLI.
 */
export class LocalClaudeCodeBackend extends AIBackend {
  constructor() {
    super('LocalClaudeCode');
  }

  async isAvailable() {
    try {
      const { execSync } = await import('child_process');
      execSync('claude --version', { encoding: 'utf-8', stdio: 'pipe' });
      this.connected = true;
      return true;
    } catch {
      return false;
    }
  }

  async execute(request) {
    const { execSync } = await import('child_process');
    const { writeFileSync, readFileSync, existsSync } = await import('fs');
    const { tmpdir } = await import('os');
    const { join } = await import('path');

    const tmpDir = join(tmpdir(), `publisher-ai-${Date.now()}`);
    const { mkdirSync } = await import('fs');
    mkdirSync(tmpDir, { recursive: true });

    try {
      // Write context files
      if (request.articleSource) {
        writeFileSync(join(tmpDir, 'article.md'), request.articleSource);
      }
      if (request.themeCss) {
        writeFileSync(join(tmpDir, 'theme.css'), request.themeCss);
      }

      // Build the prompt with scope constraints
      let fullPrompt = request.prompt;
      if (request.targetScope === 'theme') {
        fullPrompt = `Edit ONLY the CSS theme file (theme.css). Do not modify article content.\n\n${request.prompt}`;
      } else if (request.targetScope === 'content') {
        fullPrompt = `Edit ONLY the article file (article.md). Do not modify CSS theme.\n\n${request.prompt}`;
      }

      // Invoke Claude Code in headless/print mode
      const result = execSync(
        `claude -p "${fullPrompt.replace(/"/g, '\\"')}"`,
        {
          cwd: tmpDir,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 120000,
        }
      );

      // Read back modified files
      const edits = [];
      if (request.articleSource && existsSync(join(tmpDir, 'article.md'))) {
        const modified = readFileSync(join(tmpDir, 'article.md'), 'utf-8');
        if (modified !== request.articleSource) {
          edits.push({ file: 'article', content: modified });
        }
      }
      if (request.themeCss && existsSync(join(tmpDir, 'theme.css'))) {
        const modified = readFileSync(join(tmpDir, 'theme.css'), 'utf-8');
        if (modified !== request.themeCss) {
          edits.push({ file: 'theme', content: modified });
        }
      }

      return { success: true, edits, message: result.trim() };
    } catch (e) {
      return { success: false, edits: [], error: e.message };
    } finally {
      try {
        const { rmSync } = await import('fs');
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {}
    }
  }
}

/**
 * Remote ClaudeClaw backend.
 * Connects to a remote Claude/ClaudeClaw worker via configurable transport.
 */
export class RemoteClaudeClawBackend extends AIBackend {
  constructor(config = {}) {
    super('RemoteClaudeClaw');
    this.host = config.host || 'localhost';
    this.port = config.port || 8822;
    this.transport = config.transport || 'http'; // 'http' | 'ssh'
  }

  async isAvailable() {
    if (this.transport === 'http') {
      try {
        const resp = await fetch(`http://${this.host}:${this.port}/health`);
        this.connected = resp.ok;
        return resp.ok;
      } catch {
        return false;
      }
    }
    // SSH transport: check if SSH connection works
    try {
      const { execSync } = await import('child_process');
      execSync(`ssh -o ConnectTimeout=3 ${this.host} echo ok`, { encoding: 'utf-8', stdio: 'pipe' });
      this.connected = true;
      return true;
    } catch {
      return false;
    }
  }

  async execute(request) {
    if (this.transport === 'http') {
      try {
        const resp = await fetch(`http://${this.host}:${this.port}/execute`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
        });
        return await resp.json();
      } catch (e) {
        return { success: false, edits: [], error: e.message };
      }
    }

    return { success: false, edits: [], error: `Transport ${this.transport} not yet implemented` };
  }
}

/**
 * Get the configured AI backend based on user preferences.
 */
export function getAIBackend(config = {}) {
  const type = config.type || 'local';
  switch (type) {
    case 'local':
      return new LocalClaudeCodeBackend();
    case 'remote':
      return new RemoteClaudeClawBackend(config);
    default:
      return new LocalClaudeCodeBackend();
  }
}
