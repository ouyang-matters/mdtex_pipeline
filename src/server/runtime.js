import { existsSync, readFileSync, writeFileSync, rmSync, chmodSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { paths, ensureDir } from '../core/paths.js';

/**
 * Runtime handshake file.
 *
 * The backend writes its port and session token here so that other local
 * processes owned by the same user — the Vite dev server proxy, `publisher`
 * subcommands, the end-to-end harness — can reach the API without the token
 * ever travelling over the network or appearing in a command line.
 *
 * The file is created with owner-only permissions and removed on shutdown.
 */

export function runtimeFilePath() {
  return join(paths.dataDir, 'runtime.json');
}

export function createSessionToken() {
  return randomBytes(32).toString('base64url');
}

export function writeRuntimeFile(info) {
  ensureDir(paths.dataDir);
  const file = runtimeFilePath();
  writeFileSync(file, JSON.stringify(info, null, 2) + '\n', { encoding: 'utf-8', mode: 0o600 });
  try { chmodSync(file, 0o600); } catch { /* best effort on Windows */ }
  return file;
}

export function readRuntimeFile() {
  const file = runtimeFilePath();
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

export function clearRuntimeFile() {
  try { rmSync(runtimeFilePath(), { force: true }); } catch { /* already gone */ }
}

/** Whether a previously recorded backend is still alive. */
export function isRuntimeAlive(info = readRuntimeFile()) {
  if (!info?.pid) return false;
  try {
    process.kill(info.pid, 0);
    return true;
  } catch {
    return false;
  }
}
