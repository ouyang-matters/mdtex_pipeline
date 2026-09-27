import { spawnNative, killTree } from '../../core/exec/run.js';

/**
 * Signing Claude Code in from the browser.
 *
 * `claude auth login` without a terminal opens the system browser, prints the
 * same sign-in URL on stdout, and then waits for the code that Claude's
 * callback page shows after the user approves access. This drives exactly that
 * command — MDTeX never sees the user's credentials, only the one-time code the
 * user chooses to paste, which goes straight to the CLI's stdin.
 *
 * Success is the CLI's own verdict (its exit status). Whether the resulting
 * sign-in actually works is then decided the same way as any other connection:
 * by the round-trip test in LocalClaudeCodeBackend.
 */

export const SIGN_IN_COMMAND = 'claude auth login';

/** Hosts a sign-in link may point at. Anything else is not offered as a link. */
const SIGN_IN_HOSTS = /(^|\.)(claude\.com|claude\.ai|anthropic\.com)$/i;

export function findSignInUrl(text) {
  for (const match of String(text).matchAll(/https:\/\/[^\s"'<>]+/g)) {
    try {
      const url = new URL(match[0]);
      if (SIGN_IN_HOSTS.test(url.hostname) && /oauth|authorize|login/i.test(url.pathname)) return url.href;
    } catch { /* not a URL */ }
  }
  return null;
}

export class ClaudeSignIn {
  /**
   * @param {object} options
   * @param {string} options.cli        the claude executable
   * @param {string[]} [options.args]   overridable for tests
   * @param {number} [options.lifetime] the whole attempt is abandoned after this
   */
  constructor({ cli, args = ['auth', 'login', '--claudeai'], env = process.env, cwd = process.cwd(), lifetime = 10 * 60 * 1000 }) {
    this.cli = cli;
    this.args = args;
    this.env = env;
    this.cwd = cwd;
    this.lifetime = lifetime;
    this.state = 'idle';
    this.url = null;
    this.output = '';
    this.exit = null;
    this.child = null;
    this.exited = null;
  }

  /**
   * Start the CLI and wait until it has printed the sign-in URL — or exited,
   * or stayed silent for `urlTimeout`.
   *
   * @returns {Promise<{ state, url, detail }>}
   */
  async start({ urlTimeout = 20000 } = {}) {
    this.state = 'starting';
    try {
      this.child = spawnNative(this.cli, this.args, { cwd: this.cwd, env: this.env });
    } catch (e) {
      this.state = 'failed';
      return this.describe(`Could not start ${SIGN_IN_COMMAND}: ${e.message}`);
    }

    this.exited = new Promise((resolve) => {
      this.child.on('error', (e) => { this.output += `\n${e.message}`; });
      this.child.on('close', (code) => {
        this.exit = code;
        if (this.state !== 'cancelled') this.state = code === 0 ? 'succeeded' : 'failed';
        clearTimeout(this.expiry);
        resolve(code);
      });
    });

    let onUrl;
    const urlSeen = new Promise((resolve) => { onUrl = resolve; });
    const collect = (chunk) => {
      this.output += chunk;
      if (!this.url) {
        this.url = findSignInUrl(this.output);
        if (this.url) onUrl();
      }
    };
    this.child.stdout.setEncoding('utf-8');
    this.child.stderr.setEncoding('utf-8');
    this.child.stdout.on('data', collect);
    this.child.stderr.on('data', collect);

    this.expiry = setTimeout(() => this.cancel(), this.lifetime);
    this.expiry.unref?.();

    await Promise.race([urlSeen, this.exited, delay(urlTimeout)]);
    if (this.state === 'starting') this.state = this.url ? 'waiting-for-code' : 'failed';
    if (this.state === 'failed' && this.exit === null) killTree(this.child);
    return this.describe(this.url ? '' : this.lastLines() || `${SIGN_IN_COMMAND} did not print a sign-in link.`);
  }

  /**
   * Hand the code from Claude's callback page to the CLI and wait for its
   * verdict.
   *
   * @returns {Promise<{ state, url, detail }>}
   */
  async submitCode(code, { timeout = 60000 } = {}) {
    const value = String(code ?? '').trim();
    if (!value || /[\r\n]/.test(value) || value.length > 4096) {
      return this.describe('That does not look like a sign-in code.');
    }
    if (this.state !== 'waiting-for-code') {
      return this.describe(`This sign-in is ${this.state}; start again.`);
    }

    this.state = 'verifying';
    const before = this.output.length;
    this.child.stdin.write(`${value}\n`);

    const finished = await Promise.race([this.exited.then(() => true), delay(timeout).then(() => false)]);
    if (!finished) {
      this.cancel();
      return this.describe(`${SIGN_IN_COMMAND} did not finish. Run it in a terminal instead.`);
    }
    return this.describe(this.state === 'succeeded' ? '' : this.lastLines(this.output.slice(before)));
  }

  cancel() {
    if (this.exit !== null || !this.child) return;
    this.state = 'cancelled';
    killTree(this.child);
  }

  lastLines(text = this.output) {
    return String(text).trim().split('\n').slice(-3).join(' ');
  }

  describe(detail = '') {
    return { state: this.state, url: this.url, command: SIGN_IN_COMMAND, detail };
  }
}

function delay(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms).unref?.(); });
}
