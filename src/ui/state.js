/**
 * Application state.
 *
 * One shared object with a tiny event bus, so panels can react to each other
 * without importing each other. The backend is the source of truth for
 * articles, themes and settings; this is the in-memory view of it.
 */

const listeners = new Map();

export const app = {
  // Backend
  connected: false,
  env: null,
  // Resolves once the LaTeX probe has landed. It runs alongside the boot
  // rather than in front of it, so anything that reads `env` must await this
  // first or risk deciding from a value that has not arrived.
  envReady: Promise.resolve(null),
  schema: null,

  // Library
  articles: [],
  folders: [],
  trash: [],
  tags: [],
  series: [],
  currentArticleId: null,
  currentArticle: null,
  // Absolute article root, shown in asset diagnostics.
  assetRoot: null,

  // Editor
  source: '',
  dirty: false,
  savedAt: null,

  // Presentation
  themes: [],
  themeName: 'default',
  themeCss: '',
  themeEditable: false,
  platform: 'wechat',

  // Prepared target output
  target: {
    key: null,
    prepared: false,
    preparedAt: null,
    bytes: 0,
    validation: null,
    stats: null,
    busy: false,
    // The prepared bytes are held here so the clipboard write is synchronous
    // with the user's click and never triggers a compile.
    html: null,
    plainText: null,
  },

  // Build
  pdf: { path: null, url: null, logPath: null, at: null, errors: [], warnings: [] },

  // AI
  ai: { profiles: [], activeProfileId: null, quickConnect: [], scopes: [], busy: false, run: null },
};

export function on(event, handler) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(handler);
  return () => listeners.get(event)?.delete(handler);
}

export function emit(event, payload) {
  for (const handler of listeners.get(event) || []) {
    try { handler(payload); } catch (e) { console.error(`[mdtex] listener for "${event}" failed:`, e); }
  }
}

/** Mark the prepared target output stale — anything that changes the bytes. */
export function invalidateTarget(reason = '') {
  if (!app.target.prepared && !app.target.key) return;
  app.target = {
    key: null, prepared: false, preparedAt: null, bytes: 0,
    validation: null, stats: null, busy: false, html: null, plainText: null,
  };
  emit('target:changed', { reason });
}

export function currentLanguage() {
  return app.currentArticle?.sourceFormat === 'latex' ? 'latex' : 'markdown';
}
