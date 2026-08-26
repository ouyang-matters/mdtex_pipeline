/**
 * MDTeX UI kit.
 *
 * Native browser `prompt()` / `confirm()` dialogs look nothing like the rest of
 * the application, cannot be styled, block the event loop and offer no
 * validation. Everything that used them now goes through this module: one
 * modal implementation, one context menu, one toast, one confirmation.
 */

// ── Element helpers ───────────────────────────────────────────────────────────

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'html') node.innerHTML = value;
    else if (key in node && key !== 'list') node[key] = value;
    else node.setAttribute(key, value);
  }

  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }

  return node;
}

/**
 * Append children, skipping nullish ones.
 *
 * Native `Node.append()` stringifies `null` into the literal text "null", so a
 * `cond ? node : null` argument silently renders the word null in the UI. Every
 * conditional append goes through this instead.
 */
export function mount(parent, ...children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false || child === true) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return parent;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── Toasts ────────────────────────────────────────────────────────────────────

let toastHost = null;

export function toast(message, { type = 'success', timeout = 2600, action = null } = {}) {
  if (!toastHost) {
    toastHost = el('div', { class: 'toast-host' });
    document.body.append(toastHost);
  }

  const node = el('div', { class: `toast toast-${type}` },
    el('span', { class: 'toast-message' }, message),
    action ? el('button', {
      class: 'toast-action',
      onClick: () => { action.onClick(); dismiss(); },
    }, action.label) : null,
  );

  const dismiss = () => {
    node.classList.add('leaving');
    setTimeout(() => node.remove(), 180);
  };

  node.addEventListener('click', (e) => {
    if (e.target.closest('.toast-action')) return;
    dismiss();
  });

  toastHost.append(node);
  if (timeout > 0) setTimeout(dismiss, timeout);

  return { dismiss };
}

// ── Modal ─────────────────────────────────────────────────────────────────────

/**
 * Open a modal dialog.
 *
 * `render(ctx)` builds the body; `ctx.close(value)` resolves the returned
 * promise. Escape and the backdrop close with `undefined`, so callers can tell
 * "cancelled" from "submitted an empty value".
 */
export function modal({
  title,
  subtitle = null,
  render,
  actions = [],
  width = 480,
  className = '',
  onOpen = null,
  dismissable = true,
}) {
  return new Promise((resolvePromise) => {
    const dialog = el('dialog', { class: `mdtex-dialog ${className}`.trim(), style: { maxWidth: `${width}px` } });

    let settled = false;
    const close = (value) => {
      if (settled) return;
      settled = true;
      dialog.close();
      setTimeout(() => dialog.remove(), 150);
      resolvePromise(value);
    };

    const ctx = { close, dialog };

    const body = el('div', { class: 'dialog-body' });
    const rendered = render ? render(ctx) : null;
    if (rendered) mount(body, ...(Array.isArray(rendered) ? rendered : [rendered]));

    const footer = el('div', { class: 'dialog-footer' });
    for (const action of actions) {
      const button = el('button', {
        class: `btn ${action.variant ? `btn-${action.variant}` : ''} ${action.class || ''}`.trim(),
        type: action.submit ? 'submit' : 'button',
        disabled: Boolean(action.disabled),
        onClick: async (e) => {
          e.preventDefault();
          if (button.disabled) return;
          const result = await action.onClick?.(ctx);
          if (result !== false && action.closes !== false) close(action.value);
        },
      }, action.label);
      action.ref?.(button);
      footer.append(button);
    }

    const header = el('div', { class: 'dialog-header' },
      el('div', { class: 'dialog-titles' },
        el('h2', { class: 'dialog-title' }, title),
        subtitle ? el('p', { class: 'dialog-subtitle' }, subtitle) : null,
      ),
      dismissable ? el('button', {
        class: 'dialog-close', title: 'Close (Esc)', onClick: () => close(undefined),
      }, '×') : null,
    );

    const form = el('form', { class: 'dialog-form', method: 'dialog', onSubmit: (e) => e.preventDefault() },
      header, body, actions.length ? footer : null);

    dialog.append(form);
    dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      if (dismissable) close(undefined);
    });
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog && dismissable) close(undefined);
    });

    document.body.append(dialog);
    dialog.showModal();

    // Focus the first meaningful control so the dialog is keyboard-usable at once.
    const focusTarget = body.querySelector('input:not([type=hidden]), textarea, select, button')
      || footer.querySelector('.btn-primary')
      || footer.querySelector('button');
    focusTarget?.focus();
    if (focusTarget?.select) focusTarget.select();

    onOpen?.(ctx);
  });
}

/** Confirmation dialog. Resolves true / false. */
export async function confirmDialog({
  title,
  message,
  detail = null,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
}) {
  const result = await modal({
    title,
    width: 420,
    className: danger ? 'dialog-danger' : '',
    render: () => [
      el('p', { class: 'dialog-message' }, message),
      detail ? el('p', { class: 'dialog-detail' }, detail) : null,
    ],
    actions: [
      { label: cancelLabel, value: false },
      { label: confirmLabel, value: true, variant: danger ? 'danger' : 'primary' },
    ],
  });
  return result === true;
}

/** Single-value text prompt with validation. Resolves the string, or undefined. */
export async function promptDialog({
  title,
  label = 'Name',
  value = '',
  placeholder = '',
  hint = null,
  confirmLabel = 'Save',
  validate = null,
  multiline = false,
}) {
  let input;
  let errorNode;
  let submitButton;

  const runValidation = () => {
    const current = input.value;
    const error = validate ? validate(current) : null;
    errorNode.textContent = error || '';
    errorNode.classList.toggle('visible', Boolean(error));
    input.classList.toggle('invalid', Boolean(error));
    if (submitButton) submitButton.disabled = Boolean(error);
    return !error;
  };

  return modal({
    title,
    width: 460,
    render: (ctx) => {
      input = multiline
        ? el('textarea', { class: 'field-input', rows: 4, value, placeholder })
        : el('input', { class: 'field-input', type: 'text', value, placeholder });

      errorNode = el('p', { class: 'field-error' });

      input.addEventListener('input', runValidation);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !multiline) {
          e.preventDefault();
          if (runValidation()) ctx.close(input.value.trim());
        }
      });

      queueMicrotask(runValidation);

      return el('div', { class: 'field' },
        el('label', { class: 'field-label' }, label),
        input,
        hint ? el('p', { class: 'field-hint' }, hint) : null,
        errorNode,
      );
    },
    actions: [
      { label: 'Cancel', value: undefined },
      {
        label: confirmLabel,
        variant: 'primary',
        ref: (b) => { submitButton = b; },
        onClick: (ctx) => {
          if (!runValidation()) return false;
          ctx.close(input.value.trim());
          return false;
        },
      },
    ],
  });
}

/** Single-choice list dialog. Resolves the chosen value, or undefined. */
export async function chooseDialog({ title, subtitle = null, options, value = null, confirmLabel = 'Select' }) {
  let selected = value ?? options[0]?.value;

  return modal({
    title,
    subtitle,
    width: 460,
    render: (ctx) => {
      const list = el('div', { class: 'choice-list' });
      for (const option of options) {
        const item = el('button', {
          class: `choice${option.value === selected ? ' selected' : ''}`,
          type: 'button',
          onClick: () => {
            selected = option.value;
            list.querySelectorAll('.choice').forEach(c => c.classList.remove('selected'));
            item.classList.add('selected');
          },
          onDblClick: () => ctx.close(option.value),
        },
          el('span', { class: 'choice-label' }, option.label),
          option.detail ? el('span', { class: 'choice-detail' }, option.detail) : null,
        );
        list.append(item);
      }
      return list;
    },
    actions: [
      { label: 'Cancel', value: undefined },
      { label: confirmLabel, variant: 'primary', onClick: (ctx) => { ctx.close(selected); return false; } },
    ],
  });
}

// ── Form fields ───────────────────────────────────────────────────────────────

/**
 * Build a labelled form field. Returns { node, get, set, input }.
 * Used by the article-properties and AI-connection dialogs so every form in the
 * application looks and behaves the same.
 */
export function field(spec) {
  let input;

  switch (spec.type) {
    case 'select':
      input = el('select', { class: 'field-input' });
      for (const option of spec.options || []) {
        input.append(el('option', { value: option.value, selected: option.value === spec.value }, option.label));
      }
      if (spec.value !== undefined) input.value = spec.value;
      break;

    case 'textarea':
      input = el('textarea', {
        class: 'field-input', rows: spec.rows || 3,
        value: spec.value ?? '', placeholder: spec.placeholder || '',
      });
      break;

    case 'checkbox':
      input = el('input', { class: 'field-checkbox', type: 'checkbox', checked: Boolean(spec.value) });
      break;

    case 'checkbox-group': {
      const group = el('div', { class: 'checkbox-group' });
      const boxes = [];
      for (const option of spec.options || []) {
        const box = el('input', {
          type: 'checkbox',
          value: option.value,
          checked: (spec.value || []).includes(option.value),
        });
        boxes.push(box);
        group.append(el('label', { class: 'checkbox-item' }, box, el('span', {}, option.label)));
      }
      const node = el('div', { class: 'field' },
        el('label', { class: 'field-label' }, spec.label),
        group,
        spec.hint ? el('p', { class: 'field-hint' }, spec.hint) : null,
      );
      return {
        node,
        input: group,
        get: () => boxes.filter(b => b.checked).map(b => b.value),
        set: (values) => boxes.forEach(b => { b.checked = (values || []).includes(b.value); }),
      };
    }

    case 'readonly':
      input = el('input', { class: 'field-input readonly', type: 'text', value: spec.value ?? '', readOnly: true });
      break;

    case 'password':
      input = el('input', {
        class: 'field-input', type: 'password',
        value: spec.value ?? '', placeholder: spec.placeholder || '', autocomplete: 'off',
      });
      break;

    case 'number':
      input = el('input', {
        class: 'field-input', type: 'number',
        value: spec.value ?? '', placeholder: spec.placeholder || '',
      });
      break;

    default:
      input = el('input', {
        class: 'field-input', type: 'text',
        value: spec.value ?? '', placeholder: spec.placeholder || '',
      });
  }

  if (spec.disabled) input.disabled = true;

  const errorNode = el('p', { class: 'field-error' });
  const node = el('div', { class: `field${spec.wide ? ' field-wide' : ''}` },
    spec.type === 'checkbox'
      ? el('label', { class: 'checkbox-item' }, input, el('span', {}, spec.label))
      : el('label', { class: 'field-label' }, spec.label,
          spec.badge ? el('span', { class: 'field-badge' }, spec.badge) : null),
    spec.type === 'checkbox' ? null : input,
    spec.hint ? el('p', { class: 'field-hint' }, spec.hint) : null,
    errorNode,
  );

  return {
    node,
    input,
    get: () => (spec.type === 'checkbox' ? input.checked : input.value),
    set: (v) => { if (spec.type === 'checkbox') input.checked = Boolean(v); else input.value = v ?? ''; },
    setError: (message) => {
      errorNode.textContent = message || '';
      errorNode.classList.toggle('visible', Boolean(message));
      input.classList.toggle('invalid', Boolean(message));
    },
    show: (visible) => node.classList.toggle('hidden', !visible),
  };
}

// ── Context menu ──────────────────────────────────────────────────────────────

let openMenu = null;

/**
 * Show a context menu at a point.
 * `items` are { label, onClick, danger, disabled, icon } or { separator: true }.
 */
export function contextMenu(event, items) {
  event.preventDefault();
  closeContextMenu();

  const menu = el('div', { class: 'context-menu', role: 'menu' });

  for (const item of items) {
    if (!item) continue;
    if (item.separator) {
      menu.append(el('div', { class: 'context-separator' }));
      continue;
    }
    menu.append(el('button', {
      class: `context-item${item.danger ? ' danger' : ''}`,
      type: 'button',
      disabled: Boolean(item.disabled),
      onClick: () => { closeContextMenu(); item.onClick?.(); },
    },
      item.icon ? el('span', { class: 'context-icon' }, item.icon) : null,
      el('span', { class: 'context-label' }, item.label),
      item.shortcut ? el('span', { class: 'context-shortcut' }, item.shortcut) : null,
    ));
  }

  document.body.append(menu);

  // Keep the menu inside the viewport.
  const rect = menu.getBoundingClientRect();
  const x = Math.min(event.clientX, window.innerWidth - rect.width - 8);
  const y = Math.min(event.clientY, window.innerHeight - rect.height - 8);
  menu.style.left = `${Math.max(8, x)}px`;
  menu.style.top = `${Math.max(8, y)}px`;

  openMenu = menu;

  const dismiss = (e) => {
    if (e && menu.contains(e.target)) return;
    closeContextMenu();
  };
  setTimeout(() => {
    document.addEventListener('mousedown', dismiss, { once: true });
    document.addEventListener('contextmenu', dismiss, { once: true });
    window.addEventListener('blur', closeContextMenu, { once: true });
    document.addEventListener('keydown', onMenuKey);
  }, 0);

  menu.querySelector('.context-item:not([disabled])')?.focus();
}

function onMenuKey(e) {
  if (e.key === 'Escape') { closeContextMenu(); return; }
  if (!openMenu) return;
  const items = [...openMenu.querySelectorAll('.context-item:not([disabled])')];
  if (!items.length) return;
  const index = items.indexOf(document.activeElement);
  if (e.key === 'ArrowDown') { e.preventDefault(); items[(index + 1) % items.length].focus(); }
  if (e.key === 'ArrowUp') { e.preventDefault(); items[(index - 1 + items.length) % items.length].focus(); }
}

export function closeContextMenu() {
  document.removeEventListener('keydown', onMenuKey);
  openMenu?.remove();
  openMenu = null;
}

// ── Misc ──────────────────────────────────────────────────────────────────────

export function relativeTime(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const seconds = Math.round((Date.now() - then) / 1000);

  if (seconds < 45) return 'just now';
  if (seconds < 90) return 'a minute ago';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} d ago`;
  return new Date(iso).toLocaleDateString();
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function spinner(label = '') {
  return el('span', { class: 'spinner-wrap' }, el('span', { class: 'spinner' }), label ? el('span', {}, label) : null);
}
