import Anthropic from '@anthropic-ai/sdk';
import { AiBackend, BACKEND_TYPES } from './base.js';
import { getSecret } from '../../core/config/secrets.js';

/**
 * Anthropic Messages API backend.
 *
 * Runs the agentic tool loop inside MDTeX: every turn is a Messages request
 * carrying the MDTeX tool definitions, and every `tool_use` block is executed
 * by the shared ToolExecutor. That is what keeps checkpoints, permissions,
 * validation and diffs identical to the other backends.
 *
 * The API key never leaves the backend process — the UI only ever sees a
 * fingerprint (see core/config/secrets.js).
 */

export const DEFAULT_MODEL = 'claude-opus-5';

export const SELECTABLE_MODELS = [
  { id: 'claude-opus-5', label: 'Claude Opus 5', note: 'Best default for editing and layout work.' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', note: 'Faster and cheaper for routine edits.' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', note: 'Fastest; best for small mechanical changes.' },
];

export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];

export class AnthropicApiBackend extends AiBackend {
  constructor(profile = {}) {
    super({ ...profile, type: profile.type || BACKEND_TYPES.ANTHROPIC_API });
    this.model = profile.model || DEFAULT_MODEL;
    this.effort = EFFORT_LEVELS.includes(profile.effort) ? profile.effort : 'high';
    this.maxTokens = profile.maxTokens || 32000;
    this.secretKey = profile.secretKey || 'ANTHROPIC_API_KEY';
    this.baseURL = profile.baseURL || null;
    this.extraHeaders = profile.headers || {};
  }

  /** Build a client. Throws with a clear message when no key is configured. */
  _client() {
    const apiKey = getSecret(this.secretKey);
    if (!apiKey && !this.baseURL) {
      throw new Error(`No API key stored for ${this.secretKey}. Add one in AI settings.`);
    }
    const options = { maxRetries: 2 };
    if (apiKey) options.apiKey = apiKey;
    if (this.baseURL) options.baseURL = this.baseURL;
    if (Object.keys(this.extraHeaders).length) options.defaultHeaders = this.extraHeaders;
    return new Anthropic(options);
  }

  describe() {
    return {
      id: this.id,
      type: this.type,
      name: this.name,
      model: this.model,
      effort: this.effort,
      endpoint: this.baseURL || 'https://api.anthropic.com',
    };
  }

  async testConnection({ signal } = {}) {
    let client;
    try {
      client = this._client();
    } catch (e) {
      return { ok: false, error: e.message };
    }

    try {
      // A one-token round trip proves credentials, network and model access
      // without spending a meaningful amount.
      const response = await client.messages.create({
        model: this.model,
        max_tokens: 16,
        messages: [{ role: 'user', content: 'Reply with the single word: ready' }],
      }, { signal });

      const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
      return {
        ok: true,
        detail: `Connected to ${response.model}`,
        model: response.model,
        reply: text.slice(0, 40),
        usage: { input: response.usage.input_tokens, output: response.usage.output_tokens },
      };
    } catch (e) {
      return { ok: false, error: describeApiError(e) };
    }
  }

  async run({ systemPrompt, messages, tools, onToolCall, onText, onToolUse, signal, maxTurns = 12 }) {
    const client = this._client();
    const history = [...messages];
    let turns = 0;
    let finalText = '';
    const usage = { input: 0, output: 0 };

    while (turns < maxTurns) {
      if (signal?.aborted) return { ok: false, error: 'Cancelled.', turns, text: finalText };
      turns++;

      const request = {
        model: this.model,
        max_tokens: this.maxTokens,
        system: systemPrompt,
        messages: history,
        // Adaptive thinking with an explicit effort level: MDTeX edits are
        // small and well specified, so `high` is the useful default.
        thinking: { type: 'adaptive' },
        output_config: { effort: this.effort },
      };
      if (tools?.length) request.tools = tools;

      let message;
      try {
        // Streaming keeps long turns from hitting the SDK's HTTP timeout and
        // lets the UI show text as it arrives.
        const stream = client.messages.stream(request, { signal });
        stream.on('text', (delta) => { onText?.(delta); });
        message = await stream.finalMessage();
      } catch (e) {
        if (signal?.aborted) return { ok: false, error: 'Cancelled.', turns, text: finalText };
        return { ok: false, error: describeApiError(e), turns, text: finalText };
      }

      usage.input += message.usage?.input_tokens || 0;
      usage.output += message.usage?.output_tokens || 0;

      const text = message.content.filter(b => b.type === 'text').map(b => b.text).join('');
      if (text) finalText = text;

      if (message.stop_reason === 'refusal') {
        return {
          ok: false,
          turns,
          text: finalText,
          usage,
          error: `The model declined this request${message.stop_details?.category ? ` (${message.stop_details.category})` : ''}.`,
        };
      }

      if (message.stop_reason === 'pause_turn') {
        history.push({ role: 'assistant', content: message.content });
        continue;
      }

      if (message.stop_reason !== 'tool_use') {
        return { ok: true, text: finalText, turns, usage };
      }

      const toolUseBlocks = message.content.filter(b => b.type === 'tool_use');
      history.push({ role: 'assistant', content: message.content });

      const results = [];
      for (const block of toolUseBlocks) {
        onToolUse?.(block.name, block.input);
        const result = await onToolCall(block.name, block.input);
        results.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(result ?? {}),
          is_error: Boolean(result?.error),
        });
      }

      // All results for one assistant turn go back in a single user message.
      history.push({ role: 'user', content: results });
    }

    return { ok: true, text: finalText, turns, usage, truncated: true };
  }
}

export function describeApiError(error) {
  if (error instanceof Anthropic.AuthenticationError) {
    return 'Authentication failed — the stored API key was rejected.';
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return 'This API key does not have access to the selected model.';
  }
  if (error instanceof Anthropic.NotFoundError) {
    return 'Model not found. Pick a different model in AI settings.';
  }
  if (error instanceof Anthropic.RateLimitError) {
    return 'Rate limited. Wait a moment and try again.';
  }
  if (error instanceof Anthropic.BadRequestError) {
    return `Request rejected: ${error.message}`;
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return `Could not reach the endpoint: ${error.message}`;
  }
  if (error instanceof Anthropic.APIError) {
    return `API error ${error.status}: ${error.message}`;
  }
  return error?.message || String(error);
}
