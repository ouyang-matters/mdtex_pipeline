import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, chmodSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { classifyProbe, LocalClaudeCodeBackend } from '../src/ai/backends/local-claude.js';
import { ClaudeSignIn, findSignInUrl } from '../src/ai/backends/claude-login.js';

describe('Reading a Claude Code test call', () => {
  it('treats a reply as a working connection', () => {
    const outcome = classifyProbe({ code: 0, stdout: JSON.stringify({ is_error: false, result: 'ready' }) });
    expect(outcome).toMatchObject({ ok: true, authFailure: false, reply: 'ready' });
  });

  it('does not read exit 0 with is_error as a connection', () => {
    // What an expired sign-in actually returns: success subtype, exit 0, 401 inside.
    const stdout = JSON.stringify({
      type: 'result', subtype: 'success', is_error: true, api_error_status: 401,
      result: 'Failed to authenticate. API Error: 401 OAuth access token is invalid.',
    });
    const outcome = classifyProbe({ code: 0, stdout });
    expect(outcome.ok).toBe(false);
    expect(outcome.authFailure).toBe(true);
    expect(outcome.detail).toContain('401');
  });

  it('recognises a missing sign-in reported as text', () => {
    const outcome = classifyProbe({ code: 1, stdout: '', stderr: 'Not logged in · Please run /login' });
    expect(outcome).toMatchObject({ ok: false, authFailure: true });
  });

  it('keeps other failures distinct from sign-in problems', () => {
    const overloaded = classifyProbe({
      code: 0,
      stdout: JSON.stringify({ is_error: true, api_error_status: 529, result: 'API Error: 529 Overloaded' }),
    });
    expect(overloaded).toMatchObject({ ok: false, authFailure: false });

    const timedOut = classifyProbe({ code: null, stdout: '', timedOut: true });
    expect(timedOut).toMatchObject({ ok: false, authFailure: false });
  });
});

describe('A run with a lapsed sign-in', () => {
  let dir;
  let cli;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'mdtex-lapsed-'));
    // Streams what an expired sign-in streams, and exits 0 as the real CLI does.
    const script = join(dir, 'lapsed.mjs');
    writeFileSync(script, `
      process.stdin.resume();
      process.stdin.on('end', () => {
        console.log(JSON.stringify({ type: 'system', subtype: 'init' }));
        process.stdout.write(JSON.stringify({
          type: 'result', subtype: 'success', is_error: true, api_error_status: 401,
          result: 'Failed to authenticate. API Error: 401 OAuth access token is invalid.',
        }));
        process.exit(0);
      });
    `);
    if (process.platform === 'win32') {
      cli = join(dir, 'claude.cmd');
      writeFileSync(cli, `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`);
    } else {
      cli = join(dir, 'claude');
      writeFileSync(cli, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`);
      chmodSync(cli, 0o755);
    }
  });

  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  it('is reported as a sign-in problem, not as the model’s reply', async () => {
    const backend = new LocalClaudeCodeBackend({ cliPath: cli });
    const result = await backend.run({
      systemPrompt: 'test',
      messages: [{ role: 'user', content: 'hello' }],
      bridge: { apiUrl: 'http://127.0.0.1:1', token: 't', runId: 'r' },
    });
    expect(result.ok).toBe(false);
    expect(result.remedy).toBe('sign-in-claude-code');
    expect(result.text).toBe('');
  });
});

describe('Finding the sign-in link', () => {
  it('accepts Claude’s own authorize URL', () => {
    const text = "Opening browser to sign in…\nIf the browser didn't open, visit: "
      + 'https://claude.com/cai/oauth/authorize?code=true&client_id=x&state=y\n';
    expect(findSignInUrl(text)).toBe('https://claude.com/cai/oauth/authorize?code=true&client_id=x&state=y');
  });

  it('never offers a link to another host', () => {
    expect(findSignInUrl('visit: https://claude.com.evil.example/oauth/authorize?x=1')).toBeNull();
    expect(findSignInUrl('visit: https://example.com/oauth/authorize')).toBeNull();
    expect(findSignInUrl('see https://claude.com/pricing')).toBeNull();
  });
});

describe('Signing Claude Code in', () => {
  let dir;
  let fakeCli;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'mdtex-sign-in-'));
    fakeCli = join(dir, 'fake-claude.mjs');
    // Behaves like `claude auth login` without a terminal: prints the link,
    // then waits for the code on stdin. `mode` selects how it ends.
    writeFileSync(fakeCli, `
      const mode = process.argv[2];
      if (mode === 'no-link') { console.log('Something went wrong'); process.exit(3); }
      if (mode === 'silent') { setInterval(() => {}, 1000); }
      else {
        console.log("Opening browser to sign in…");
        console.log("If the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true&state=s");
        let input = '';
        process.stdin.setEncoding('utf-8');
        process.stdin.on('data', (chunk) => {
          input += chunk;
          if (!input.includes('\\n')) return;
          const code = input.trim();
          if (mode === 'hang') return;
          if (code === 'good-code') { console.log('Login successful.'); process.exit(0); }
          console.error('OAuth error: Invalid code'); process.exit(1);
        });
      }
    `);
  });

  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  const attempt = (mode, options = {}) => new ClaudeSignIn({ cli: process.execPath, args: [fakeCli, mode], ...options });

  it('completes with the code from Claude’s page', async () => {
    const signIn = attempt('ok');
    const started = await signIn.start();
    expect(started.state).toBe('waiting-for-code');
    expect(started.url).toContain('https://claude.com/cai/oauth/authorize');
    expect(started.command).toBe('claude auth login');

    const finished = await signIn.submitCode('  good-code  ');
    expect(finished.state).toBe('succeeded');
  });

  it('reports a rejected code with the CLI’s own words', async () => {
    const signIn = attempt('ok');
    await signIn.start();
    const finished = await signIn.submitCode('wrong-code');
    expect(finished.state).toBe('failed');
    expect(finished.detail).toContain('Invalid code');
  });

  it('refuses input that is not a single-line code without sending it', async () => {
    const signIn = attempt('ok');
    await signIn.start();
    const rejected = await signIn.submitCode('line one\nline two');
    expect(rejected.state).toBe('waiting-for-code');
    expect(rejected.detail).toMatch(/does not look like/);
    expect((await signIn.submitCode('good-code')).state).toBe('succeeded');
  });

  it('fails plainly when the CLI prints no link', async () => {
    const started = await attempt('no-link').start();
    expect(started.state).toBe('failed');
    expect(started.url).toBeNull();
    expect(started.detail).toContain('Something went wrong');
  });

  it('gives up on a CLI that never prints a link, and stops it', async () => {
    const signIn = attempt('silent');
    const started = await signIn.start({ urlTimeout: 500 });
    expect(started.state).toBe('failed');
    await signIn.exited;
    expect(signIn.exit).not.toBe(0);
  });

  it('gives up on a CLI that never finishes, and stops it', async () => {
    const signIn = attempt('hang');
    await signIn.start();
    const finished = await signIn.submitCode('good-code', { timeout: 500 });
    expect(finished.state).toBe('cancelled');
    expect(finished.detail).toMatch(/terminal/);
    await signIn.exited;
  });

  it('abandons an attempt left waiting past its lifetime', async () => {
    const signIn = attempt('ok', { lifetime: 400 });
    await signIn.start();
    await signIn.exited;
    expect(signIn.state).toBe('cancelled');
  });
});
