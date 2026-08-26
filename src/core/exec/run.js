import { spawn } from 'child_process';

/**
 * Run an executable and collect its output.
 *
 * Uses spawn (never a shell) so arguments containing spaces, quotes or
 * backslashes are passed through verbatim on both Windows and POSIX. This
 * matters for LaTeX projects living under paths like
 * `C:\Users\Zhang Wei\Documents\My Papers\`.
 *
 * @param {string} file          absolute path to the executable
 * @param {string[]} args
 * @param {object} options
 * @param {string} options.cwd
 * @param {object} options.env
 * @param {number} options.timeout     milliseconds; 0 disables
 * @param {AbortSignal} options.signal  cancels the run
 * @param {(chunk: string, stream: 'stdout'|'stderr') => void} options.onOutput
 * @returns {Promise<{ code, signal, stdout, stderr, output, timedOut, aborted, spawnError }>}
 */
export function runCommand(file, args = [], options = {}) {
  const {
    cwd = process.cwd(),
    env = process.env,
    timeout = 0,
    signal,
    onOutput,
    input,
    maxBuffer = 32 * 1024 * 1024,
  } = options;

  return new Promise((resolvePromise) => {
    let child;
    try {
      child = spawn(file, args, {
        cwd,
        env,
        windowsHide: true,
        // Never `shell: true` — see the doc comment above.
        shell: false,
      });
    } catch (e) {
      resolvePromise({
        code: null, signal: null, stdout: '', stderr: String(e.message || e),
        output: String(e.message || e), timedOut: false, aborted: false, spawnError: e,
      });
      return;
    }

    let stdout = '';
    let stderr = '';
    let output = '';
    let timedOut = false;
    let aborted = false;
    let settled = false;
    let truncated = false;

    const append = (target, chunk) => {
      if (output.length > maxBuffer) {
        truncated = true;
        return target;
      }
      return target + chunk;
    };

    const timer = timeout > 0
      ? setTimeout(() => { timedOut = true; kill(); }, timeout)
      : null;

    function kill() {
      try {
        // On Windows a plain SIGTERM does not reliably reach a .cmd shim's
        // grandchild, so fall back to taskkill on the process tree.
        if (process.platform === 'win32') {
          spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
        } else {
          child.kill('SIGTERM');
          setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 3000).unref?.();
        }
      } catch { /* already gone */ }
    }

    const onAbort = () => { aborted = true; kill(); };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }

    child.stdout?.setEncoding('utf-8');
    child.stderr?.setEncoding('utf-8');

    child.stdout?.on('data', (chunk) => {
      stdout = append(stdout, chunk);
      output = append(output, chunk);
      onOutput?.(chunk, 'stdout');
    });
    child.stderr?.on('data', (chunk) => {
      stderr = append(stderr, chunk);
      output = append(output, chunk);
      onOutput?.(chunk, 'stderr');
    });

    // stdin must always be closed. A child that reads stdin — `claude --print`
    // is one — otherwise waits for input that is never coming, and reports a
    // spurious "no stdin data received" failure.
    if (child.stdin) {
      child.stdin.on('error', () => { /* the child may exit before we finish writing */ });
      child.stdin.end(input === undefined ? undefined : input);
    }

    const finish = (code, sig, spawnError = null) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
      resolvePromise({
        code, signal: sig, stdout, stderr, output, timedOut, aborted, spawnError,
        truncated,
      });
    };

    child.on('error', (e) => finish(null, null, e));
    child.on('close', (code, sig) => finish(code, sig));
  });
}

/**
 * Probe a tool's version string. Returns null when the tool cannot be run.
 */
export async function probeVersion(file, args = ['--version'], { timeout = 8000 } = {}) {
  const result = await runCommand(file, args, { timeout });
  if (result.spawnError) return null;
  const text = (result.stdout || result.stderr || '').trim();
  if (!text) return result.code === 0 ? '' : null;
  return text.split('\n')[0].trim();
}
