import { join } from 'path';
import { homedir } from 'os';
import { existsSync, readdirSync } from 'fs';
import { AiBackend, BACKEND_TYPES } from './base.js';
import { resolveExecutable } from '../../core/exec/which.js';
import { runCommand, probeVersion } from '../../core/exec/run.js';
import { paths } from '../../core/paths.js';

/**
 * Local Claude Code backend.
 *
 * Uses the `claude` CLI that is already installed and authenticated on this
 * machine — no credentials to enter, nothing stored by MDTeX.
 *
 * Claude Code runs its own agent loop, so instead of MDTeX driving the loop we
 * hand it the MDTeX tool layer as a stdio MCP server (src/ai/mcp-bridge.js) and
 * restrict it to those tools. The agent therefore has exactly the same
 * capabilities as the API-driven backends, and every write still goes through
 * MDTeX's permissions, validation, diff and checkpoint machinery.
 */

/** Extra locations to look for the CLI when it is not on PATH. */
function extraClaudeDirs() {
  const home = homedir();
  const dirs = [
    join(home, '.local', 'bin'),
    join(home, 'bin'),
    join(home, '.claude', 'local'),
    '/usr/local/bin',
    '/opt/homebrew/bin',
  ];

  // nvm installs put the CLI under a version directory that is only on PATH
  // inside an interactive shell.
  const nvmDir = process.env.NVM_DIR || join(home, '.nvm');
  const versionsDir = join(nvmDir, 'versions', 'node');
  if (existsSync(versionsDir)) {
    try {
      for (const version of readdirSync(versionsDir)) {
        dirs.push(join(versionsDir, version, 'bin'));
      }
    } catch { /* fall through */ }
  }

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA;
    if (appData) dirs.push(join(appData, 'npm'));
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData) dirs.push(join(localAppData, 'Programs', 'claude'));
  }

  return dirs;
}

/**
 * Claude Code's own filesystem and network tools are switched off: the agent
 * reaches the article only through the MDTeX MCP bridge, which enforces
 * MDTeX's permissions, validation, diffs and checkpoints.
 *
 * Comma-separated rather than space-separated, because these options are
 * variadic and a space-separated list would keep consuming later arguments.
 */
const DISALLOWED_TOOLS = 'Bash,Edit,Write,Read,Glob,Grep,NotebookEdit,WebFetch,WebSearch';

export function findClaudeCli() {
  return resolveExecutable('claude', { extraDirs: extraClaudeDirs() });
}

/** What the CLI says when it has no usable sign-in, in its various wordings. */
const AUTH_FAILURE = /failed to authenticate|not logged in|please run \/login|invalid api key|oauth (access )?token|authentication_error|invalid bearer token/i;

/**
 * Read the outcome of a `claude --print --output-format json` round trip.
 *
 * The exit code alone is not the answer: the CLI can exit 0 and still report
 * `is_error: true` — an expired sign-in does exactly that — so a failed call
 * must never be read as a connection. An authentication failure is told apart
 * from other failures because it has a remedy the user can act on: signing in.
 *
 * @returns {{ ok: boolean, authFailure: boolean, reply: string, detail: string }}
 */
export function classifyProbe({ code, stdout = '', stderr = '', timedOut = false, spawnError = null } = {}) {
  let parsed = null;
  try { parsed = JSON.parse(String(stdout).trim()); } catch { /* not JSON */ }

  const text = parsed && typeof parsed === 'object'
    ? String(parsed.result ?? parsed.text ?? '')
    : String(stdout).trim();
  const failed = Boolean(spawnError) || timedOut || code !== 0 || parsed?.is_error === true;

  if (!failed) return { ok: true, authFailure: false, reply: text, detail: '' };

  const detail = (parsed && text) || (String(stderr) || String(stdout)).trim().split('\n').slice(-3).join(' ');
  const status = Number(parsed?.api_error_status);
  const authFailure = !timedOut && !spawnError
    && (status === 401 || status === 403 || AUTH_FAILURE.test(`${detail}\n${stderr}`));

  return { ok: false, authFailure, reply: '', detail: timedOut ? 'The test call timed out.' : detail };
}

export class LocalClaudeCodeBackend extends AiBackend {
  constructor(profile = {}) {
    super({ ...profile, type: BACKEND_TYPES.LOCAL_CLAUDE });
    this.model = profile.model || null;          // null = whatever the CLI defaults to
    this.effort = profile.effort || null;
    this.cliPath = profile.cliPath || null;
    this.timeout = profile.timeout || 15 * 60 * 1000;
  }

  resolveCli() {
    if (this.cliPath && existsSync(this.cliPath)) return this.cliPath;
    return findClaudeCli();
  }

  describe() {
    return {
      id: this.id,
      type: this.type,
      name: this.name,
      cliPath: this.resolveCli(),
      model: this.model || 'CLI default',
    };
  }

  async testConnection({ signal } = {}) {
    const cli = this.resolveCli();
    if (!cli) {
      return {
        ok: false,
        error: 'The `claude` command was not found. Install Claude Code, or point MDTeX at the binary in AI settings.',
        remedy: 'install-claude-code',
      };
    }

    const version = await probeVersion(cli, ['--version'], { timeout: 15000 });
    if (version === null) {
      return { ok: false, error: `Found ${cli} but it could not be run.` };
    }

    // A trivial print-mode round trip proves the CLI is authenticated, which
    // `--version` alone does not.
    //
    // The prompt goes over stdin, not as an argument: the CLI's tool-list
    // options are variadic, so a trailing positional would be swallowed into
    // the tool list and the CLI would report a missing prompt.
    const probe = await runCommand(cli, [
      '--print',
      '--output-format', 'json',
      '--no-session-persistence',
      '--disallowed-tools', DISALLOWED_TOOLS,
    ], {
      timeout: 90000,
      signal,
      cwd: paths.appRoot,
      input: 'Reply with the single word: ready',
    });

    const outcome = classifyProbe(probe);

    if (outcome.authFailure) {
      return {
        ok: false,
        error: `Claude Code is installed (${version}) but is not signed in, or its sign-in has expired.`,
        detail: outcome.detail,
        remedy: 'sign-in-claude-code',
        version,
      };
    }

    if (!outcome.ok) {
      return {
        ok: false,
        error: `Claude Code is installed (${version}) but the test call failed. ${outcome.detail}`.trim(),
        version,
      };
    }

    const reply = outcome.reply;

    return {
      ok: true,
      detail: `Using ${version}`,
      version,
      cliPath: cli,
      reply: String(reply).slice(0, 40),
    };
  }

  /**
   * Run an agent turn through the CLI, with MDTeX tools bridged over MCP.
   *
   * `bridge` carries what the MCP server needs to call back into this backend:
   * { apiUrl, token, runId }.
   */
  async run({ systemPrompt, messages, signal, bridge, onText, onToolUse }) {
    const cli = this.resolveCli();
    if (!cli) return { ok: false, error: 'The `claude` command was not found.', turns: 0, text: '' };
    if (!bridge?.apiUrl || !bridge?.token || !bridge?.runId) {
      return { ok: false, error: 'Internal error: the MDTeX tool bridge was not configured.', turns: 0, text: '' };
    }

    const bridgeScript = join(paths.appRoot, 'src', 'ai', 'mcp-bridge.js');
    const mcpConfig = JSON.stringify({
      mcpServers: {
        mdtex: {
          command: process.execPath,
          args: [bridgeScript],
          env: {
            MDTEX_API_URL: bridge.apiUrl,
            MDTEX_TOKEN: bridge.token,
            MDTEX_RUN_ID: bridge.runId,
          },
        },
      },
    });

    // Flatten the conversation: the CLI takes a single prompt.
    const prompt = messages
      .map(m => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
      .join('\n\n');

    // The prompt goes over stdin rather than as a positional argument: the
    // CLI's --allowedTools / --disallowed-tools options are variadic and would
    // otherwise absorb it into the tool list.
    const args = [
      '--print',
      '--output-format', 'stream-json',
      '--verbose',
      '--no-session-persistence',
      '--mcp-config', mcpConfig,
      '--strict-mcp-config',
      // Only MDTeX tools. Claude Code's own filesystem tools stay off so the
      // agent cannot reach outside the article it was given.
      '--allowedTools', 'mcp__mdtex',
      '--disallowed-tools', DISALLOWED_TOOLS,
      '--permission-mode', 'acceptEdits',
      '--append-system-prompt', systemPrompt,
    ];

    if (this.model) args.push('--model', this.model);
    if (this.effort) args.push('--effort', this.effort);

    let finalText = '';
    let turns = 0;
    let buffer = '';
    let resultEvent = null;

    const result = await runCommand(cli, args, {
      cwd: paths.appRoot,
      timeout: this.timeout,
      signal,
      input: prompt,
      onOutput: (chunk, stream) => {
        if (stream !== 'stdout') return;
        buffer += chunk;
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          let event;
          try { event = JSON.parse(line); } catch { continue; }

          if (event.type === 'assistant' && event.message?.content) {
            turns++;
            for (const block of event.message.content) {
              if (block.type === 'text' && block.text) {
                finalText = block.text;
                onText?.(block.text);
              } else if (block.type === 'tool_use') {
                // Only MDTeX tools are reported. The CLI has internal tools of
                // its own (tool discovery, for instance) that mean nothing to a
                // writer looking at what happened to their article.
                const name = String(block.name);
                if (name.startsWith('mcp__mdtex__')) {
                  onToolUse?.(name.slice('mcp__mdtex__'.length), block.input);
                }
              }
            }
          } else if (event.type === 'result') {
            resultEvent = event;
            if (event.result) finalText = event.result;
          }
        }
      },
    });

    if (result.aborted) return { ok: false, error: 'Cancelled.', turns, text: finalText };
    if (result.spawnError) return { ok: false, error: `Could not run ${cli}: ${result.spawnError.message}`, turns, text: finalText };
    if (result.timedOut) return { ok: false, error: 'Claude Code timed out.', turns, text: finalText };

    // The final line may arrive without a trailing newline.
    if (buffer.trim()) {
      try {
        const event = JSON.parse(buffer);
        if (event.type === 'result') resultEvent = event;
      } catch { /* not an event */ }
    }

    // Judged like the connection test: a result that says is_error is a failure
    // whatever the exit code, and a sign-in failure says how to fix it.
    const outcome = classifyProbe({
      code: result.code,
      stdout: resultEvent ? JSON.stringify(resultEvent) : '',
      stderr: result.stderr,
    });
    if (outcome.authFailure) {
      return {
        ok: false,
        error: 'Claude Code is not signed in, or its sign-in has expired.',
        remedy: 'sign-in-claude-code',
        turns,
        text: '',
      };
    }
    if (!outcome.ok) {
      return { ok: false, error: outcome.detail || `Claude Code exited with code ${result.code}.`, turns, text: finalText };
    }

    return { ok: true, text: finalText, turns };
  }
}
