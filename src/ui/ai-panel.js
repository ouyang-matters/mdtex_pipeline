import {
  el, clear, toast, modal, field, confirmDialog, contextMenu, relativeTime, spinner,
} from './ui-kit.js';
import { backend, followJob, CancelledError } from './api.js';
import { app, emit } from './state.js';

/**
 * AI panel.
 *
 * When nothing is connected the panel *is* the connection flow: the three
 * options are on screen immediately, with local detection already done, so the
 * first use of the built-in AI takes one click rather than a trip through
 * Settings. Once connected, the same header becomes a fast backend switcher.
 */

let nodes = {};
let currentRun = null;
let activeJob = null;

export function initAiPanel({ root }) {
  nodes.root = root;
  render();
}

export async function refreshAi() {
  try {
    const data = await backend.ai.backends();
    app.ai.profiles = data.profiles;
    app.ai.activeProfileId = data.activeProfileId;
    app.ai.quickConnect = data.quickConnect;
    app.ai.scopes = data.scopes;
    app.ai.models = data.models;
    app.ai.effortLevels = data.effortLevels;
  } catch (e) {
    app.ai.error = e.message;
  }
  render();
}

function activeProfile() {
  return app.ai.profiles.find(p => p.id === app.ai.activeProfileId) || null;
}

export function render() {
  if (!nodes.root) return;
  clear(nodes.root);

  nodes.root.append(header());

  if (!app.ai.profiles.length) {
    nodes.root.append(quickConnectPanel());
    return;
  }

  nodes.messages = el('div', { class: 'ai-messages' });
  if (!nodes.history?.length) {
    nodes.messages.append(el('div', { class: 'ai-welcome' },
      el('p', {}, 'Ask Claude to edit this article, convert it, restyle the theme, or fix a build error.'),
      el('p', { class: 'muted' }, 'Every change is shown as a diff and checkpointed before it is applied.'),
    ));
  } else {
    for (const message of nodes.history) nodes.messages.append(renderMessage(message));
  }

  nodes.root.append(nodes.messages, composer());
  scrollMessages();
}

// ── Header / backend switcher ─────────────────────────────────────────────────

function header() {
  const profile = activeProfile();

  if (!profile) {
    return el('div', { class: 'ai-header' },
      el('span', { class: 'ai-status disconnected' }, 'No AI connection'),
    );
  }

  return el('div', { class: 'ai-header' },
    el('button', {
      class: 'ai-backend-switch',
      title: 'Switch AI backend',
      onClick: (e) => backendMenu(e),
    },
      el('span', { class: `ai-dot ${profile.lastTestOk === false ? 'warn' : 'ok'}` }),
      el('span', { class: 'ai-backend-name' }, profile.name),
      el('span', { class: 'ai-backend-type' }, profile.typeLabel),
      el('span', { class: 'caret' }, '▾'),
    ),
    profile.model ? el('span', { class: 'ai-model' }, profile.model) : null,
    el('div', { class: 'ai-header-actions' },
      el('button', { class: 'icon-btn', title: 'Manage AI connections', onClick: () => openConnectionManager() }, '⚙'),
    ),
  );
}

function backendMenu(event) {
  const items = app.ai.profiles.map(profile => ({
    label: `${profile.name} — ${profile.typeLabel}`,
    icon: profile.id === app.ai.activeProfileId ? '●' : '○',
    onClick: async () => {
      if (profile.id === app.ai.activeProfileId) return;
      await backend.ai.activate(profile.id);
      await refreshAi();
      // Changing the backend takes effect immediately — no restart.
      toast(`Now using ${profile.name}.`);
    },
  }));

  items.push({ separator: true });
  items.push({ label: 'Add a connection…', onClick: () => openQuickConnect() });
  items.push({ label: 'Manage connections…', onClick: () => openConnectionManager() });

  contextMenu(event, items);
}

// ── Quick connect ─────────────────────────────────────────────────────────────

function quickConnectPanel() {
  const panel = el('div', { class: 'quick-connect' },
    el('h3', {}, 'Connect Claude'),
    el('p', { class: 'muted' }, 'Pick how MDTeX should reach a model. You can change this at any time.'),
  );

  const list = el('div', { class: 'quick-connect-list' });
  for (const option of app.ai.quickConnect) {
    list.append(el('button', {
      class: `quick-option${option.detected === false ? ' unavailable' : ''}`,
      onClick: () => startQuickConnect(option),
    },
      el('div', { class: 'quick-option-head' },
        el('span', { class: 'quick-option-label' }, option.label),
        option.detected === true ? el('span', { class: 'badge badge-ok' }, 'detected')
          : option.detected === false ? el('span', { class: 'badge badge-muted' }, 'not found')
          : null,
      ),
      el('p', { class: 'quick-option-summary' }, option.summary),
      el('p', { class: 'quick-option-detail' }, option.detail),
    ));
  }
  panel.append(list);
  return panel;
}

export function openQuickConnect() {
  return modal({
    title: 'Connect Claude',
    subtitle: 'MDTeX gives every backend the same editing tools.',
    width: 560,
    render: (ctx) => {
      const list = el('div', { class: 'quick-connect-list' });
      for (const option of app.ai.quickConnect) {
        list.append(el('button', {
          class: 'quick-option',
          onClick: () => { ctx.close(); startQuickConnect(option); },
        },
          el('div', { class: 'quick-option-head' },
            el('span', { class: 'quick-option-label' }, option.label),
            option.detected === true ? el('span', { class: 'badge badge-ok' }, 'detected')
              : option.detected === false ? el('span', { class: 'badge badge-muted' }, 'not found') : null,
          ),
          el('p', { class: 'quick-option-summary' }, option.summary),
          el('p', { class: 'quick-option-detail' }, option.detail),
        ));
      }
      return list;
    },
    actions: [{ label: 'Close', value: undefined }],
  });
}

async function startQuickConnect(option) {
  if (option.type === 'local-claude') return connectLocalClaude(option);
  return connectWithFields(option);
}

/**
 * Local Claude Code needs no credentials: detect, test, activate.
 */
async function connectLocalClaude(option) {
  if (!option.detected) {
    await modal({
      title: 'Claude Code was not found',
      width: 480,
      render: () => [
        el('p', { class: 'dialog-message' }, 'MDTeX could not find the `claude` command on this machine.'),
        el('p', { class: 'dialog-detail' }, option.detail),
        el('p', { class: 'dialog-detail' },
          'Install Claude Code and sign in once in a terminal, then reopen this dialog. '
          + 'MDTeX also searches your npm and nvm bin directories, so a restart is not usually needed.'),
      ],
      actions: [
        { label: 'Close', value: undefined },
        {
          label: 'Check again',
          variant: 'primary',
          onClick: async (ctx) => {
            ctx.close();
            await refreshAi();
            const fresh = app.ai.quickConnect.find(o => o.type === 'local-claude');
            if (fresh?.detected) connectLocalClaude(fresh);
            else toast('Still not found.', { type: 'error' });
            return false;
          },
        },
      ],
    });
    return;
  }

  let statusNode;
  await modal({
    title: 'Local Claude Code',
    subtitle: option.detail,
    width: 500,
    render: () => {
      statusNode = el('div', { class: 'connection-status' }, spinner('Testing the connection…'));
      return [
        el('p', { class: 'dialog-message' },
          'MDTeX will use the Claude Code CLI that is already signed in on this machine. '
          + 'No credentials are entered or stored.'),
        statusNode,
      ];
    },
    onOpen: async (ctx) => {
      const result = await runTest({ type: 'local-claude', name: 'Local Claude Code', save: true });
      clear(statusNode);
      if (result?.ok) {
        statusNode.append(el('div', { class: 'status-ok' },
          el('strong', {}, 'Connected. '), result.detail || ''));
        await refreshAi();
        setTimeout(() => ctx.close(true), 700);
        toast('Local Claude Code is now the active backend.');
      } else {
        statusNode.append(el('div', { class: 'status-error' }, result?.error || 'The connection test failed.'));
      }
    },
    actions: [{ label: 'Close', value: undefined }],
  });
}

/**
 * Field-driven connection dialog for ClaudeClaw and the Anthropic API.
 */
async function connectWithFields(option) {
  const fields = {};
  let statusNode;
  let testButton;
  let saveButton;
  let tested = false;

  const readValues = () => {
    const values = { type: option.type };
    for (const [name, f] of Object.entries(fields)) values[name] = f.get();
    return values;
  };

  const applyVisibility = () => {
    for (const spec of option.fields) {
      if (!spec.showWhen) continue;
      const [key, expected] = Object.entries(spec.showWhen)[0];
      fields[spec.name]?.show(fields[key]?.get() === expected);
    }
  };

  await modal({
    title: option.label,
    subtitle: option.summary,
    width: 560,
    render: () => {
      const grid = el('div', { class: 'field-grid' });
      for (const spec of option.fields) {
        fields[spec.name] = field({
          label: spec.label,
          type: spec.type,
          value: spec.default ?? '',
          placeholder: spec.placeholder,
          options: spec.options,
          wide: spec.type === 'password' || spec.name === 'name',
          hint: spec.name === 'secret'
            ? 'Stored in the local secret store with owner-only permissions. It is never shown again.'
            : null,
        });
        fields[spec.name].input.addEventListener('input', () => {
          tested = false;
          if (saveButton) saveButton.disabled = true;
          applyVisibility();
        });
        fields[spec.name].input.addEventListener('change', applyVisibility);
        grid.append(fields[spec.name].node);
      }
      statusNode = el('div', { class: 'connection-status' });
      queueMicrotask(applyVisibility);
      return [grid, statusNode];
    },
    actions: [
      { label: 'Cancel', value: undefined },
      {
        label: 'Test connection',
        ref: (b) => { testButton = b; },
        closes: false,
        onClick: async () => {
          const values = readValues();
          for (const spec of option.fields) {
            if (spec.required && !String(values[spec.name] ?? '').trim()) {
              fields[spec.name].setError(`${spec.label} is required.`);
              return false;
            }
            fields[spec.name].setError(null);
          }

          clear(statusNode);
          statusNode.append(spinner('Testing…'));
          testButton.disabled = true;

          const result = await runTest({ ...values, save: false });

          testButton.disabled = false;
          clear(statusNode);
          if (result?.ok) {
            tested = true;
            if (saveButton) saveButton.disabled = false;
            statusNode.append(el('div', { class: 'status-ok' },
              el('strong', {}, 'Connection works. '), result.detail || ''));
          } else {
            tested = false;
            statusNode.append(el('div', { class: 'status-error' }, result?.error || 'The connection test failed.'));
          }
          return false;
        },
      },
      {
        label: 'Save and use',
        variant: 'primary',
        disabled: true,
        ref: (b) => { saveButton = b; },
        onClick: async (ctx) => {
          const values = readValues();
          try {
            const { profile } = await backend.ai.save(values);
            await backend.ai.activate(profile.id);
            await refreshAi();
            toast(`${profile.name} is now the active backend.`);
            ctx.close(profile);
          } catch (e) {
            clear(statusNode);
            statusNode.append(el('div', { class: 'status-error' }, e.message));
            return false;
          }
          return false;
        },
      },
    ],
  });

  return tested;
}

async function runTest(payload) {
  try {
    const { jobId } = await backend.ai.test(payload);
    return await followJob(jobId).promise;
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── Connection manager ────────────────────────────────────────────────────────

export function openConnectionManager() {
  const rerender = (listNode) => {
    clear(listNode);
    if (!app.ai.profiles.length) {
      listNode.append(el('p', { class: 'muted' }, 'No connections yet.'));
      return;
    }
    for (const profile of app.ai.profiles) {
      listNode.append(el('div', { class: `connection-row${profile.active ? ' active' : ''}` },
        el('div', { class: 'connection-main' },
          el('div', { class: 'connection-name' },
            profile.name,
            profile.active ? el('span', { class: 'badge badge-ok' }, 'active') : null),
          el('div', { class: 'connection-detail' },
            profile.typeLabel,
            profile.model ? ` · ${profile.model}` : '',
            profile.transport ? ` · ${profile.transport}` : '',
            profile.secretConfigured ? ` · key ${profile.secretFingerprint}` : '',
          ),
          profile.lastTestedAt
            ? el('div', { class: `connection-test ${profile.lastTestOk ? 'ok' : 'bad'}` },
                `${profile.lastTestOk ? 'Tested OK' : 'Last test failed'} ${relativeTime(profile.lastTestedAt)}`)
            : null,
        ),
        el('div', { class: 'connection-actions' },
          !profile.active ? el('button', {
            class: 'btn btn-sm',
            onClick: async () => {
              await backend.ai.activate(profile.id);
              await refreshAi();
              rerender(listNode);
              toast(`Now using ${profile.name}.`);
            },
          }, 'Use') : null,
          el('button', {
            class: 'btn btn-sm',
            onClick: async (e) => {
              const button = e.currentTarget;
              button.disabled = true;
              button.textContent = 'Testing…';
              const result = await runTest({ id: profile.id });
              await refreshAi();
              rerender(listNode);
              toast(result?.ok ? `${profile.name}: ${result.detail || 'connected'}` : (result?.error || 'Test failed'),
                { type: result?.ok ? 'success' : 'error', timeout: 5000 });
            },
          }, 'Test'),
          el('button', {
            class: 'btn btn-sm btn-danger-ghost',
            onClick: async () => {
              const ok = await confirmDialog({
                title: 'Remove connection?',
                message: `“${profile.name}” will be removed.`,
                detail: profile.secretConfigured ? 'Its stored credential will be deleted too.' : null,
                confirmLabel: 'Remove',
                danger: true,
              });
              if (!ok) return;
              await backend.ai.remove(profile.id);
              await refreshAi();
              rerender(listNode);
              toast('Connection removed.');
            },
          }, 'Remove'),
        ),
      ));
    }
  };

  return modal({
    title: 'AI connections',
    subtitle: 'Local Claude Code, Remote ClaudeClaw and the Anthropic API all get the same editing tools.',
    width: 620,
    render: () => {
      const list = el('div', { class: 'connection-list' });
      rerender(list);
      return list;
    },
    actions: [
      { label: 'Add connection…', closes: false, onClick: (ctx) => { ctx.close(); openQuickConnect(); return false; } },
      { label: 'Done', variant: 'primary', value: true },
    ],
  });
}

// ── Composer and runs ─────────────────────────────────────────────────────────

function composer() {
  const scopeSelect = el('select', { class: 'ai-scope' });
  for (const scope of app.ai.scopes || []) {
    scopeSelect.append(el('option', { value: scope.value }, scope.label));
  }
  nodes.scope = scopeSelect;

  const input = el('textarea', {
    class: 'ai-prompt',
    rows: 2,
    placeholder: 'e.g. Tighten section 3 and fix the equation numbering…',
    onKeyDown: (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || !e.shiftKey)) {
        e.preventDefault();
        send();
      }
    },
  });
  nodes.prompt = input;

  const sendButton = el('button', { class: 'btn btn-primary btn-sm', onClick: () => send() }, 'Send');
  nodes.send = sendButton;

  const cancelButton = el('button', {
    class: 'btn btn-sm hidden',
    onClick: () => activeJob?.cancel(),
  }, 'Stop');
  nodes.cancel = cancelButton;

  return el('div', { class: 'ai-composer' },
    el('div', { class: 'ai-composer-row' }, scopeSelect, sendButton, cancelButton),
    input,
  );
}

function renderMessage(message) {
  if (message.role === 'user') {
    return el('div', { class: 'ai-msg user' },
      el('span', { class: 'ai-msg-scope' }, message.scope),
      el('div', {}, message.text));
  }

  if (message.role === 'progress') {
    return el('div', { class: 'ai-msg progress' }, message.text);
  }

  if (message.role === 'error') {
    return el('div', { class: 'ai-msg error' }, message.text);
  }

  const node = el('div', { class: 'ai-msg assistant' }, el('div', { class: 'ai-msg-text' }, message.text || ''));

  if (message.toolLog?.length) {
    node.append(el('details', { class: 'ai-tools' },
      el('summary', {}, `${message.toolLog.length} tool call${message.toolLog.length === 1 ? '' : 's'}`),
      el('ul', {}, ...message.toolLog.map(entry =>
        el('li', { class: entry.ok ? '' : 'failed' }, entry.tool))),
    ));
  }

  if (message.changes?.length) {
    node.append(changesBlock(message));
  }

  return node;
}

function changesBlock(message) {
  const wrap = el('div', { class: 'ai-changes' });

  for (const change of message.changes) {
    if (change.kind === 'metadata') {
      wrap.append(el('div', { class: 'ai-change' },
        el('div', { class: 'ai-change-head' }, 'Article metadata'),
        el('pre', { class: 'ai-diff' }, JSON.stringify(change.patch, null, 2)),
      ));
      continue;
    }

    wrap.append(el('div', { class: 'ai-change' },
      el('div', { class: 'ai-change-head' },
        el('span', {}, change.file),
        el('span', { class: 'diff-stat' },
          el('span', { class: 'added' }, `+${change.stats.added}`),
          el('span', { class: 'removed' }, `−${change.stats.removed}`)),
      ),
      el('pre', { class: 'ai-diff' }, ...highlightDiff(change.diff)),
    ));
  }

  if (message.applied) {
    wrap.append(el('div', { class: 'ai-applied' },
      `Applied. Checkpoint ${message.checkpointId ? `“${message.checkpointId}”` : ''} saved — use Undo AI edit to revert.`));
    return wrap;
  }

  wrap.append(el('div', { class: 'ai-change-actions' },
    el('button', {
      class: 'btn btn-primary btn-sm',
      onClick: async (e) => {
        e.currentTarget.disabled = true;
        await applyRun(message);
      },
    }, 'Apply changes'),
    el('button', {
      class: 'btn btn-sm',
      onClick: async () => {
        await backend.ai.discard(message.runId).catch(() => {});
        message.changes = [];
        message.discarded = true;
        render();
        toast('Changes discarded.');
      },
    }, 'Discard'),
  ));

  return wrap;
}

function highlightDiff(diff) {
  return String(diff || '').split('\n').map(line => {
    const cls = line.startsWith('+') && !line.startsWith('+++') ? 'add'
      : line.startsWith('-') && !line.startsWith('---') ? 'del'
      : line.startsWith('@@') ? 'hunk' : '';
    return el('span', { class: `diff-line ${cls}`.trim() }, `${line}\n`);
  });
}

async function applyRun(message) {
  try {
    const result = await backend.ai.apply(message.runId, 'AI edit');
    message.applied = true;
    message.checkpointId = result.checkpoint?.id || null;
    emit('ai:applied', result);
    render();
    toast('Changes applied and checkpointed.');
  } catch (e) {
    toast(e.message, { type: 'error', timeout: 6000 });
  }
}

function pushMessage(message) {
  nodes.history = nodes.history || [];
  nodes.history.push(message);
  render();
  return message;
}

function scrollMessages() {
  if (nodes.messages) nodes.messages.scrollTop = nodes.messages.scrollHeight;
}

async function send() {
  const prompt = nodes.prompt?.value.trim();
  if (!prompt) return;
  if (app.ai.busy) return;

  const scope = nodes.scope.value;
  const scopeLabel = app.ai.scopes.find(s => s.value === scope)?.label || scope;

  nodes.prompt.value = '';
  pushMessage({ role: 'user', text: prompt, scope: scopeLabel });

  const progressMessage = pushMessage({ role: 'progress', text: 'Sending…' });

  app.ai.busy = true;
  nodes.send.disabled = true;
  nodes.cancel.classList.remove('hidden');

  try {
    const editor = document.getElementById('editor');
    const selection = editor && editor.selectionStart !== editor.selectionEnd
      ? {
          start: editor.selectionStart,
          end: editor.selectionEnd,
          text: editor.value.slice(editor.selectionStart, editor.selectionEnd),
        }
      : null;

    const { jobId, runId } = await backend.ai.run({
      prompt,
      scope,
      articleId: app.currentArticleId,
      source: app.source,
      selection,
      themeName: app.themeName,
      themeCss: app.themeCss,
      platform: app.platform,
      lastWeChat: app.target.validation
        ? { valid: app.target.validation.valid, formulas: app.target.stats?.formulas?.total }
        : null,
    });

    currentRun = runId;
    activeJob = followJob(jobId, {
      onProgress: (event) => {
        if (event.text) {
          progressMessage.text = 'Writing…';
        } else if (event.message) {
          progressMessage.text = event.message;
        }
        render();
      },
    });

    const result = await activeJob.promise;

    nodes.history = nodes.history.filter(m => m !== progressMessage);

    if (!result.ok) {
      pushMessage({ role: 'error', text: result.error || 'The AI request failed.' });
    } else {
      pushMessage({
        role: 'assistant',
        text: result.text || '(no reply)',
        toolLog: result.toolLog,
        changes: result.changes,
        runId: result.runId,
      });
      if (!result.hasChanges) {
        toast('No changes were proposed.');
      }
    }
  } catch (e) {
    nodes.history = nodes.history.filter(m => m !== progressMessage);
    if (e instanceof CancelledError) pushMessage({ role: 'progress', text: 'Cancelled.' });
    else pushMessage({ role: 'error', text: e.message });
  } finally {
    app.ai.busy = false;
    activeJob = null;
    render();
    nodes.send.disabled = false;
    nodes.cancel.classList.add('hidden');
    scrollMessages();
  }
}
