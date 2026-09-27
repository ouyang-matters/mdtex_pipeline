import { modal, field, el, toast, relativeTime, confirmDialog, mount } from './ui-kit.js';
import { backend } from './api.js';
import { app } from './state.js';
import { t } from './i18n.js';

/**
 * The displayed name of a stored article status. The stored value stays
 * `draft`/`review`/`published`/`archived`; only its label follows the language.
 * An unknown status is shown as stored rather than as a raw key.
 */
export function statusLabel(status) {
  const key = `library.status.${status}`;
  const text = t(key);
  return text === key ? status : text;
}

/** The displayed name of a publishing target, falling back to the backend's label. */
function targetLabel(target) {
  const key = `props.target.${target.value}`;
  const text = t(key);
  return text === key ? target.label : text;
}

/**
 * Article properties.
 *
 * Everything the internal schema supports, in one place, with a hard visual
 * split between identity and presentation: the stable article ID and creation
 * time are shown read-only with an explanation, so renaming an article can
 * never be mistaken for changing what it *is*.
 */
export async function openArticleProperties(articleId, { onSaved } = {}) {
  let data;
  try {
    data = await backend.workspace.article(articleId);
  } catch (e) {
    toast(e.message, { type: 'error' });
    return null;
  }

  const article = data.article;
  const schema = app.schema || await backend.workspace.schema();
  const folderOptions = [
    { value: '', label: t('library.workspaceRoot') },
    ...app.folders.map(f => ({ value: f.path, label: `/${f.path}` })),
  ];

  const fields = {};
  let saved = null;

  await modal({
    title: t('props.title'),
    subtitle: article.title,
    width: 720,
    className: 'dialog-properties',
    render: (ctx) => {
      // ── Identity (read-only) ──
      fields.id = field({
        label: t('props.id'), type: 'readonly', value: article.id,
        badge: t('props.stable'),
        hint: t('props.idHint'),
        wide: true,
      });
      fields.dirName = field({
        label: t('props.dirName'), type: 'readonly', value: article.dirName || '—',
        badge: t('props.stable'),
        hint: t('props.dirNameHint'),
      });
      fields.createdAt = field({
        label: t('props.createdAt'), type: 'readonly',
        value: article.createdAt ? new Date(article.createdAt).toLocaleString() : '—',
        badge: t('props.stable'),
      });

      // ── Presentation ──
      fields.title = field({ label: t('props.titleField'), value: article.title, wide: true });
      fields.subtitle = field({ label: t('props.subtitle'), value: article.subtitle, wide: true });
      fields.author = field({ label: t('props.author'), value: article.author });
      fields.language = field({
        label: t('props.language'), type: 'select', value: article.language,
        options: schema.languages,
      });
      fields.summary = field({
        label: t('props.summary'), type: 'textarea', value: article.summary, rows: 2, wide: true,
        hint: t('props.summaryHint'),
      });
      fields.tags = field({
        label: t('props.tags'), value: (article.tags || []).join(', '),
        placeholder: t('props.tagsPlaceholder'),
        hint: app.tags.length
          ? t('props.tagsInUse', { tags: app.tags.slice(0, 8).map(entry => entry.tag).join(', ') })
          : t('props.tagsHint'),
        wide: true,
      });
      fields.series = field({
        label: t('props.series'), value: article.series || '',
        placeholder: app.series.length ? app.series[0].series : t('props.seriesPlaceholder'),
      });
      fields.seriesIndex = field({
        label: t('props.seriesIndex'), type: 'number', value: article.seriesIndex ?? '',
      });
      fields.status = field({
        label: t('props.status'), type: 'select', value: article.status,
        options: schema.statuses.map(s => ({ value: s, label: statusLabel(s) })),
      });
      fields.folder = field({
        label: t('props.folder'), type: 'select', value: data.article.folder ?? '',
        options: folderOptions,
        hint: t('props.folderHint'),
      });
      fields.sourceFormat = field({
        label: t('props.sourceFormat'), type: 'select', value: article.sourceFormat,
        options: schema.sourceFormats.map(f => ({ value: f.value, label: `${f.label} (${f.file})` })),
        hint: t('props.sourceFormatHint'),
      });
      fields.targets = field({
        label: t('props.targets'), type: 'checkbox-group',
        value: article.targets,
        options: schema.targets.map(target => ({ ...target, label: targetLabel(target) })),
        wide: true,
      });
      fields.theme = field({
        label: t('props.theme'), type: 'select', value: article.theme,
        options: schema.themes,
      });
      fields.pdfTemplate = field({
        label: t('props.pdfTemplate'), type: 'select', value: article.pdfTemplate,
        options: schema.pdfTemplates,
      });
      fields.pdfEngine = field({
        label: t('props.pdfEngine'), type: 'select', value: article.pdfEngine,
        options: schema.pdfEngines,
        hint: app.env?.latex?.available
          ? t('props.enginesInstalled', { engines: Object.keys(app.env.latex.engines).join(', ') })
          : t('props.noLatex'),
      });

      // Only offered when the machine has fonts to offer. An empty select that
      // says "default" would imply a choice exists where none does.
      const cjkFonts = schema.cjkFonts || [];
      fields.cjkFont = field({
        label: t('props.cjkFont'), type: 'select', value: article.cjkFont || '',
        options: [
          { value: '', label: cjkFonts.length ? t('props.cjkAuto') : t('props.cjkNone') },
          ...cjkFonts.map(f => ({ value: f, label: f })),
        ],
        hint: cjkFonts.length ? t('props.cjkHint') : t('props.cjkMissingHint'),
      });

      const time = relativeTime(article.updatedAt);
      const updated = el('p', { class: 'dialog-detail' },
        data.source
          ? t('props.lastModifiedLines', { time, n: data.source.split('\n').length })
          : t('props.lastModified', { time }));

      return [
        section(t('props.section.identity'), t('props.section.identityHint'), [
          fields.id.node, fields.dirName.node, fields.createdAt.node,
        ], 'identity'),

        section(t('props.section.article'), null, [
          fields.title.node, fields.subtitle.node,
          fields.author.node, fields.language.node,
          fields.summary.node,
        ]),

        section(t('props.section.organisation'), null, [
          fields.folder.node, fields.status.node,
          fields.tags.node,
          fields.series.node, fields.seriesIndex.node,
        ]),

        section(t('props.section.publishing'), null, [
          fields.targets.node,
          fields.theme.node, fields.pdfTemplate.node, fields.pdfEngine.node,
          fields.cjkFont.node,
          fields.sourceFormat.node,
        ]),

        updated,
      ];
    },
    actions: [
      { label: t('props.cancel'), value: undefined },
      {
        label: t('props.save'),
        variant: 'primary',
        onClick: async (ctx) => {
          const title = fields.title.get().trim();
          if (!title) {
            fields.title.setError(t('props.titleRequired'));
            return false;
          }
          fields.title.setError(null);

          const nextFormat = fields.sourceFormat.get();
          if (nextFormat !== article.sourceFormat) {
            const ok = await confirmDialog({
              title: t('props.formatTitle'),
              message: t('props.formatMessage', { file: nextFormat === 'latex' ? 'main.tex' : 'source.md' }),
              detail: t('props.formatDetail'),
              confirmLabel: t('props.formatConfirm'),
            });
            if (!ok) {
              fields.sourceFormat.set(article.sourceFormat);
              return false;
            }
          }

          const patch = {
            title,
            subtitle: fields.subtitle.get(),
            author: fields.author.get(),
            summary: fields.summary.get(),
            language: fields.language.get(),
            tags: fields.tags.get(),
            series: fields.series.get(),
            seriesIndex: fields.seriesIndex.get(),
            status: fields.status.get(),
            targets: fields.targets.get(),
            theme: fields.theme.get(),
            pdfTemplate: fields.pdfTemplate.get(),
            pdfEngine: fields.pdfEngine.get(),
            cjkFont: fields.cjkFont.get(),
            sourceFormat: nextFormat,
          };

          try {
            const result = await backend.workspace.saveMeta(article.id, patch);

            const targetFolder = fields.folder.get();
            if (targetFolder !== (data.article.folder ?? '')) {
              await backend.workspace.move(article.id, targetFolder);
            }

            saved = result.article;
            toast(t('props.saved'));
            ctx.close(saved);
          } catch (e) {
            toast(e.message, { type: 'error', timeout: 5000 });
            return false;
          }
          return false;
        },
      },
    ],
  });

  if (saved) onSaved?.(saved);
  return saved;
}

function section(title, hint, children, className = '') {
  return el('section', { class: `dialog-section ${className}`.trim() },
    el('h3', { class: 'dialog-section-title' }, title),
    hint ? el('p', { class: 'dialog-section-hint' }, hint) : null,
    el('div', { class: 'field-grid' }, ...children),
  );
}
