import { randomUUID } from 'crypto';
import { join } from 'path';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { paths, ensureDir } from '../core/paths.js';
import { BACKEND_TYPES, BACKEND_LABELS } from './backends/base.js';
import { LocalClaudeCodeBackend, findClaudeCli } from './backends/local-claude.js';
import { RemoteClaudeClawBackend } from './backends/remote-claudeclaw.js';
import { AnthropicApiBackend, DEFAULT_MODEL, SELECTABLE_MODELS, EFFORT_LEVELS } from './backends/anthropic.js';
import { setSecret, deleteSecret, fingerprintSecret, hasSecret } from '../core/config/secrets.js';

/**
 * AI connection registry.
 *
 * Connection profiles live in ~/.config/publisher/ai.json. Secrets never do —
 * a profile only stores the *name* of the secret, and the value lives in the
 * secret store. Switching the active backend is a config write plus a cache
 * drop, so it takes effect immediately: no application restart.
 */

const FILE_VERSION = 1;

function aiConfigPath() {
  return join(paths.configDir, 'ai.json');
}

const DEFAULT_CONFIG = {
  version: FILE_VERSION,
  activeProfileId: null,
  profiles: [],
};

let _cache = null;
const _backends = new Map();

export function loadAiConfig() {
  if (_cache) return _cache;
  const file = aiConfigPath();
  if (!existsSync(file)) {
    _cache = { ...DEFAULT_CONFIG, profiles: [] };
    return _cache;
  }
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8'));
    _cache = {
      version: parsed.version || FILE_VERSION,
      activeProfileId: parsed.activeProfileId || null,
      profiles: Array.isArray(parsed.profiles) ? parsed.profiles : [],
    };
  } catch {
    _cache = { ...DEFAULT_CONFIG, profiles: [] };
  }
  return _cache;
}

function saveAiConfig(config) {
  ensureDir(paths.configDir);
  writeFileSync(aiConfigPath(), JSON.stringify(config, null, 2) + '\n', 'utf-8');
  _cache = config;
  _backends.clear(); // a changed profile must not keep serving a stale client
}

/** Secret key name for a profile. Deterministic, so re-saving keeps the key. */
export function secretKeyFor(profile) {
  if (profile.type === BACKEND_TYPES.ANTHROPIC_API) {
    return `ANTHROPIC_API_KEY_${slugKey(profile.id)}`;
  }
  if (profile.type === BACKEND_TYPES.REMOTE_CLAUDECLAW) {
    return `CLAUDECLAW_TOKEN_${slugKey(profile.id)}`;
  }
  return null;
}

function slugKey(id) {
  return String(id || 'default').toUpperCase().replace(/[^A-Z0-9]/g, '_');
}

/** Profiles, with secrets replaced by fingerprints. */
export function listProfiles() {
  const config = loadAiConfig();
  return config.profiles.map(p => publicProfile(p, p.id === config.activeProfileId));
}

export function publicProfile(profile, isActive = false) {
  const secretKey = secretKeyFor(profile);
  return {
    id: profile.id,
    type: profile.type,
    typeLabel: BACKEND_LABELS[profile.type] || profile.type,
    name: profile.name,
    active: isActive,
    model: profile.model || null,
    effort: profile.effort || null,
    transport: profile.transport || null,
    host: profile.host || null,
    port: profile.port || null,
    basePath: profile.basePath || null,
    workspace: profile.workspace || null,
    sshTarget: profile.sshTarget || null,
    remoteHost: profile.remoteHost || null,
    remotePort: profile.remotePort || null,
    authHeader: profile.authHeader || null,
    cliPath: profile.cliPath || null,
    // Never the value — only enough to tell keys apart.
    secretConfigured: secretKey ? hasSecret(secretKey) : null,
    secretFingerprint: secretKey ? fingerprintSecret(secretKey) : null,
    createdAt: profile.createdAt,
    lastTestedAt: profile.lastTestedAt || null,
    lastTestOk: profile.lastTestOk ?? null,
  };
}

export function getProfile(id) {
  return loadAiConfig().profiles.find(p => p.id === id) || null;
}

export function getActiveProfile() {
  const config = loadAiConfig();
  if (!config.activeProfileId) return null;
  return config.profiles.find(p => p.id === config.activeProfileId) || null;
}

/**
 * Create or update a profile.
 * `secret` is written to the secret store and stripped from the saved profile.
 */
export function saveProfile(input) {
  const config = { ...loadAiConfig(), profiles: [...loadAiConfig().profiles] };
  const isNew = !input.id || !config.profiles.some(p => p.id === input.id);
  const id = input.id || randomUUID().slice(0, 8);

  if (!Object.values(BACKEND_TYPES).includes(input.type)) {
    throw new Error(`Unknown backend type: ${input.type}`);
  }

  const existing = config.profiles.find(p => p.id === id) || {};
  const profile = {
    ...existing,
    id,
    type: input.type,
    name: (input.name || '').trim() || BACKEND_LABELS[input.type],
    createdAt: existing.createdAt || new Date().toISOString(),
  };

  if (input.type === BACKEND_TYPES.ANTHROPIC_API) {
    profile.model = input.model || DEFAULT_MODEL;
    profile.effort = EFFORT_LEVELS.includes(input.effort) ? input.effort : 'high';
    if (input.maxTokens) profile.maxTokens = Number(input.maxTokens);
  } else if (input.type === BACKEND_TYPES.REMOTE_CLAUDECLAW) {
    profile.transport = input.transport === 'ssh' ? 'ssh' : 'http';
    profile.host = input.host || '127.0.0.1';
    profile.port = Number(input.port) || 8822;
    profile.basePath = input.basePath || '/v1';
    profile.workspace = input.workspace || '';
    profile.authHeader = input.authHeader || 'x-api-key';
    profile.model = input.model || DEFAULT_MODEL;
    profile.effort = EFFORT_LEVELS.includes(input.effort) ? input.effort : 'high';
    if (profile.transport === 'ssh') {
      profile.sshTarget = input.sshTarget || '';
      profile.remoteHost = input.remoteHost || '127.0.0.1';
      profile.remotePort = Number(input.remotePort) || profile.port;
    }
  } else if (input.type === BACKEND_TYPES.LOCAL_CLAUDE) {
    profile.cliPath = input.cliPath || null;
    profile.model = input.model || null;
    profile.effort = input.effort || null;
  }

  const secretKey = secretKeyFor(profile);
  if (secretKey && typeof input.secret === 'string' && input.secret.trim()) {
    setSecret(secretKey, input.secret.trim());
  }
  profile.secretKey = secretKey;

  if (isNew) config.profiles.push(profile);
  else config.profiles = config.profiles.map(p => (p.id === id ? profile : p));

  // The first profile added becomes active, so a quick connect is usable immediately.
  if (!config.activeProfileId) config.activeProfileId = id;

  saveAiConfig(config);
  return publicProfile(profile, config.activeProfileId === id);
}

export function deleteProfile(id) {
  const config = loadAiConfig();
  const profile = config.profiles.find(p => p.id === id);
  if (!profile) return false;

  const secretKey = secretKeyFor(profile);
  if (secretKey) deleteSecret(secretKey);

  const profiles = config.profiles.filter(p => p.id !== id);
  const activeProfileId = config.activeProfileId === id ? (profiles[0]?.id || null) : config.activeProfileId;
  saveAiConfig({ ...config, profiles, activeProfileId });
  return true;
}

export function setActiveProfile(id) {
  const config = loadAiConfig();
  if (id !== null && !config.profiles.some(p => p.id === id)) {
    throw new Error(`No AI profile with id ${id}`);
  }
  saveAiConfig({ ...config, activeProfileId: id });
  return listProfiles();
}

/** Instantiate a backend for a profile. Cached until the config changes. */
export function backendFor(profile) {
  if (!profile) return null;
  if (_backends.has(profile.id)) return _backends.get(profile.id);

  let backend;
  switch (profile.type) {
    case BACKEND_TYPES.LOCAL_CLAUDE:
      backend = new LocalClaudeCodeBackend(profile);
      break;
    case BACKEND_TYPES.REMOTE_CLAUDECLAW:
      backend = new RemoteClaudeClawBackend(profile);
      break;
    case BACKEND_TYPES.ANTHROPIC_API:
      backend = new AnthropicApiBackend({ ...profile, secretKey: secretKeyFor(profile) });
      break;
    default:
      return null;
  }

  _backends.set(profile.id, backend);
  return backend;
}

export function getActiveBackend() {
  return backendFor(getActiveProfile());
}

/**
 * What the Quick Connect panel offers, including live detection results so the
 * UI can say "Claude Code detected" before the user clicks anything.
 */
export function quickConnectOptions() {
  const claudePath = findClaudeCli();
  return [
    {
      type: BACKEND_TYPES.LOCAL_CLAUDE,
      label: BACKEND_LABELS[BACKEND_TYPES.LOCAL_CLAUDE],
      summary: 'Use the Claude Code CLI already signed in on this machine.',
      detected: Boolean(claudePath),
      detail: claudePath ? `Found at ${claudePath}` : 'The `claude` command was not found on this machine.',
      needsCredentials: false,
      fields: [],
    },
    {
      type: BACKEND_TYPES.REMOTE_CLAUDECLAW,
      label: BACKEND_LABELS[BACKEND_TYPES.REMOTE_CLAUDECLAW],
      summary: 'Connect to a ClaudeClaw worker over HTTP or an SSH tunnel.',
      detected: null,
      detail: 'Point MDTeX at the worker endpoint.',
      needsCredentials: true,
      fields: [
        { name: 'name', label: 'Connection name', type: 'text', placeholder: 'Workstation', required: true },
        { name: 'transport', label: 'Transport', type: 'select', options: [
          { value: 'http', label: 'HTTP' },
          { value: 'ssh', label: 'SSH tunnel' },
        ], default: 'http' },
        { name: 'host', label: 'Host', type: 'text', placeholder: '127.0.0.1', showWhen: { transport: 'http' } },
        { name: 'port', label: 'Port', type: 'number', placeholder: '8822', showWhen: { transport: 'http' } },
        { name: 'sshTarget', label: 'SSH target', type: 'text', placeholder: 'user@workstation', showWhen: { transport: 'ssh' } },
        { name: 'remoteHost', label: 'Remote bind host', type: 'text', placeholder: '127.0.0.1', showWhen: { transport: 'ssh' } },
        { name: 'remotePort', label: 'Remote port', type: 'number', placeholder: '8822', showWhen: { transport: 'ssh' } },
        { name: 'basePath', label: 'API path', type: 'text', placeholder: '/v1' },
        { name: 'workspace', label: 'Workspace', type: 'text', placeholder: 'optional' },
        { name: 'authHeader', label: 'Auth header', type: 'text', placeholder: 'x-api-key' },
        { name: 'secret', label: 'Auth token', type: 'password', placeholder: 'stored locally, never shown again' },
        { name: 'model', label: 'Model', type: 'select', options: SELECTABLE_MODELS.map(m => ({ value: m.id, label: m.label })), default: DEFAULT_MODEL },
      ],
    },
    {
      type: BACKEND_TYPES.ANTHROPIC_API,
      label: BACKEND_LABELS[BACKEND_TYPES.ANTHROPIC_API],
      summary: 'Use an Anthropic API key directly.',
      detected: null,
      detail: 'The key is stored in the local secret store and never shown again.',
      needsCredentials: true,
      fields: [
        { name: 'name', label: 'Connection name', type: 'text', placeholder: 'Anthropic API', required: true },
        { name: 'secret', label: 'API key', type: 'password', placeholder: 'sk-ant-…', required: true },
        { name: 'model', label: 'Model', type: 'select', options: SELECTABLE_MODELS.map(m => ({ value: m.id, label: `${m.label} — ${m.note}` })), default: DEFAULT_MODEL },
        { name: 'effort', label: 'Effort', type: 'select', options: EFFORT_LEVELS.map(e => ({ value: e, label: e })), default: 'high' },
      ],
    },
  ];
}

/** Drop cached state so a config change is picked up without a restart. */
export function resetAiCache() {
  _cache = null;
  for (const backend of _backends.values()) backend.closeTunnel?.();
  _backends.clear();
}

export function recordTestResult(id, ok) {
  const config = loadAiConfig();
  const profiles = config.profiles.map(p => (
    p.id === id ? { ...p, lastTestedAt: new Date().toISOString(), lastTestOk: ok } : p
  ));
  saveAiConfig({ ...config, profiles });
}

export { BACKEND_TYPES, BACKEND_LABELS, SELECTABLE_MODELS, EFFORT_LEVELS, DEFAULT_MODEL };
