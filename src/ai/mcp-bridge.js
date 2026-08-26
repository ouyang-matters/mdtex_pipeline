#!/usr/bin/env node
/**
 * MDTeX MCP bridge.
 *
 * A stdio MCP server that exposes the MDTeX tool layer to an external agent
 * runner — specifically the local Claude Code CLI, which drives its own agent
 * loop and therefore cannot use MDTeX's in-process loop.
 *
 * Every tool call is proxied back to the running MDTeX backend, which executes
 * it through the SAME ToolExecutor the Anthropic and ClaudeClaw backends use.
 * That is what gives Local Claude Code identical capabilities, permissions,
 * validation, diffs and checkpoints.
 *
 * Configuration arrives through the environment so no secret ever appears in a
 * process listing:
 *   MDTEX_API_URL   base URL of the local backend
 *   MDTEX_TOKEN     session token
 *   MDTEX_RUN_ID    the AI run this bridge belongs to
 */

import { createInterface } from 'readline';

const API_URL = process.env.MDTEX_API_URL;
const TOKEN = process.env.MDTEX_TOKEN;
const RUN_ID = process.env.MDTEX_RUN_ID;
const PROTOCOL_VERSION = '2024-11-05';

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

function respond(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function respondError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

async function api(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      'x-mdtex-token': TOKEN,
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { body = { error: text }; }
  if (!response.ok) {
    throw new Error(body?.error || `MDTeX backend returned ${response.status}`);
  }
  return body;
}

async function listTools() {
  const body = await api(`/api/ai/run/${encodeURIComponent(RUN_ID)}/tools`);
  return (body.tools || []).map(t => ({
    name: t.name,
    description: t.description,
    inputSchema: t.input_schema || { type: 'object', properties: {} },
  }));
}

async function callTool(name, args) {
  const body = await api(`/api/ai/run/${encodeURIComponent(RUN_ID)}/tool`, {
    method: 'POST',
    body: JSON.stringify({ name, input: args || {} }),
  });
  return body.result ?? {};
}

async function handle(message) {
  const { id, method, params } = message;

  // Notifications carry no id and expect no reply.
  if (id === undefined || id === null) return;

  try {
    switch (method) {
      case 'initialize':
        respond(id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: 'mdtex', version: '1.0.0' },
        });
        return;

      case 'ping':
        respond(id, {});
        return;

      case 'tools/list':
        respond(id, { tools: await listTools() });
        return;

      case 'tools/call': {
        const result = await callTool(params?.name, params?.arguments);
        respond(id, {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          isError: Boolean(result?.error),
        });
        return;
      }

      case 'resources/list':
        respond(id, { resources: [] });
        return;

      case 'prompts/list':
        respond(id, { prompts: [] });
        return;

      default:
        respondError(id, -32601, `Method not found: ${method}`);
    }
  } catch (e) {
    respondError(id, -32603, e.message || String(e));
  }
}

if (!API_URL || !TOKEN || !RUN_ID) {
  process.stderr.write('mdtex mcp bridge: MDTEX_API_URL, MDTEX_TOKEN and MDTEX_RUN_ID are required\n');
  process.exit(1);
}

const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let message;
  try {
    message = JSON.parse(trimmed);
  } catch {
    return;
  }
  handle(message).catch((e) => {
    process.stderr.write(`mdtex mcp bridge: ${e.message}\n`);
  });
});
rl.on('close', () => process.exit(0));
