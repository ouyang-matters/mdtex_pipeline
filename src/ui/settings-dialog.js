import { el, clear, modal, field, toast, confirmDialog, formatBytes, mount } from './ui-kit.js';
import { backend } from './api.js';
import { app, emit } from './state.js';
import { openConnectionManager, openQuickConnect, refreshAi } from './ai-panel.js';
import { t, LANGUAGES } from './i18n.js';

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
    { id: 'general', label: t('settings.tab.general') },
    { id: 'editor', label: t('settings.tab.editor') },
    { id: 'publishing', label: t('settings.tab.publishing') },
    { id: 'ai', label: t('settings.tab.ai') },
    { id: 'latex', label: 'LaTeX' },
    { id: 'storage', label: t('settings.tab.storage') },
  ];

  let activeTab = tab;
  let panelNode;
  const fields = {};

  const renderPanel = () => {
    clear(panelNode);
    panelNode.append(buildTab(activeTab, { preferences, config, env, fields }));
  };

  await modal({
    title: t('settings.title'),
    width: 760,
    className: 'dialog-settings',
    render: () => {
      const tabBar = el('div', { class: 'settings-tabs' });
      for (const tabSpec of tabs) {
        tabBar.append(el('button', {
          class: `settings-tab${tabSpec.id === activeTab ? ' active' : ''}`,
          type: 'button',
          onClick: (e) => {
            activeTab = tabSpec.id;
            tabBar.querySelectorAll('.settings-tab').forEach(n => n.classList.remove('active'));
            e.currentTarget.classList.add('active');
            renderPanel();
          },
        }, tabSpec.label));
      }

      panelNode = el('div', { class: 'settings-panel' });
      queueMicrotask(renderPanel);

      return el('div', { class: 'settings-layout' }, tabBar, panelNode);
    },
    actions: [
      { label: t('settings.close'), value: undefined },
      {
        label: t('settings.save'),
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
            toast(t('settings.saved'));
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
      // Each language is named in itself, so it can be found whatever
      // language the interface is currently in.
      fields['pref.ui_language'] = field({
        label: t('settings.language.label'), type: 'select',
        value: preferences.ui_language || 'auto',
        options: [
          { value: 'auto', label: t('settings.language.auto') },
          ...LANGUAGES.map(l => ({ value: l.value, label: l.label })),
        ],
        hint: t('settings.language.hint'),
      });
      fields['config.default_platform'] = field({
        label: t('settings.general.defaultPlatform'), type: 'select',
        value: config.default_platform,
        options: [
          { value: 'wechat', label: t('settings.platform.wechat') },
          { value: 'zhihu', label: t('settings.platform.zhihu') },
        ],
      });
      fields['config.default_theme'] = field({
        label: t('settings.general.defaultTheme'), type: 'select',
        value: config.default_theme,
        options: app.themes.map(theme => ({ value: theme.name, label: theme.name })),
      });
      return el('div', { class: 'field-grid' },
        fields['pref.ui_language'].node,
        fields['config.default_platform'].node,
        fields['config.default_theme'].node,
        info(t('settings.info.application'), [
          [t('settings.info.version'), env ? `${app.version || ''}` : ''],
          [t('settings.info.platform'), `${env.platform}`],
          [t('settings.info.appRoot'), env.paths.appRoot],
        ]),
      );

    case 'editor':
      fields['pref.editor_font_size'] = field({
        label: t('settings.editor.fontSize'), type: 'number', value: preferences.editor_font_size,
      });
      fields['pref.editor_tab_size'] = field({
        label: t('settings.editor.tabSize'), type: 'number', value: preferences.editor_tab_size,
      });
      fields['pref.preview_auto_scroll'] = field({
        label: t('settings.editor.syncScroll'), type: 'checkbox',
        value: preferences.preview_auto_scroll,
      });
      fields['pref.auto_save'] = field({
        label: t('settings.editor.autoSave'), type: 'checkbox',
        value: preferences.auto_save !== false,
        hint: t('settings.editor.autoSaveHint'),
      });
      return el('div', { class: 'field-grid' },
        fields['pref.editor_font_size'].node,
        fields['pref.editor_tab_size'].node,
        fields['pref.preview_auto_scroll'].node,
        fields['pref.auto_save'].node,
      );

    case 'publishing':
      fields['pref.auto_prepare_target'] = field({
        label: t('settings.publishing.autoPrepare'), type: 'checkbox',
        value: preferences.auto_prepare_target !== false,
        hint: t('settings.publishing.autoPrepareHint'),
        wide: true,
      });
      fields['pref.math_output'] = field({
        label: t('settings.publishing.mathOutput'), type: 'select',
        value: preferences.math_output || 'svg',
        options: [
          { value: 'svg', label: t('settings.publishing.mathSvg') },
          { value: 'png', label: t('settings.publishing.mathPng') },
        ],
      });
      return el('div', { class: 'field-grid' },
        fields['pref.auto_prepare_target'].node,
        fields['pref.math_output'].node,
        info(t('settings.info.publishingTargets'), [
          [t('settings.info.platforms'), (env.platforms || []).join(', ')],
          [t('settings.info.pdfTemplates'), (env.pdfTemplates || []).map(tpl => tpl.id).join(', ')],
          [t('settings.info.blogPipeline'), env.blogpipe?.available ? `blogpipe ${env.blogpipe.version}` : t('settings.info.notInstalled')],
        ]),
      );

    case 'ai': {
      const wrap = el('div', { class: 'settings-section' });
      const active = app.ai.profiles.find(p => p.id === app.ai.activeProfileId);
      wrap.append(
        el('p', { class: 'settings-lead' },
          active
            ? t('settings.ai.active', { name: active.name, type: active.typeLabel })
            : t('settings.ai.none')),
        el('div', { class: 'settings-actions' },
          el('button', {
            class: 'btn btn-primary btn-sm', type: 'button',
            onClick: () => openQuickConnect(),
          }, t('settings.ai.add')),
          el('button', {
            class: 'btn btn-sm', type: 'button',
            onClick: () => openConnectionManager(),
          }, t('settings.ai.manage')),
        ),
        info(t('settings.info.detectedLocally'), [
          ['Claude Code CLI', env.claudeCode?.available ? env.claudeCode.path : t('settings.info.notFound')],
        ]),
        el('p', { class: 'settings-note' }, t('settings.ai.secretNote')),
      );
      return wrap;
    }

    case 'latex': {
      const latex = env.latex;
      const wrap = el('div', { class: 'settings-section' });

      wrap.append(el('p', { class: 'settings-lead' },
        latex.available
          ? t('settings.latex.detected', { distribution: latex.distribution, engine: latex.defaultEngine })
          : t('settings.latex.missing', { missing: latex.missing.join(', ') })));

      const rows = [];
      if (latex.latexmk) rows.push(['latexmk', `${latex.latexmk.path}`]);
      for (const [name, engine] of Object.entries(latex.engines || {})) {
        rows.push([engine.label, engine.path]);
      }
      for (const [name, tool] of Object.entries(latex.tools || {})) {
        if (tool) rows.push([name, tool.path]);
      }
      wrap.append(info(t('settings.info.detectedTools'), rows.length ? rows : [['—', t('settings.info.nothingFound')]]));

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
              ? t('settings.latex.found', { distribution: fresh.latex.distribution })
              : t('settings.latex.stillMissing'),
            { type: fresh.latex.available ? 'success' : 'error' });
            e.currentTarget.disabled = false;
          },
        }, t('settings.latex.redetect')),
      ));

      wrap.append(el('p', { class: 'settings-note' },
        t('settings.latex.searched', { count: latex.searchedDirCount })));

      return wrap;
    }

    case 'storage': {
      const wrap = el('div', { class: 'settings-section' });
      wrap.append(info(t('settings.info.locations'), [
        [t('settings.info.workspace'), env.paths.workspace],
        [t('settings.info.config'), env.paths.configDir],
        [t('settings.info.userThemes'), env.paths.userThemes],
        [t('settings.info.cache'), env.paths.cacheDir],
      ]));
      wrap.append(el('div', { class: 'settings-actions' },
        el('button', {
          class: 'btn btn-sm', type: 'button',
          onClick: async () => {
            const ok = await confirmDialog({
              title: t('settings.storage.clearTitle'),
              message: t('settings.storage.clearMessage'),
              detail: t('settings.storage.clearDetail'),
              confirmLabel: t('settings.storage.clearConfirm'),
            });
            if (!ok) return;
            const { removed } = await backend.build.clearCache();
            emit('target:invalidate', 'cache-cleared');
            toast(t('settings.storage.cleared', { count: removed }));
          },
        }, t('settings.storage.clearButton')),
      ));
      wrap.append(el('p', { class: 'settings-note' }, t('settings.storage.note')));
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
