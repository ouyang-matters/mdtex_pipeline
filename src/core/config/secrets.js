import { existsSync, readFileSync, writeFileSync, chmodSync } from 'fs';
import { paths, ensureDir } from '../paths.js';

/**
 * Secret store.
 *
 * Secrets live in ~/.config/publisher/secrets.env with owner-only permissions.
 * Values are never returned to the UI or written to logs — callers get a
 * fingerprint (`sk-ant-…a1b2`) instead, which is enough to confirm *which* key
 * is configured without exposing it.
 */

const HEADER = '# Publisher secrets - never commit this file\n';

function parse(text) {
  const values = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values.set(key, value);
  }
  return values;
}

function load() {
  if (!existsSync(paths.secretsFile)) return new Map();
  try {
    return parse(readFileSync(paths.secretsFile, 'utf-8'));
  } catch {
    return new Map();
  }
}

function persist(values) {
  ensureDir(paths.configDir);
  const lines = [HEADER];
  for (const [key, value] of values) {
    lines.push(`${key}=${value}`);
  }
  writeFileSync(paths.secretsFile, lines.join('\n') + '\n', { encoding: 'utf-8', mode: 0o600 });
  try { chmodSync(paths.secretsFile, 0o600); } catch { /* best effort on Windows */ }
}

/** Read a secret. Only ever called inside the backend process. */
export function getSecret(key) {
  if (process.env[key]) return process.env[key];
  return load().get(key) ?? null;
}

export function setSecret(key, value) {
  const values = load();
  if (value === null || value === undefined || value === '') values.delete(key);
  else values.set(key, String(value));
  persist(values);
  return true;
}

export function deleteSecret(key) {
  return setSecret(key, null);
}

export function hasSecret(key) {
  return Boolean(getSecret(key));
}

export function listSecretKeys() {
  return [...load().keys()];
}

/**
 * A non-reversible display form: prefix plus last four characters.
 * Enough to tell two keys apart; useless to anyone who sees it.
 */
export function fingerprintSecret(key) {
  const value = getSecret(key);
  if (!value) return null;
  const tail = value.slice(-4);
  const prefix = value.match(/^([A-Za-z-]+-)/)?.[1] || '';
  return `${prefix}…${tail}`;
}

/** Redact anything that looks like a key from text destined for a log or the UI. */
export function redact(text) {
  return String(text ?? '')
    .replace(/sk-ant-[A-Za-z0-9_-]{8,}/g, 'sk-ant-…redacted')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, (m) => (/^[A-Fa-f0-9]+$/.test(m) ? m : '…redacted'));
}
