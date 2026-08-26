import { spawn } from 'child_process';
import { AnthropicApiBackend } from './anthropic.js';
import { BACKEND_TYPES } from './base.js';
import { resolveExecutable } from '../../core/exec/which.js';
import { getSecret } from '../../core/config/secrets.js';

/**
 * Remote ClaudeClaw backend.
 *
 * A ClaudeClaw worker exposes an Anthropic-compatible Messages endpoint, so the
 * agent loop, tool definitions and result handling are exactly the same as the
 * direct Anthropic backend — only the transport differs. That is deliberate:
 * the requirement is that every backend offers the same logical editing
 * capabilities, and sharing the loop is the only way to guarantee it.
 *
 * Two transports:
 *   http — talk to the endpoint directly
 *   ssh  — MDTeX opens `ssh -N -L <local>:<remote host:port> <user@host>` and
 *          then talks HTTP over the tunnel, so a worker bound to loopback on a
 *          remote machine is reachable without exposing it to the network
 */

export class RemoteClaudeClawBackend extends AnthropicApiBackend {
  constructor(profile = {}) {
    super({ ...profile, type: BACKEND_TYPES.REMOTE_CLAUDECLAW });

    this.transport = profile.transport === 'ssh' ? 'ssh' : 'http';
    this.host = profile.host || '127.0.0.1';
    this.port = profile.port || 8822;
    this.basePath = profile.basePath || '/v1';
    this.workspace = profile.workspace || '';
    this.sshTarget = profile.sshTarget || '';
    this.remoteHost = profile.remoteHost || '127.0.0.1';
    this.remotePort = profile.remotePort || this.port;
    this.secretKey = profile.secretKey || `CLAUDECLAW_TOKEN_${(profile.id || 'default').toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
    this.authHeader = profile.authHeader || 'x-api-key';

    this._tunnel = null;
    this._tunnelPort = null;
  }

  describe() {
    return {
      id: this.id,
      type: this.type,
      name: this.name,
      transport: this.transport,
      endpoint: this.transport === 'ssh'
        ? `ssh://${this.sshTarget} → ${this.remoteHost}:${this.remotePort}${this.basePath}`
        : `http://${this.host}:${this.port}${this.basePath}`,
      workspace: this.workspace || null,
      model: this.model,
    };
  }

  /** Build the effective base URL, opening an SSH tunnel first when needed. */
  async _resolveBaseUrl() {
    if (this.transport === 'http') {
      const scheme = /^https?:\/\//i.test(this.host) ? '' : 'http://';
      const hostPart = this.host.replace(/\/+$/, '');
      return `${scheme}${hostPart}:${this.port}${this.basePath}`;
    }

    const port = await this._ensureTunnel();
    return `http://127.0.0.1:${port}${this.basePath}`;
  }

  async _ensureTunnel() {
    if (this._tunnel && !this._tunnel.killed && this._tunnelPort) return this._tunnelPort;

    if (!this.sshTarget) throw new Error('SSH transport needs an SSH target such as user@host.');

    const ssh = resolveExecutable('ssh');
    if (!ssh) throw new Error('The ssh command was not found on this machine.');

    const localPort = await findFreePort();
    const args = [
      '-N',
      '-o', 'ExitOnForwardFailure=yes',
      '-o', 'ConnectTimeout=10',
      '-o', 'BatchMode=yes',
      '-L', `127.0.0.1:${localPort}:${this.remoteHost}:${this.remotePort}`,
      this.sshTarget,
    ];

    const child = spawn(ssh, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let stderr = '';
    child.stderr?.on('data', c => { stderr += c.toString(); });

    const ready = await waitForPort(localPort, 8000, child);
    if (!ready) {
      try { child.kill(); } catch {}
      throw new Error(`SSH tunnel to ${this.sshTarget} failed${stderr ? `: ${stderr.trim().split('\n')[0]}` : '.'}`);
    }

    this._tunnel = child;
    this._tunnelPort = localPort;
    child.on('exit', () => { this._tunnel = null; this._tunnelPort = null; });
    return localPort;
  }

  closeTunnel() {
    if (this._tunnel) {
      try { this._tunnel.kill(); } catch {}
      this._tunnel = null;
      this._tunnelPort = null;
    }
  }

  async _prepare() {
    this.baseURL = await this._resolveBaseUrl();
    const headers = {};
    if (this.workspace) headers['x-claudeclaw-workspace'] = this.workspace;
    const token = getSecret(this.secretKey);
    if (token && this.authHeader.toLowerCase() !== 'x-api-key') {
      headers[this.authHeader] = this.authHeader.toLowerCase() === 'authorization' ? `Bearer ${token}` : token;
    }
    this.extraHeaders = headers;
    // The SDK requires an apiKey; ClaudeClaw workers that authenticate with a
    // different header still need a placeholder so the client can be built.
    if (!getSecret(this.secretKey)) {
      this.extraHeaders = { ...headers };
    }
  }

  _client() {
    const original = super._client.bind(this);
    return original();
  }

  async testConnection(options = {}) {
    try {
      await this._prepare();
    } catch (e) {
      return { ok: false, error: e.message };
    }
    const result = await super.testConnection(options);
    return result.ok
      ? { ...result, detail: `${result.detail} via ${this.transport === 'ssh' ? 'SSH tunnel' : 'HTTP'}` }
      : result;
  }

  async run(request) {
    await this._prepare();
    return super.run(request);
  }
}

async function findFreePort() {
  const { createServer } = await import('net');
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer();
    server.on('error', rejectPort);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolvePort(port));
    });
  });
}

async function waitForPort(port, timeoutMs, child) {
  const { connect } = await import('net');
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) return false;
    const open = await new Promise((res) => {
      const socket = connect({ port, host: '127.0.0.1' });
      socket.setTimeout(500);
      socket.on('connect', () => { socket.destroy(); res(true); });
      socket.on('error', () => { socket.destroy(); res(false); });
      socket.on('timeout', () => { socket.destroy(); res(false); });
    });
    if (open) return true;
    await new Promise(r => setTimeout(r, 150));
  }
  return false;
}
