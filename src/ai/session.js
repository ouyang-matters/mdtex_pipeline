import { ToolExecutor, TOOL_PERMISSIONS, toolDefinitionsForApi, toolInstructions } from './tools.js';
import { BACKEND_TYPES } from './backends/base.js';

/**
 * An AI run.
 *
 * MDTeX — not the model, and not the connection — is responsible for
 * understanding the editor state. This module builds the task context, decides
 * which tools the run may use, drives (or hands off) the agent loop, and turns
 * the result into a reviewable set of diffs.
 *
 * The backend only ever answers "given these messages and tools, what next".
 */

/** The scopes a user can pick in the AI panel, and what each unlocks. */
export const SCOPES = {
  content: {
    label: 'Edit content',
    permissions: [TOOL_PERMISSIONS.READ, TOOL_PERMISSIONS.WRITE_CONTENT, TOOL_PERMISSIONS.BUILD],
    guidance: 'Edit the article text only. Do not change the theme CSS or article metadata.',
  },
  theme: {
    label: 'Edit theme CSS',
    permissions: [TOOL_PERMISSIONS.READ, TOOL_PERMISSIONS.WRITE_THEME, TOOL_PERMISSIONS.BUILD],
    guidance: 'Edit the theme stylesheet only. Do not change the article text.',
  },
  metadata: {
    label: 'Edit article info',
    permissions: [TOOL_PERMISSIONS.READ, TOOL_PERMISSIONS.WRITE_METADATA],
    guidance: 'Update article metadata only (title, tags, series, summary, targets).',
  },
  'convert-to-latex': {
    label: 'Convert Markdown → LaTeX',
    permissions: [TOOL_PERMISSIONS.READ, TOOL_PERMISSIONS.WRITE_CONTENT, TOOL_PERMISSIONS.BUILD],
    guidance: 'Convert the whole document from Markdown to LaTeX with write_source. Preserve every '
      + 'equation verbatim, keep the heading hierarchy, and keep theorem/proof structure where the '
      + 'source has it. Then run compile_pdf and fix anything that fails.',
  },
  'convert-to-md': {
    label: 'Convert LaTeX → Markdown',
    permissions: [TOOL_PERMISSIONS.READ, TOOL_PERMISSIONS.WRITE_CONTENT, TOOL_PERMISSIONS.BUILD],
    guidance: 'Convert the whole document from LaTeX to Markdown with write_source. Keep inline maths '
      + 'in $…$ and display maths in $$…$$. Preserve headings, lists, tables and figures.',
  },
  'fix-compile': {
    label: 'Fix compile errors',
    permissions: [TOOL_PERMISSIONS.READ, TOOL_PERMISSIONS.WRITE_CONTENT, TOOL_PERMISSIONS.BUILD],
    guidance: 'Read the build log, find the cause of the failure, apply the smallest fix that resolves '
      + 'it with apply_patch, then run compile_pdf again to confirm.',
  },
  'fix-wechat': {
    label: 'Fix WeChat output',
    permissions: [TOOL_PERMISSIONS.READ, TOOL_PERMISSIONS.WRITE_CONTENT, TOOL_PERMISSIONS.WRITE_THEME, TOOL_PERMISSIONS.BUILD],
    guidance: 'Run render_wechat, read the validation errors and warnings, and fix them. Prefer changing '
      + 'the article; only change the theme when the problem is genuinely stylistic.',
  },
  review: {
    label: 'Review only',
    permissions: [TOOL_PERMISSIONS.READ, TOOL_PERMISSIONS.BUILD, TOOL_PERMISSIONS.PUBLISH_CHECK],
    guidance: 'Review and report. Do not modify anything — you have no write tools in this run.',
  },
};

export function scopePermissions(scope) {
  return SCOPES[scope]?.permissions || SCOPES.review.permissions;
}

const BASE_SYSTEM_PROMPT = `You are the editing assistant inside MDTeX, a local academic writing and
publishing workspace for Markdown and LaTeX articles that are published to WeChat, Zhihu, PDF and a blog.

You work through the MDTeX tools. You cannot see or touch the user's filesystem directly — the tools are
the whole of your access, and MDTeX validates, diffs and checkpoints everything you write, so the user can
undo any change you make.

Working rules:
- Read before you write. Call read_source (and read_theme when styling) first.
- Prefer apply_patch over write_source. Small, reviewable edits are the point.
- Preserve every mathematical expression exactly unless the user asked you to change it. Formula count
  is validated on publish, and a dropped equation is a build failure.
- Never invent citations, references, data or results.
- When a build tool reports an error, fix the cause rather than working around the symptom.
- Finish with one short paragraph describing what you changed and why. Do not paste the whole document back.`;

/**
 * Build the task context MDTeX sends with every run.
 * This is deliberately assembled here, not by the backend, so all three
 * backends see the same picture of the workspace.
 */
export function buildContext({ article, source, selection, themeName, platform, scope, environment, latest }) {
  const lines = [];

  lines.push('## Current MDTeX state');
  if (article) {
    lines.push(`- Article: "${article.title}" (id ${article.id}, ${article.sourceFormat}, ${article.sourceFile})`);
    lines.push(`- Language: ${article.language}`);
    if (article.tags?.length) lines.push(`- Tags: ${article.tags.join(', ')}`);
    if (article.series) lines.push(`- Series: ${article.series}`);
    lines.push(`- Publish targets: ${(article.targets || []).join(', ') || 'none'}`);
    lines.push(`- WeChat theme: ${themeName || article.theme}`);
    lines.push(`- PDF template: ${article.pdfTemplate} (${article.pdfEngine})`);
  } else {
    lines.push('- No saved article: the editor holds an unsaved buffer.');
  }

  lines.push(`- Editor buffer: ${String(source ?? '').split('\n').length} lines, ${String(source ?? '').length} characters`);
  if (selection?.text) {
    lines.push(`- The user has selected ${selection.text.length} characters (offsets ${selection.start}–${selection.end}).`);
    lines.push('  Unless told otherwise, scope your edit to that selection.');
  }
  lines.push(`- Preview target: ${platform || 'wechat'}`);

  if (environment) {
    lines.push(`- LaTeX: ${environment.available
      ? `${environment.distribution}, engines ${Object.keys(environment.engines).join(', ')}`
      : 'not installed on this machine — compile_pdf will fail'}`);
  }

  if (latest?.pdf) {
    lines.push(`- Last PDF build: ${latest.pdf.success ? 'succeeded' : 'failed'}${latest.pdf.errorCount ? ` with ${latest.pdf.errorCount} error(s)` : ''}`);
  }
  if (latest?.wechat) {
    lines.push(`- Last WeChat build: ${latest.wechat.valid ? 'valid' : 'has issues'}, ${latest.wechat.formulas ?? '?'} formulas`);
  }

  lines.push('');
  lines.push('## This run');
  lines.push(`- Scope: ${SCOPES[scope]?.label || scope}`);
  lines.push(`- ${SCOPES[scope]?.guidance || ''}`);

  return lines.join('\n');
}

/**
 * Run one AI request end to end.
 *
 * @param {object} options
 * @param {object} options.backend       an AiBackend
 * @param {ToolExecutor} options.executor
 * @param {string} options.prompt
 * @param {string} options.scope
 * @param {string} options.context       from buildContext()
 * @param {object} options.bridge        { apiUrl, token, runId } for CLI backends
 * @param {AbortSignal} options.signal
 * @param {(event) => void} options.onEvent
 */
export async function runAiRequest({
  backend, executor, prompt, scope, context, bridge, signal, onEvent = () => {},
}) {
  const permissions = executor.permissions;
  const isCliBackend = backend.type === BACKEND_TYPES.LOCAL_CLAUDE;

  const systemPrompt = isCliBackend
    ? `${BASE_SYSTEM_PROMPT}\n\nAvailable MDTeX tools (exposed to you as mcp__mdtex__*):\n${toolInstructions(permissions)}`
    : BASE_SYSTEM_PROMPT;

  const userMessage = `${context}\n\n## Request\n${prompt}`;

  onEvent({ kind: 'progress', phase: 'thinking', message: 'Sending the request…' });

  const result = await backend.run({
    systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
    tools: isCliBackend ? undefined : toolDefinitionsForApi(permissions),
    signal,
    bridge,
    onText: (text) => onEvent({ kind: 'assistant-text', text }),
    onToolUse: (name, input) => onEvent({ kind: 'tool-use', tool: name, input: summarise(input) }),
    onToolCall: async (name, input) => {
      onEvent({ kind: 'progress', phase: 'tool', message: `Running ${name}…` });
      const toolResult = await executor.run(name, input);
      onEvent({ kind: 'tool-result', tool: name, ok: !toolResult?.error, error: toolResult?.error || null });
      return toolResult;
    },
  });

  const changes = executor.describeChanges();

  return {
    ok: result.ok,
    error: result.error || null,
    text: result.text || '',
    turns: result.turns || 0,
    usage: result.usage || null,
    toolLog: executor.log,
    changes,
    hasChanges: changes.length > 0,
    scope,
  };
}

function summarise(input) {
  const out = {};
  for (const [key, value] of Object.entries(input || {})) {
    out[key] = typeof value === 'string' && value.length > 80
      ? `${value.slice(0, 80)}…`
      : value;
  }
  return out;
}

export { ToolExecutor, TOOL_PERMISSIONS };
