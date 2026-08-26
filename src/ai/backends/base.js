/**
 * AI backend interface.
 *
 * A backend is only responsible for *reaching a model*. It knows nothing about
 * the editor, the article, or MDTeX's state — the tool layer (src/ai/tools.js)
 * owns all of that. That separation is what lets Local Claude Code, Remote
 * ClaudeClaw and the Anthropic API offer exactly the same editing capabilities.
 */

export class AiBackend {
  /**
   * @param {object} profile  persisted connection profile
   */
  constructor(profile = {}) {
    this.profile = profile;
    this.id = profile.id || profile.type;
    this.type = profile.type;
    this.name = profile.name || profile.type;
  }

  /** Human-facing description of where this backend runs. */
  describe() {
    return { id: this.id, type: this.type, name: this.name };
  }

  /**
   * Check that the backend can be reached.
   * @returns {Promise<{ ok, detail, version?, model?, error? }>}
   */
  async testConnection() {
    return { ok: false, error: `${this.type}: testConnection() not implemented` };
  }

  /**
   * Run an agent turn.
   *
   * @param {object} request
   * @param {string} request.systemPrompt
   * @param {Array<{role, content}>} request.messages
   * @param {Array} request.tools           tool definitions (Anthropic shape)
   * @param {(name, input) => Promise<any>} request.onToolCall
   * @param {(text) => void} request.onText  streaming assistant text
   * @param {AbortSignal} request.signal
   * @param {number} request.maxTurns
   * @returns {Promise<{ ok, text, turns, usage?, error? }>}
   */
  async run(request) {
    throw new Error(`${this.type}: run() not implemented`);
  }
}

/** Backend types the UI can offer. */
export const BACKEND_TYPES = {
  LOCAL_CLAUDE: 'local-claude',
  REMOTE_CLAUDECLAW: 'remote-claudeclaw',
  ANTHROPIC_API: 'anthropic-api',
};

export const BACKEND_LABELS = {
  [BACKEND_TYPES.LOCAL_CLAUDE]: 'Local Claude Code',
  [BACKEND_TYPES.REMOTE_CLAUDECLAW]: 'Remote ClaudeClaw',
  [BACKEND_TYPES.ANTHROPIC_API]: 'Anthropic API',
};
