import { el, clear, modal, field, toast, confirmDialog, formatBytes, mount } from './ui-kit.js';
import { backend } from './api.js';
import { app, emit } from './state.js';
import { openConnectionManager, openQuickConnect, refreshAi } from './ai-panel.js';

/**
 * Settings.
 *
 * A tabbed dialog rather than a page, so it never loses the editor context.
 * Every value here is stored by the backend (config, preferences, secrets), not
 * in browser storage, so it survives a cleared cache and matches the CLI.
 */
export async function openSettings({ tab = 'general' } = {}) {
  const [{ preferences, config }, env] = await Promise.all([
    backend.preferences(),
    app.env ? Promise.resolve(app.env) : app.envReady.then(e => e || backend.env()),
  ]);
  app.env = env;

  const tabs = [
    { id: 'general', label: 'General' },
    { id: 'editor', label: 'Editor' },
    { id: 'publishing', label: 'Publishing' },
    { id: 'ai', label: 'AI' },
    { id: 'latex', label: 'LaTeX' },
    { id: 'storage', label: 'Storage' },
  ];

  let activeTab = tab;
  let panelNode;
  const fields = {};

  const renderPanel = () => {
    clear(panelNode);
    panelNode.append(buildTab(activeTab, { preferences, config, env, fields }));
  };

  await modal({
    title: 'Settings',
    width: 760,
    className: 'dialog-settings',
    render: () => {
      const tabBar = el('div', { class: 'settings-tabs' });
      for (const t of tabs) {
        tabBar.append(el('button', {
          class: `settings-tab${t.id === activeTab ? ' active' : ''}`,
          type: 'button',
          onClick: (e) => {
            activeTab = t.id;
            tabBar.querySelectorAll('.settings-tab').forEach(n => n.classList.remove('active'));
            e.currentTarget.classList.add('active');
            renderPanel();
          },
        }, t.label));
      }

      panelNode = el('div', { class: 'settings-panel' });
      queueMicrotask(renderPanel);

      return el('div', { class: 'settings-layout' }, tabBar, panelNode);
    },
    actions: [
      { label: 'Close', value: undefined },
      {
        label: 'Save',
        variant: 'primary',
        onClick: async (ctx) => {
          const prefsPatch = {};
          for (const [key, f] of Object.entries(fields)) {
            if (!key.startsWith('pref.')) continue;
            prefsPatch[key.slice(5)] = f.get();
          }
          const configPatch = {};
          for (const [key, f] of Object.entries(fields)) {
            if (!key.startsWith('config.')) continue;
            configPatch[key.slice(7)] = f.get();
          }

          try {
            if (Object.keys(prefsPatch).length) await backend.savePreferences(prefsPatch);
            if (Object.keys(configPatch).length) await backend.saveConfig(configPatch);
            emit('preferences:changed', prefsPatch);
            toast('Settings saved.');
            ctx.close(true);
          } catch (e) {
            toast(e.message, { type: 'error' });
            return false;
          }
          return false;
        },
      },
    ],
  });
}

function buildTab(id, { preferences, config, env, fields }) {
  switch (id) {
    case 'general':
      fields['config.default_platform'] = field({
        label: 'Default publishing target', type: 'select',
        value: config.default_platform,
        options: [{ value: 'wechat', label: 'WeChat' }, { value: 'zhihu', label: 'Zhihu' }],
      });
      fields['config.default_theme'] = field({
        label: 'Default theme', type: 'select',
        value: config.default_theme,
        options: app.themes.map(t => ({ value: t.name, label: t.name })),
      });
      return el('div', { class: 'field-grid' },
        fields['config.default_platform'].node,
        fields['config.default_theme'].node,
        info('Application', [
          ['Version', env ? `${app.version || ''}` : ''],
          ['Platform', `${env.platform}`],
          ['App root', env.paths.appRoot],
        ]),
      );

    case 'editor':
      fields['pref.editor_font_size'] = field({
        label: 'Editor font size', type: 'number', value: preferences.editor_font_size,
      });
      fields['pref.editor_tab_size'] = field({
        label: 'Tab size', type: 'number', value: preferences.editor_tab_size,
      });
      fields['pref.preview_auto_scroll'] = field({
        label: 'Sync preview scrolling with the editor', type: 'checkbox',
        value: preferences.preview_auto_scroll,
      });
      fields['pref.auto_save'] = field({
        label: 'Save the article automatically as you type', type: 'checkbox',
        value: preferences.auto_save !== false,
        hint: 'Saves to disk about a second after you stop typing.',
      });
      return el('div', { class: 'field-grid' },
        fields['pref.editor_font_size'].node,
        fields['pref.editor_tab_size'].node,
        fields['pref.preview_auto_scroll'].node,
        fields['pref.auto_save'].node,
      );

    case 'publishing':
      fields['pref.auto_prepare_target'] = field({
        label: 'Prepare platform output in the background', type: 'checkbox',
        value: preferences.auto_prepare_target !== false,
        hint: 'Compiles WeChat output shortly after you stop editing, so Copy is instant. '
          + 'The work runs on the local backend and never blocks the editor.',
        wide: true,
      });
      fields['pref.math_output'] = field({
        label: 'Formula output', type: 'select',
        value: preferences.math_output || 'svg',
        options: [
          { value: 'svg', label: 'Inline SVG (recommended for WeChat)' },
          { value: 'png', label: 'PNG images (maximum compatibility)' },
        ],
      });
      return el('div', { class: 'field-grid' },
        fields['pref.auto_prepare_target'].node,
        fields['pref.math_output'].node,
        info('Publishing targets', [
          ['Platforms', (env.platforms || []).join(', ')],
          ['PDF templates', (env.pdfTemplates || []).map(t => t.id).join(', ')],
          ['Blog pipeline', env.blogpipe?.available ? `blogpipe ${env.blogpipe.version}` : 'not installed'],
        ]),
      );

    case 'ai': {
      const wrap = el('div', { class: 'settings-section' });
      const active = app.ai.profiles.find(p => p.id === app.ai.activeProfileId);
      wrap.append(
        el('p', { class: 'settings-lead' },
          active
            ? `Active connection: ${active.name} (${active.typeLabel}).`
            : 'No AI connection is configured yet.'),
        el('div', { class: 'settings-actions' },
          el('button', {
            class: 'btn btn-primary btn-sm', type: 'button',
            onClick: () => openQuickConnect(),
          }, 'Add a connection'),
          el('button', {
            class: 'btn btn-sm', type: 'button',
            onClick: () => openConnectionManager(),
          }, 'Manage connections'),
        ),
        info('Detected locally', [
          ['Claude Code CLI', env.claudeCode?.available ? env.claudeCode.path : 'not found'],
        ]),
        el('p', { class: 'settings-note' },
          'API keys and ClaudeClaw tokens are stored in the local secret store with owner-only '
          + 'permissions. MDTeX shows only a fingerprint after saving and never logs the value.'),
      );
      return wrap;
    }

    case 'latex': {
      const latex = env.latex;
      const wrap = el('div', { class: 'settings-section' });

      wrap.append(el('p', { class: 'settings-lead' },
        latex.available
          ? `${latex.distribution} detected. Default engine: ${latex.defaultEngine}.`
          : `No LaTeX installation found (missing ${latex.missing.join(', ')}).`));

      const rows = [];
      if (latex.latexmk) rows.push(['latexmk', `${latex.latexmk.path}`]);
      for (const [name, engine] of Object.entries(latex.engines || {})) {
        rows.push([engine.label, engine.path]);
      }
      for (const [name, tool] of Object.entries(latex.tools || {})) {
        if (tool) rows.push([name, tool.path]);
      }
      wrap.append(info('Detected tools', rows.length ? rows : [['—', 'nothing found']]));

      for (const note of latex.notes || []) {
        wrap.append(el('p', { class: 'settings-note warn' }, note));
      }

      if (!latex.available && latex.hint) {
        const list = el('ul', { class: 'setup-options' });
        for (const option of latex.hint.options) {
          list.append(el('li', {}, el('strong', {}, option.label), el('span', {}, ` — ${option.detail}`)));
        }
        wrap.append(el('p', { class: 'settings-lead' }, latex.hint.summary), list);
        wrap.append(el('p', { class: 'settings-note' }, latex.hint.note));
      }

      wrap.append(el('div', { class: 'settings-actions' },
        el('button', {
          class: 'btn btn-sm', type: 'button',
          onClick: async (e) => {
            e.currentTarget.disabled = true;
            const fresh = await backend.env(true);
            app.env = fresh;
            emit('env:changed', fresh);
            toast(fresh.latex.available
              ? `LaTeX found: ${fresh.latex.distribution}`
              : 'Still no LaTeX installation found.',
            { type: fresh.latex.available ? 'success' : 'error' });
            e.currentTarget.disabled = false;
          },
        }, 'Re-detect'),
      ));

      wrap.append(el('p', { class: 'settings-note' },
        `${latex.searchedDirCount} directories are searched, covering PATH plus the standard `
        + 'TeX Live and MiKTeX locations for this platform.'));

      return wrap;
    }

    case 'storage': {
      const wrap = el('div', { class: 'settings-section' });
      wrap.append(info('Locations', [
        ['Workspace', env.paths.workspace],
        ['Config', env.paths.configDir],
        ['User themes', env.paths.userThemes],
        ['Cache', env.paths.cacheDir],
      ]));
      wrap.append(el('div', { class: 'settings-actions' },
        el('button', {
          class: 'btn btn-sm', type: 'button',
          onClick: async () => {
            const ok = await confirmDialog({
              title: 'Clear the compiled-output cache?',
              message: 'Prepared WeChat and Zhihu output will be discarded.',
              detail: 'Formula rendering caches are kept, so the next compilation is still fast.',
              confirmLabel: 'Clear cache',
            });
            if (!ok) return;
            const { removed } = await backend.build.clearCache();
            emit('target:invalidate', 'cache-cleared');
            toast(`Cleared ${removed} cached file(s).`);
          },
        }, 'Clear compiled-output cache'),
      ));
      wrap.append(el('p', { class: 'settings-note' },
        'Articles, themes and settings live on disk and are shared with the `publisher` command line. '
        + 'Nothing important is kept in browser storage.'));
      return wrap;
    }

    default:
      return el('div', {});
  }
}

function info(title, rows) {
  return el('div', { class: 'info-table field-wide' },
    el('h4', {}, title),
    el('dl', {}, ...rows.flatMap(([key, value]) => [
      el('dt', {}, key),
      el('dd', { title: String(value) }, String(value || '—')),
    ])),
  );
}
