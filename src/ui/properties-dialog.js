import { modal, field, el, toast, relativeTime, confirmDialog, mount } from './ui-kit.js';
import { backend } from './api.js';
import { app } from './state.js';

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
    { value: '', label: '/ (workspace root)' },
    ...app.folders.map(f => ({ value: f.path, label: `/${f.path}` })),
  ];

  const fields = {};
  let saved = null;

  await modal({
    title: 'Article properties',
    subtitle: article.title,
    width: 720,
    className: 'dialog-properties',
    render: (ctx) => {
      // ── Identity (read-only) ──
      fields.id = field({
        label: 'Article ID', type: 'readonly', value: article.id,
        badge: 'stable',
        hint: 'Identifies this article for build caches, checkpoints and publish state. '
          + 'It never changes — renaming or moving the article is safe.',
        wide: true,
      });
      fields.dirName = field({
        label: 'Folder on disk', type: 'readonly', value: article.dirName || '—',
        badge: 'stable',
        hint: 'The directory name is part of the article\'s identity and is not renamed with the title.',
      });
      fields.createdAt = field({
        label: 'Created', type: 'readonly',
        value: article.createdAt ? new Date(article.createdAt).toLocaleString() : '—',
        badge: 'stable',
      });

      // ── Presentation ──
      fields.title = field({ label: 'Title', value: article.title, wide: true });
      fields.subtitle = field({ label: 'Subtitle', value: article.subtitle, wide: true });
      fields.author = field({ label: 'Author', value: article.author });
      fields.language = field({
        label: 'Language', type: 'select', value: article.language,
        options: schema.languages,
      });
      fields.summary = field({
        label: 'Summary', type: 'textarea', value: article.summary, rows: 2, wide: true,
        hint: 'Used as the excerpt when handing off to the blog pipeline.',
      });
      fields.tags = field({
        label: 'Tags', value: (article.tags || []).join(', '),
        placeholder: 'bayesian, notes',
        hint: app.tags.length ? `In use: ${app.tags.slice(0, 8).map(t => t.tag).join(', ')}` : 'Comma separated.',
        wide: true,
      });
      fields.series = field({
        label: 'Series / column', value: article.series || '',
        placeholder: app.series.length ? app.series[0].series : 'e.g. Inference Notes',
      });
      fields.seriesIndex = field({
        label: 'Position in series', type: 'number', value: article.seriesIndex ?? '',
      });
      fields.status = field({
        label: 'Status', type: 'select', value: article.status,
        options: schema.statuses.map(s => ({ value: s, label: s[0].toUpperCase() + s.slice(1) })),
      });
      fields.folder = field({
        label: 'Folder', type: 'select', value: data.article.folder ?? '',
        options: folderOptions,
        hint: 'Moving an article keeps its ID, assets and history.',
      });
      fields.sourceFormat = field({
        label: 'Source format', type: 'select', value: article.sourceFormat,
        options: schema.sourceFormats.map(f => ({ value: f.value, label: `${f.label} (${f.file})` })),
        hint: 'Switching format renames the source file. The text is kept verbatim — '
          + 'it is not converted. Use the AI panel to convert content.',
      });

      // The only place this is offered: a LaTeX article has no second face
      // (the LaTeX tab exists only for Markdown articles), and this is a
      // one-way, best-effort reversal — it needs its own explicit action and
      // confirmation, not a silent side effect of the format dropdown above.
      const convertToMarkdown = article.sourceFormat === 'latex'
        ? el('button', {
          class: 'btn btn-xs', type: 'button',
          onClick: async (e) => {
            const button = e.currentTarget;
            button.disabled = true;

            let preview;
            try {
              preview = await backend.workspace.markdownFromLatex(article.id);
            } catch (err) {
              button.disabled = false;
              toast(err.message, { type: 'error', timeout: 8000 });
              return;
            }

            const warningText = preview.warnings.length
              ? `\n\n${preview.warnings.join(' ')}`
              : '';
            const confirmed = await confirmDialog({
              title: 'Convert LaTeX to Markdown?',
              message: `"${article.title}" will become a Markdown article. This is a best-effort reversal — `
                + 'LaTeX with no Markdown equivalent (\\label, \\newcommand, custom environments, TikZ, '
                + 'bibliographies) is kept as raw LaTeX text rather than dropped.' + warningText,
              detail: 'The LaTeX is saved to a checkpoint first: `publisher ws restore` gets it back.',
              confirmLabel: 'Convert to Markdown',
              danger: true,
            });
            if (!confirmed) { button.disabled = false; return; }

            let result;
            try {
              result = await backend.workspace.adoptMarkdown(article.id);
            } catch (err) {
              button.disabled = false;
              toast(err.message, { type: 'error', timeout: 8000 });
              return;
            }

            saved = result.article;
            toast(`Converted to Markdown. The LaTeX is in checkpoint "${result.checkpoint.label}".`,
              { timeout: 5000 });
            ctx.close(saved);
          },
        }, 'Convert to Markdown…')
        : null;
      fields.targets = field({
        label: 'Publishing targets', type: 'checkbox-group',
        value: article.targets, options: schema.targets,
        wide: true,
      });
      fields.theme = field({
        label: 'WeChat theme', type: 'select', value: article.theme,
        options: schema.themes,
      });
      fields.pdfTemplate = field({
        label: 'PDF template', type: 'select', value: article.pdfTemplate,
        options: schema.pdfTemplates,
      });
      fields.pdfEngine = field({
        label: 'PDF engine', type: 'select', value: article.pdfEngine,
        options: schema.pdfEngines,
        hint: app.env?.latex?.available
          ? `Installed: ${Object.keys(app.env.latex.engines).join(', ')}`
          : 'No LaTeX installation detected.',
      });

      // Only offered when the machine has fonts to offer. An empty select that
      // says "default" would imply a choice exists where none does.
      const cjkFonts = schema.cjkFonts || [];
      fields.cjkFont = field({
        label: 'CJK font', type: 'select', value: article.cjkFont || '',
        options: [
          { value: '', label: cjkFonts.length ? 'Choose automatically' : 'No CJK font installed' },
          ...cjkFonts.map(f => ({ value: f, label: f })),
        ],
        hint: cjkFonts.length
          ? 'Used for Chinese, Japanese and Korean text in PDFs.'
          : 'Install a CJK font (fonts-noto-cjk) to typeset CJK in PDFs.',
      });

      const updated = el('p', { class: 'dialog-detail' },
        `Last modified ${relativeTime(article.updatedAt)}`
        + (data.source ? ` · ${data.source.split('\n').length} lines` : ''));

      return [
        section('Identity', 'These values are fixed and shown for reference.', [
          fields.id.node, fields.dirName.node, fields.createdAt.node,
        ], 'identity'),

        section('Article', null, [
          fields.title.node, fields.subtitle.node,
          fields.author.node, fields.language.node,
          fields.summary.node,
        ]),

        section('Organisation', null, [
          fields.folder.node, fields.status.node,
          fields.tags.node,
          fields.series.node, fields.seriesIndex.node,
        ]),

        section('Publishing', null, [
          fields.targets.node,
          fields.theme.node, fields.pdfTemplate.node, fields.pdfEngine.node,
          fields.cjkFont.node,
          fields.sourceFormat.node,
          convertToMarkdown,
        ]),

        updated,
      ];
    },
    actions: [
      { label: 'Cancel', value: undefined },
      {
        label: 'Save changes',
        variant: 'primary',
        onClick: async (ctx) => {
          const title = fields.title.get().trim();
          if (!title) {
            fields.title.setError('A title is required.');
            return false;
          }
          fields.title.setError(null);

          const nextFormat = fields.sourceFormat.get();
          if (nextFormat !== article.sourceFormat) {
            const ok = await confirmDialog({
              title: 'Change source format?',
              message: `The source file will be renamed to ${nextFormat === 'latex' ? 'main.tex' : 'source.md'}.`,
              detail: 'The text is kept exactly as it is — MDTeX does not convert it. '
                + 'Ask the AI panel to convert the content if that is what you want.',
              confirmLabel: 'Rename file',
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
            toast('Article properties saved.');
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
