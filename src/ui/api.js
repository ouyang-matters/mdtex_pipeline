/**
 * Client for the MDTeX local backend.
 *
 * The browser never performs filesystem or build work itself: everything goes
 * through this module, which is the single place that knows how to talk to the
 * local service. That keeps platform-specific behaviour (paths, process
 * spawning, LaTeX) on the backend where it belongs.
 */

const BOOT = typeof window !== 'undefined' ? (window.__MDTEX__ || {}) : {};

export const api = {
  base: BOOT.api || '/api',
  token: BOOT.token || null,
  version: BOOT.version || null,
  connected: false,
  lastError: null,
};

/** In dev the page is served by Vite, which proxies /api and injects the token. */
function headers(extra = {}) {
  const out = { ...extra };
  if (api.token) out['x-mdtex-token'] = api.token;
  return out;
}

export class ApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function request(method, path, body, options = {}) {
  let response;
  try {
    response = await fetch(`${api.base}${path}`, {
      method,
      headers: headers(body === undefined ? {} : { 'content-type': 'application/json' }),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: options.signal,
    });
  } catch (e) {
    api.connected = false;
    api.lastError = e.message;
    throw new ApiError('The MDTeX backend is not reachable. Is `publisher start` still running?', 0, e);
  }

  api.connected = true;

  const text = await response.text();
  let payload = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = { raw: text }; }
  }

  if (!response.ok) {
    throw new ApiError(payload?.error || `Request failed (${response.status})`, response.status, payload?.details);
  }
  return payload;
}

export const get = (path, options) => request('GET', path, undefined, options);
export const post = (path, body, options) => request('POST', path, body ?? {}, options);
export const put = (path, body, options) => request('PUT', path, body ?? {}, options);
export const del = (path, options) => request('DELETE', path, undefined, options);

// ── Jobs ──────────────────────────────────────────────────────────────────────

/**
 * Follow a backend job to completion.
 *
 * Progress arrives over Server-Sent Events, so a long build reports
 * "Rendering formulas 18/42" as it happens instead of appearing frozen, and
 * `cancel()` works at any point.
 */
export function followJob(jobId, { onProgress, onLog, onStatus } = {}) {
  const url = `${api.base}/jobs/${encodeURIComponent(jobId)}/events`
    + (api.token ? `?token=${encodeURIComponent(api.token)}` : '');

  let source;
  let settled = false;

  const promise = new Promise((resolvePromise, rejectPromise) => {
    source = new EventSource(url);

    source.onmessage = (event) => {
      let data;
      try { data = JSON.parse(event.data); } catch { return; }

      if (data.kind === 'progress') onProgress?.(data);
      else if (data.kind === 'log') onLog?.(data);
      else if (data.kind === 'status') onStatus?.(data);
    };

    source.addEventListener('end', async () => {
      source.close();
      if (settled) return;
      settled = true;
      try {
        const { job } = await get(`/jobs/${encodeURIComponent(jobId)}`);
        if (job.status === 'succeeded') resolvePromise(job.result);
        else if (job.status === 'cancelled') rejectPromise(new CancelledError());
        else rejectPromise(new ApiError(job.error || 'The job failed.', 500));
      } catch (e) {
        rejectPromise(e);
      }
    });

    source.onerror = async () => {
      // EventSource retries on transient errors; only give up if the job is
      // actually gone or already finished.
      if (settled) return;
      try {
        const { job } = await get(`/jobs/${encodeURIComponent(jobId)}`);
        if (['succeeded', 'failed', 'cancelled'].includes(job.status)) {
          settled = true;
          source.close();
          if (job.status === 'succeeded') resolvePromise(job.result);
          else if (job.status === 'cancelled') rejectPromise(new CancelledError());
          else rejectPromise(new ApiError(job.error || 'The job failed.', 500));
        }
      } catch {
        settled = true;
        source.close();
        rejectPromise(new ApiError('Lost contact with the MDTeX backend.', 0));
      }
    };
  });

  return {
    jobId,
    promise,
    cancel: () => post(`/jobs/${encodeURIComponent(jobId)}/cancel`).catch(() => {}),
    close: () => source?.close(),
  };
}

export class CancelledError extends Error {
  constructor() {
    super('Cancelled.');
    this.name = 'CancelledError';
    this.cancelled = true;
  }
}

// ── Typed endpoints ───────────────────────────────────────────────────────────

export const backend = {
  health: () => get('/health'),
  env: (refresh = false) => get(`/env${refresh ? '?refresh=1' : ''}`),
  preferences: () => get('/preferences'),
  savePreferences: (prefs) => put('/preferences', prefs),
  saveConfig: (config) => put('/config', config),

  workspace: {
    tree: () => get('/workspace/tree'),
    schema: () => get('/workspace/schema'),
    search: (q, includeBody = false) =>
      get(`/workspace/search?q=${encodeURIComponent(q)}${includeBody ? '&body=1' : ''}`),
    article: (id) => get(`/workspace/article/${encodeURIComponent(id)}`),
    create: (data) => post('/workspace/article', data),
    import: (data) => post('/workspace/import', data),
    saveSource: (id, source) => put(`/workspace/article/${encodeURIComponent(id)}/source`, { source }),
    saveMeta: (id, patch) => put(`/workspace/article/${encodeURIComponent(id)}/meta`, patch),
    move: (id, folder) => post(`/workspace/article/${encodeURIComponent(id)}/move`, { folder }),
    duplicate: (id, title) => post(`/workspace/article/${encodeURIComponent(id)}/duplicate`, { title }),
    remove: (id) => del(`/workspace/article/${encodeURIComponent(id)}`),
    purge: (id) => del(`/workspace/article/${encodeURIComponent(id)}?permanent=1`),
    restore: (id) => post(`/workspace/article/${encodeURIComponent(id)}/restore`),
    emptyTrash: () => post('/workspace/trash/empty'),

    createFolder: (path) => post('/workspace/folder', { path }),
    renameFolder: (path, name) => put('/workspace/folder', { path, name }),
    deleteFolder: (path) => del(`/workspace/folder?path=${encodeURIComponent(path)}`),

    uploadAsset: (id, name, dataBase64, { replace = false } = {}) =>
      post(`/workspace/article/${encodeURIComponent(id)}/asset`, { name, dataBase64, replace }),
    deleteAsset: (id, name) =>
      del(`/workspace/article/${encodeURIComponent(id)}/asset/${encodeURIComponent(name)}`),
    assetUrl: (id, name) =>
      `${api.base}/workspace/article/${encodeURIComponent(id)}/asset/${encodeURIComponent(name)}`
      + (api.token ? `?token=${encodeURIComponent(api.token)}` : ''),

    // The LaTeX document an article is, or would become. Read-only for a
    // Markdown article until `adoptLatex` makes it the source.
    latex: (id, { regenerate = false } = {}) =>
      get(`/workspace/article/${encodeURIComponent(id)}/latex${regenerate ? '?regenerate=1' : ''}`),
    saveLatex: (id, tex) => post(`/workspace/article/${encodeURIComponent(id)}/latex/save`, { tex }),
    discardLatex: (id) => del(`/workspace/article/${encodeURIComponent(id)}/latex/save`),
    adoptLatex: (id) => post(`/workspace/article/${encodeURIComponent(id)}/latex/adopt`),

    checkpoints: (id) => get(`/workspace/article/${encodeURIComponent(id)}/checkpoints`),
    createCheckpoint: (id, data) => post(`/workspace/article/${encodeURIComponent(id)}/checkpoints`, data),
    restoreCheckpoint: (id, cid) =>
      post(`/workspace/article/${encodeURIComponent(id)}/checkpoints/${encodeURIComponent(cid)}/restore`),
  },

  assets: {
    manifest: (id) => get(`/assets/${encodeURIComponent(id)}`),
    resolve: (id, sources) => post(`/assets/${encodeURIComponent(id)}/resolve`, { sources }),
  },

  themes: {
    list: () => get('/themes'),
    read: (name) => get(`/themes/${encodeURIComponent(name)}`),
    save: (name, css) => put(`/themes/${encodeURIComponent(name)}`, { css }),
    create: (data) => post('/themes', data),
    rename: (name, next) => post(`/themes/${encodeURIComponent(name)}/rename`, { name: next }),
    remove: (name) => del(`/themes/${encodeURIComponent(name)}`),
  },

  pdfTemplates: {
    list: () => get('/pdf-templates'),
    read: (id) => get(`/pdf-templates/${encodeURIComponent(id)}`),
    save: (id, source) => put(`/pdf-templates/${encodeURIComponent(id)}`, { source }),
    eject: (id, name) => post(`/pdf-templates/${encodeURIComponent(id)}/eject`, { name }),
  },

  build: {
    target: (data) => post('/build/target', data),
    targetStatus: (data) => post('/build/target/status', data),
    fetchTarget: (key) => get(`/build/target/${encodeURIComponent(key)}`),
    clearCache: () => post('/build/cache/clear'),
    pdf: (data) => post('/build/pdf', data),
    pdfUrl: (path) => `${api.base}/build/pdf/file?path=${encodeURIComponent(path)}`
      + (api.token ? `&token=${encodeURIComponent(api.token)}` : ''),
    pdfLog: (path) => get(`/build/pdf/log?path=${encodeURIComponent(path)}`),
  },

  ai: {
    backends: () => get('/ai/backends'),
    save: (profile) => post('/ai/backends', profile),
    remove: (id) => del(`/ai/backends/${encodeURIComponent(id)}`),
    activate: (id) => post(`/ai/backends/${encodeURIComponent(id || 'none')}/activate`),
    test: (data) => post('/ai/test', data),
    run: (data) => post('/ai/run', data),
    apply: (runId, label) => post(`/ai/run/${encodeURIComponent(runId)}/apply`, { label }),
    discard: (runId) => post(`/ai/run/${encodeURIComponent(runId)}/discard`),
  },
};

/** Probe the backend once at startup so the UI can show an honest state. */
export async function connect() {
  try {
    const health = await backend.health();
    api.connected = true;
    api.version = health.version;
    return { ok: true, health };
  } catch (e) {
    api.connected = false;
    return { ok: false, error: e.message };
  }
}
