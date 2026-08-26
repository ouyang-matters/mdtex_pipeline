import { timingSafeEqual } from 'crypto';

/**
 * Small HTTP helpers shared by every route module.
 * Deliberately dependency-free: the backend must start instantly and must not
 * pull a web framework into a desktop application.
 */

export const MAX_JSON_BODY = 64 * 1024 * 1024; // large enough for a pasted image

export class HttpError extends Error {
  constructor(status, message, details = null) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function badRequest(message, details) { return new HttpError(400, message, details); }
export function notFound(message = 'Not found') { return new HttpError(404, message); }
export function conflict(message) { return new HttpError(409, message); }

export function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

export function sendText(res, status, text, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(text);
}

export function sendBuffer(res, status, buffer, contentType, extraHeaders = {}) {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': buffer.length,
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  });
  res.end(buffer);
}

export async function readBody(req, { limit = MAX_JSON_BODY } = {}) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'Request body too large.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function readJson(req, options) {
  const buffer = await readBody(req, options);
  if (!buffer.length) return {};
  try {
    return JSON.parse(buffer.toString('utf-8'));
  } catch {
    throw badRequest('Request body is not valid JSON.');
  }
}

/** Constant-time token comparison. */
export function tokensMatch(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1', '0:0:0:0:0:0:0:1']);

/** Hostname (without port) of a Host or Origin header value. */
export function hostnameOf(value) {
  if (!value) return null;
  let host = String(value).trim();
  host = host.replace(/^https?:\/\//i, '');
  host = host.split('/')[0];
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    return end >= 0 ? host.slice(0, end + 1) : host;
  }
  return host.split(':')[0];
}

export function isLoopbackHost(value) {
  const host = hostnameOf(value);
  return host !== null && LOOPBACK_HOSTS.has(host.toLowerCase());
}

/**
 * A tiny path router: `/api/workspace/article/:id/source` style patterns.
 * Returns the extracted params, or null when the pattern does not match.
 */
export function matchPath(pattern, pathname) {
  const patternParts = pattern.split('/').filter(Boolean);
  const pathParts = pathname.split('/').filter(Boolean);

  const params = {};
  let i = 0;
  for (; i < patternParts.length; i++) {
    const p = patternParts[i];
    if (p === '*') {
      // A wildcard matches one or more segments. Without this, a pattern like
      // `/api/assets/:id/*` would also match `/api/assets/:id` with an empty
      // remainder and shadow the route that handles it.
      if (i >= pathParts.length) return null;
      params['*'] = pathParts.slice(i).map(decodeURIComponent).join('/');
      return params;
    }
    if (i >= pathParts.length) return null;
    if (p.startsWith(':')) {
      params[p.slice(1)] = decodeURIComponent(pathParts[i]);
    } else if (p !== pathParts[i]) {
      return null;
    }
  }
  return i === pathParts.length ? params : null;
}
