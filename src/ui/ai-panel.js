import {
  el, clear, toast, modal, field, confirmDialog, contextMenu, relativeTime, spinner,
} from './ui-kit.js';
import { backend, followJob, CancelledError } from './api.js';
import { app, emit } from './state.js';
import { t } from './i18n.js';

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

// ── Backend-described text, in the interface language ─────────────────────────
//
// The backend describes the connection options (labels, summaries, form
// fields) in English, because it also serves the CLI. The panel shows them in
// the interface language by what they *are* — backend type, field name, model
// id — and falls back to the backend's own words for anything it does not know,
// so a new option appears in English rather than not at all.

function backendLabel(type, fallback) {
  const labels = {
    'local-claude': () => t('ai.backend.local'),
    'remote-claudeclaw': () => t('ai.backend.remote'),
    'anthropic-api': () => t('ai.backend.api'),
  };
  return labels[type]?.() ?? fallback ?? type;
}

function optionText(option) {
  const text = {
    'local-claude': () => ({
      summary: t('ai.option.local.summary'),
      detail: option.detected
        ? (/^Found at /.test(option.detail || '')
          ? t('ai.option.local.found', { path: option.detail.replace(/^Found at /, '') })
          : option.detail)
        : t('ai.option.local.missing'),
    }),
    'remote-claudeclaw': () => ({ summary: t('ai.option.remote.summary'), detail: t('ai.option.remote.detail') }),
    'anthropic-api': () => ({ summary: t('ai.option.api.summary'), detail: t('ai.option.api.detail') }),
  }[option.type]?.() || {};
  return {
    label: backendLabel(option.type, option.label),
    summary: text.summary ?? option.summary,
    detail: text.detail ?? option.detail,
  };
}

function fieldLabel(option, spec) {
  const labels = {
    name: () => t('ai.field.name'),
    transport: () => t('ai.field.transport'),
    host: () => t('ai.field.host'),
    port: () => t('ai.field.port'),
    sshTarget: () => t('ai.field.sshTarget'),
    remoteHost: () => t('ai.field.remoteHost'),
    remotePort: () => t('ai.field.remotePort'),
    basePath: () => t('ai.field.basePath'),
    workspace: () => t('ai.field.workspace'),
    authHeader: () => t('ai.field.authHeader'),
    secret: () => (option.type === 'anthropic-api' ? t('ai.field.apiKey') : t('ai.field.authToken')),
    model: () => t('ai.field.model'),
    effort: () => t('ai.field.effort'),
  };
  return labels[spec.name]?.() ?? spec.label;
}

/** Only placeholders that are words; hosts, ports and key prefixes stay as they are. */
function fieldPlaceholder(spec) {
  const words = {
    Workstation: () => t('ai.field.placeholder.workstation'),
    optional: () => t('ai.field.placeholder.optional'),
    'stored locally, never shown again': () => t('ai.field.placeholder.secret'),
  };
  return words[spec.placeholder]?.() ?? spec.placeholder;
}

function fieldOptions(spec) {
  if (!spec.options) return spec.options;
  if (spec.name === 'transport') {
    return spec.options.map(o => (o.value === 'ssh' ? { ...o, label: t('ai.field.transport.ssh') } : o));
  }
  if (spec.name === 'effort') {
    const levels = {
      low: () => t('ai.effort.low'),
      medium: () => t('ai.effort.medium'),
      high: () => t('ai.effort.high'),
      xhigh: () => t('ai.effort.xhigh'),
      max: () => t('ai.effort.max'),
    };
    return spec.options.map(o => ({ ...o, label: levels[o.value]?.() ?? o.label }));
  }
  if (spec.name === 'model') {
    const notes = {
      'claude-opus-5': () => t('ai.model.note.opus'),
      'claude-sonnet-5': () => t('ai.model.note.sonnet'),
      'claude-haiku-4-5': () => t('ai.model.note.haiku'),
    };
    return spec.options.map(o => {
      // A label carrying a note reads "Claude Opus 5 — note"; the name stays, the note is translated.
      const [model, note] = String(o.label).split(' — ');
      if (!note || !notes[o.value]) return o;
      return { ...o, label: t('ai.model.withNote', { model, note: notes[o.value]() }) };
    });
  }
  return spec.options;
}

/** The backend's own progress lines, where they are known. Tool names and errors stay as given. */
function progressText(event) {
  if (event.phase === 'thinking') return t('ai.progress.thinking');
  const running = /^Running (.+)…$/.exec(event.message || '');
  if (running) return t('ai.progress.running', { tool: running[1] });
  return event.message;
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
      el('p', {}, t('ai.welcome.ask')),
      el('p', { class: 'muted' }, t('ai.welcome.diffs')),
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
      el('span', { class: 'ai-status disconnected' }, t('ai.header.disconnected')),
    );
  }

  return el('div', { class: 'ai-header' },
    el('button', {
      class: 'ai-backend-switch',
      title: t('ai.header.switch'),
      onClick: (e) => backendMenu(e),
    },
      el('span', { class: `ai-dot ${profile.lastTestOk === false ? 'warn' : 'ok'}` }),
      el('span', { class: 'ai-backend-name' }, profile.name),
      el('span', { class: 'ai-backend-type' }, backendLabel(profile.type, profile.typeLabel)),
      el('span', { class: 'caret' }, '▾'),
    ),
    profile.model ? el('span', { class: 'ai-model' }, profile.model) : null,
    el('div', { class: 'ai-header-actions' },
      el('button', { class: 'icon-btn', title: t('ai.header.manage'), 'aria-label': t('ai.header.manage'), onClick: () => openConnectionManager() }, '⚙'),
    ),
  );
}

function backendMenu(event) {
  const items = app.ai.profiles.map(profile => ({
    label: t('ai.menu.item', { name: profile.name, type: backendLabel(profile.type, profile.typeLabel) }),
    icon: profile.id === app.ai.activeProfileId ? '●' : '○',
    onClick: async () => {
      if (profile.id === app.ai.activeProfileId) return;
      await backend.ai.activate(profile.id);
      await refreshAi();
      // Changing the backend takes effect immediately — no restart.
      toast(t('ai.toast.nowUsing', { name: profile.name }));
    },
  }));

  items.push({ separator: true });
  items.push({ label: t('ai.menu.add'), onClick: () => openQuickConnect() });
  items.push({ label: t('ai.menu.manage'), onClick: () => openConnectionManager() });

  contextMenu(event, items);
}

// ── Quick connect ─────────────────────────────────────────────────────────────

function quickConnectPanel() {
  const panel = el('div', { class: 'quick-connect' },
    el('h3', {}, t('ai.quick.title')),
    el('p', { class: 'muted' }, t('ai.quick.intro')),
  );

  const list = el('div', { class: 'quick-connect-list' });
  for (const option of app.ai.quickConnect) {
    list.append(quickOptionButton(option, {
      className: `quick-option${option.detected === false ? ' unavailable' : ''}`,
      onClick: () => startQuickConnect(option),
    }));
  }
  panel.append(list);
  return panel;
}

function quickOptionButton(option, { className, onClick }) {
  const text = optionText(option);
  return el('button', { class: className, onClick },
    el('div', { class: 'quick-option-head' },
      el('span', { class: 'quick-option-label' }, text.label),
      option.detected === true ? el('span', { class: 'badge badge-ok' }, t('ai.quick.detected'))
        : option.detected === false ? el('span', { class: 'badge badge-muted' }, t('ai.quick.notFound'))
        : null,
    ),
    el('p', { class: 'quick-option-summary' }, text.summary),
    el('p', { class: 'quick-option-detail' }, text.detail),
  );
}

export function openQuickConnect() {
  return modal({
    title: t('ai.quick.title'),
    subtitle: t('ai.quick.subtitle'),
    width: 560,
    render: (ctx) => {
      const list = el('div', { class: 'quick-connect-list' });
      for (const option of app.ai.quickConnect) {
        list.append(quickOptionButton(option, {
          className: 'quick-option',
          onClick: () => { ctx.close(); startQuickConnect(option); },
        }));
      }
      return list;
    },
    actions: [{ label: t('ai.action.close'), value: undefined }],
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
      title: t('ai.local.notFoundTitle'),
      width: 480,
      render: () => [
        el('p', { class: 'dialog-message' }, t('ai.local.notFoundMessage')),
        el('p', { class: 'dialog-detail' }, optionText(option).detail),
        el('p', { class: 'dialog-detail' }, t('ai.local.notFoundHelp')),
      ],
      actions: [
        { label: t('ai.action.close'), value: undefined },
        {
          label: t('ai.action.checkAgain'),
          variant: 'primary',
          onClick: async (ctx) => {
            ctx.close();
            await refreshAi();
            const fresh = app.ai.quickConnect.find(o => o.type === 'local-claude');
            if (fresh?.detected) connectLocalClaude(fresh);
            else toast(t('ai.toast.stillNotFound'), { type: 'error' });
            return false;
          },
        },
      ],
    });
    return;
  }

  let statusNode;
  await modal({
    title: backendLabel('local-claude', option.label),
    subtitle: optionText(option).detail,
    width: 500,
    render: () => {
      statusNode = el('div', { class: 'connection-status' }, spinner(t('ai.local.testing')));
      return [
        el('p', { class: 'dialog-message' }, t('ai.local.explain')),
        statusNode,
      ];
    },
    onOpen: async (ctx) => {
      const test = async () => {
        clear(statusNode);
        statusNode.append(spinner(t('ai.local.testing')));
        const result = await runTest({ type: 'local-claude', name: 'Local Claude Code', save: true });
        clear(statusNode);
        if (result?.ok) {
          statusNode.append(el('div', { class: 'status-ok' },
            el('strong', {}, t('ai.status.connected')), result.detail ? ` ${result.detail}` : ''));
          await refreshAi();
          setTimeout(() => ctx.close(true), 700);
          toast(t('ai.toast.nowActive', { name: backendLabel('local-claude', option.label) }));
        } else if (result?.remedy === 'sign-in-claude-code') {
          statusNode.append(signInCard(result, { onSignedIn: test }));
        } else {
          statusNode.append(el('div', { class: 'status-error' }, result?.error || t('ai.error.testFailed')));
        }
      };
      await test();
    },
    actions: [{ label: t('ai.action.close'), value: undefined }],
  });

  // Closing the dialog abandons a sign-in still waiting for its code, so the
  // CLI is not left running.
  if (signIn.id) backend.ai.signIn.cancel(signIn.id).catch(() => {});
  signIn.id = null;
}

/** The sign-in attempt owned by the open dialog. */
const signIn = { id: null };

/**
 * Claude Code is installed but has no working sign-in.
 *
 * Two ways through, both on screen: sign in from here — MDTeX runs
 * `claude auth login`, the browser opens, and the code Claude shows is pasted
 * back — or run the same command in a terminal and check again.
 */
function signInCard(result, { onSignedIn }) {
  const card = el('div', { class: 'sign-in-card' });
  const status = el('div', { class: 'sign-in-status' });

  const startButton = el('button', { class: 'btn btn-primary btn-sm', type: 'button', onClick: () => start() },
    t('ai.signIn.start'));
  const checkButton = el('button', { class: 'btn btn-sm', type: 'button', onClick: () => onSignedIn() },
    t('ai.action.checkAgain'));

  card.append(
    el('div', { class: 'status-error' }, result.error),
    el('p', { class: 'dialog-detail' }, t('ai.signIn.explain')),
    el('div', { class: 'sign-in-actions' }, startButton, checkButton),
    status,
    el('p', { class: 'dialog-detail muted' }, t('ai.signIn.orTerminal')),
    el('div', { class: 'command-line' },
      el('code', {}, 'claude auth login'),
      el('button', {
        class: 'btn btn-xs',
        type: 'button',
        onClick: async () => {
          try {
            await navigator.clipboard.writeText('claude auth login');
            toast(t('ai.toast.commandCopied'));
          } catch {
            toast(t('ai.toast.copyFailed'), { type: 'error' });
          }
        },
      }, t('ai.action.copy')),
    ),
  );

  async function start() {
    startButton.disabled = true;
    clear(status);
    status.append(spinner(t('ai.signIn.starting')));
    let attempt;
    try {
      attempt = await backend.ai.signIn.start();
    } catch (e) {
      attempt = { state: 'failed', detail: e.message };
    }
    clear(status);
    signIn.id = attempt.id || null;

    if (attempt.state === 'succeeded') {
      signIn.id = null;
      return onSignedIn();
    }
    if (attempt.state !== 'waiting-for-code') {
      signIn.id = null;
      status.append(el('div', { class: 'status-error' },
        attempt.detail || t('ai.signIn.couldNotStart')));
      startButton.disabled = false;
      return;
    }

    const input = el('input', {
      class: 'field-input',
      type: 'text',
      placeholder: t('ai.signIn.codePlaceholder'),
      'aria-label': t('ai.signIn.codePlaceholder'),
      autocomplete: 'off',
      spellcheck: 'false',
      onKeyDown: (e) => { if (e.key === 'Enter') { e.preventDefault(); finish(); } },
    });
    const finishButton = el('button', { class: 'btn btn-primary btn-sm', type: 'button', onClick: () => finish() },
      t('ai.signIn.finish'));
    const message = el('div', { class: 'sign-in-message' });

    // The link sits inside a sentence whose word order differs by language, so
    // the sentence is split at its {link} placeholder and the anchor put there.
    const reopen = attempt.url
      ? t('ai.signIn.reopen').split('{link}').flatMap((part, i) => (i === 0 ? [part] : [
          el('a', { href: attempt.url, target: '_blank', rel: 'noopener noreferrer' }, t('ai.signIn.reopenLink')),
          part,
        ]))
      : [];

    status.append(
      el('p', { class: 'dialog-detail' },
        t('ai.signIn.opened'),
        attempt.url ? ' ' : null,
        ...reopen),
      el('div', { class: 'sign-in-code' }, input, finishButton),
      message,
    );
    input.focus();

    async function finish() {
      if (!input.value.trim() || finishButton.disabled) return;
      finishButton.disabled = true;
      input.disabled = true;
      clear(message);
      message.append(spinner(t('ai.signIn.signingIn')));
      let outcome;
      try {
        outcome = await backend.ai.signIn.submitCode(attempt.id, input.value);
      } catch (e) {
        outcome = { state: 'failed', detail: e.message };
      }
      clear(message);
      if (outcome.state === 'succeeded') {
        signIn.id = null;
        toast(t('ai.toast.signedIn'));
        return onSignedIn();
      }
      message.append(el('div', { class: 'status-error' }, outcome.detail || t('ai.signIn.incomplete')));
      if (outcome.state === 'waiting-for-code') {
        finishButton.disabled = false;
        input.disabled = false;
        input.select();
      } else {
        signIn.id = null;
        startButton.disabled = false;
      }
    }
  }

  return card;
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

  const text = optionText(option);

  await modal({
    title: text.label,
    subtitle: text.summary,
    width: 560,
    render: () => {
      const grid = el('div', { class: 'field-grid' });
      for (const spec of option.fields) {
        fields[spec.name] = field({
          label: fieldLabel(option, spec),
          type: spec.type,
          value: spec.default ?? '',
          placeholder: fieldPlaceholder(spec),
          options: fieldOptions(spec),
          wide: spec.type === 'password' || spec.name === 'name',
          hint: spec.name === 'secret' ? t('ai.field.secretHint') : null,
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
      { label: t('ai.action.cancel'), value: undefined },
      {
        label: t('ai.action.testConnection'),
        ref: (b) => { testButton = b; },
        closes: false,
        onClick: async () => {
          const values = readValues();
          for (const spec of option.fields) {
            if (spec.required && !String(values[spec.name] ?? '').trim()) {
              fields[spec.name].setError(t('ai.field.required', { field: fieldLabel(option, spec) }));
              return false;
            }
            fields[spec.name].setError(null);
          }

          clear(statusNode);
          statusNode.append(spinner(t('ai.status.testing')));
          testButton.disabled = true;

          const result = await runTest({ ...values, save: false });

          testButton.disabled = false;
          clear(statusNode);
          if (result?.ok) {
            tested = true;
            if (saveButton) saveButton.disabled = false;
            statusNode.append(el('div', { class: 'status-ok' },
              el('strong', {}, t('ai.status.works')), result.detail ? ` ${result.detail}` : ''));
          } else {
            tested = false;
            statusNode.append(el('div', { class: 'status-error' }, result?.error || t('ai.error.testFailed')));
          }
          return false;
        },
      },
      {
        label: t('ai.action.saveAndUse'),
        variant: 'primary',
        disabled: true,
        ref: (b) => { saveButton = b; },
        onClick: async (ctx) => {
          const values = readValues();
          try {
            const { profile } = await backend.ai.save(values);
            await backend.ai.activate(profile.id);
            await refreshAi();
            toast(t('ai.toast.nowActive', { name: profile.name }));
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
      listNode.append(el('p', { class: 'muted' }, t('ai.manager.empty')));
      return;
    }
    for (const profile of app.ai.profiles) {
      listNode.append(el('div', { class: `connection-row${profile.active ? ' active' : ''}` },
        el('div', { class: 'connection-main' },
          el('div', { class: 'connection-name' },
            profile.name,
            profile.active ? el('span', { class: 'badge badge-ok' }, t('ai.manager.active')) : null),
          el('div', { class: 'connection-detail' },
            backendLabel(profile.type, profile.typeLabel),
            profile.model ? ` · ${profile.model}` : '',
            profile.transport ? ` · ${profile.transport}` : '',
            profile.secretConfigured ? ` · ${t('ai.manager.key', { fingerprint: profile.secretFingerprint })}` : '',
          ),
          profile.lastTestedAt
            ? el('div', { class: `connection-test ${profile.lastTestOk ? 'ok' : 'bad'}` },
                profile.lastTestOk
                  ? t('ai.manager.testedOk', { when: relativeTime(profile.lastTestedAt) })
                  : t('ai.manager.lastTestFailed', { when: relativeTime(profile.lastTestedAt) }))
            : null,
        ),
        el('div', { class: 'connection-actions' },
          !profile.active ? el('button', {
            class: 'btn btn-sm',
            onClick: async () => {
              await backend.ai.activate(profile.id);
              await refreshAi();
              rerender(listNode);
              toast(t('ai.toast.nowUsing', { name: profile.name }));
            },
          }, t('ai.action.use')) : null,
          el('button', {
            class: 'btn btn-sm',
            onClick: async (e) => {
              const button = e.currentTarget;
              button.disabled = true;
              button.textContent = t('ai.status.testing');
              const result = await runTest({ id: profile.id });
              await refreshAi();
              rerender(listNode);
              toast(result?.ok
                ? t('ai.toast.testResult', { name: profile.name, detail: result.detail || t('ai.manager.connected') })
                : (result?.error || t('ai.toast.testFailed')),
                { type: result?.ok ? 'success' : 'error', timeout: 5000 });
            },
          }, t('ai.action.test')),
          el('button', {
            class: 'btn btn-sm btn-danger-ghost',
            onClick: async () => {
              const ok = await confirmDialog({
                title: t('ai.manager.removeTitle'),
                message: t('ai.manager.removeMessage', { name: profile.name }),
                detail: profile.secretConfigured ? t('ai.manager.removeDetail') : null,
                confirmLabel: t('ai.action.remove'),
                danger: true,
              });
              if (!ok) return;
              await backend.ai.remove(profile.id);
              await refreshAi();
              rerender(listNode);
              toast(t('ai.toast.removed'));
            },
          }, t('ai.action.remove')),
        ),
      ));
    }
  };

  return modal({
    title: t('ai.manager.title'),
    subtitle: t('ai.manager.subtitle'),
    width: 620,
    render: () => {
      const list = el('div', { class: 'connection-list' });
      rerender(list);
      return list;
    },
    actions: [
      { label: t('ai.manager.add'), closes: false, onClick: (ctx) => { ctx.close(); openQuickConnect(); return false; } },
      { label: t('ai.action.done'), variant: 'primary', value: true },
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
    placeholder: t('ai.prompt.placeholder'),
    onKeyDown: (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || !e.shiftKey)) {
        e.preventDefault();
        send();
      }
    },
  });
  nodes.prompt = input;

  const sendButton = el('button', { class: 'btn btn-primary btn-sm', onClick: () => send() }, t('ai.action.send'));
  nodes.send = sendButton;

  const cancelButton = el('button', {
    class: 'btn btn-sm hidden',
    onClick: () => activeJob?.cancel(),
  }, t('ai.action.stop'));
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
    // Interface-authored progress keeps its key, so it follows a language change.
    return el('div', { class: 'ai-msg progress' }, message.textKey ? t(message.textKey) : message.text);
  }

  if (message.role === 'error' && message.remedy === 'sign-in-claude-code') {
    // Kept on the message: the panel re-renders while other things happen,
    // and a half-finished sign-in must survive that.
    message.card = message.card || signInCard({ error: message.text }, {
      onSignedIn: async () => {
        const result = await runTest({ id: app.ai.activeProfileId });
        if (!result?.ok) {
          toast(result?.error || t('ai.toast.stillNotSignedIn'), { type: 'error', timeout: 6000 });
          return;
        }
        message.role = 'progress';
        message.textKey = 'ai.msg.signedInRetry';
        message.remedy = null;
        message.card = null;
        await refreshAi();
      },
    });
    return el('div', { class: 'ai-msg error' }, message.card);
  }

  if (message.role === 'error') {
    return el('div', { class: 'ai-msg error' }, message.text);
  }

  const node = el('div', { class: 'ai-msg assistant' },
    el('div', { class: 'ai-msg-text' }, message.text || t('ai.msg.noReply')));

  if (message.toolLog?.length) {
    node.append(el('details', { class: 'ai-tools' },
      el('summary', {}, t('ai.msg.toolCalls', { n: message.toolLog.length })),
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
        el('div', { class: 'ai-change-head' }, t('ai.msg.metadata')),
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
    wrap.append(el('div', { class: 'ai-applied' }, message.checkpointId
      ? t('ai.msg.appliedCheckpoint', { id: message.checkpointId })
      : t('ai.msg.applied')));
    return wrap;
  }

  wrap.append(el('div', { class: 'ai-change-actions' },
    el('button', {
      class: 'btn btn-primary btn-sm',
      onClick: async (e) => {
        e.currentTarget.disabled = true;
        await applyRun(message);
      },
    }, t('ai.action.apply')),
    el('button', { class: 'btn btn-sm', onClick: () => discardRun(message) }, t('ai.action.discard')),
  ));

  return wrap;
}

async function discardRun(message) {
  if (message.discarded || message.applied) return;
  message.discarded = true;
  emit('ai:proposal-cleared');
  await backend.ai.discard(message.runId).catch(() => {});
  message.changes = [];
  render();
  toast(t('ai.toast.discarded'));
}

/** Show a run's source change on both sides of the workspace for review. */
function proposeOnScreen(message) {
  const change = message.changes?.find(c => c.kind === 'source' && typeof c.content === 'string');
  if (!change) return;
  emit('ai:proposal', {
    source: change.content,
    stats: change.stats,
    apply: () => applyRun(message),
    discard: () => discardRun(message),
  });
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
  if (message.applied || message.applying || message.discarded) return;
  message.applying = true;
  try {
    const result = await backend.ai.apply(message.runId, 'AI edit');
    message.applied = true;
    message.checkpointId = result.checkpoint?.id || null;
    emit('ai:applied', result);
    render();
    toast(t('ai.toast.applied'));
  } catch (e) {
    message.applying = false;
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

  const progressMessage = pushMessage({ role: 'progress', textKey: 'ai.progress.sending' });

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
          progressMessage.textKey = 'ai.progress.writing';
        } else if (event.message) {
          progressMessage.textKey = null;
          progressMessage.text = progressText(event);
        }
        render();
      },
    });

    const result = await activeJob.promise;

    nodes.history = nodes.history.filter(m => m !== progressMessage);

    if (!result.ok) {
      pushMessage({ role: 'error', text: result.error || t('ai.error.requestFailed'), remedy: result.remedy || null });
    } else {
      pushMessage({
        role: 'assistant',
        text: result.text || '',
        toolLog: result.toolLog,
        changes: result.changes,
        runId: result.runId,
      });
      if (!result.hasChanges) {
        toast(t('ai.toast.noChanges'));
      } else {
        proposeOnScreen(nodes.history[nodes.history.length - 1]);
      }
    }
  } catch (e) {
    nodes.history = nodes.history.filter(m => m !== progressMessage);
    if (e instanceof CancelledError) pushMessage({ role: 'progress', textKey: 'ai.progress.cancelled' });
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
