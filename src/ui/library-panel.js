import { el, clear, toast, contextMenu, confirmDialog, promptDialog, chooseDialog, relativeTime, modal, field, mount } from './ui-kit.js';
import { backend } from './api.js';
import { app, emit } from './state.js';
import { openArticleProperties, statusLabel } from './properties-dialog.js';
import { t } from './i18n.js';

/**
 * Article library.
 *
 * A folder tree with articles inside it, a search box, per-item context menus
 * and drag-and-drop between folders. Every destructive action is a styled
 * confirmation, and deletion is reversible: articles go to the trash and can be
 * restored from the same panel.
 */

let host = null;
let searchInput = null;
let onSelect = null;
const collapsed = new Set(JSON.parse(localStorage.getItem('mdtex.collapsedFolders') || '[]'));
let showTrash = false;
let searchIncludesBody = false;
let searchResults = null;
let searchTimer = null;

export function initLibrary({ listNode, searchNode, onSelectArticle }) {
  host = listNode;
  searchInput = searchNode;
  onSelect = onSelectArticle;

  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(runSearch, 180);
  });
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      searchInput.value = '';
      searchResults = null;
      render();
    }
  });

  // Dropping onto empty space moves to the workspace root.
  host.addEventListener('dragover', (e) => {
    if (!e.dataTransfer.types.includes('application/x-mdtex-article')) return;
    e.preventDefault();
    host.classList.add('drop-root');
  });
  host.addEventListener('dragleave', () => host.classList.remove('drop-root'));
  host.addEventListener('drop', async (e) => {
    host.classList.remove('drop-root');
    const id = e.dataTransfer.getData('application/x-mdtex-article');
    if (!id || e.target.closest('.library-folder, .library-item')) return;
    e.preventDefault();
    await moveArticle(id, '');
  });
}

async function runSearch() {
  const query = searchInput.value.trim();
  if (!query) {
    searchResults = null;
    render();
    return;
  }
  try {
    const { results } = await backend.workspace.search(query, searchIncludesBody);
    searchResults = results;
  } catch (e) {
    toast(e.message, { type: 'error' });
    searchResults = [];
  }
  render();
}

export async function refreshLibrary() {
  try {
    const tree = await backend.workspace.tree();
    app.articles = tree.articles;
    app.folders = tree.folders;
    app.trash = tree.trash;
    app.tags = tree.tags;
    app.series = tree.series;
    emit('library:refreshed', tree);
  } catch (e) {
    toast(e.message, { type: 'error', timeout: 6000 });
  }
  if (searchInput?.value.trim()) await runSearch();
  else render();
}

export function render() {
  if (!host) return;
  clear(host);

  if (showTrash) {
    renderTrash();
    return;
  }

  if (searchResults) {
    renderSearchResults();
    return;
  }

  if (!app.articles.length && !app.folders.length) {
    host.append(emptyState());
    renderTrashToggle();
    return;
  }

  // Group articles by folder, then render the folder tree depth-first.
  const byFolder = new Map();
  for (const article of app.articles) {
    const key = article.folder || '';
    if (!byFolder.has(key)) byFolder.set(key, []);
    byFolder.get(key).push(article);
  }
  for (const list of byFolder.values()) {
    list.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  }

  for (const article of byFolder.get('') || []) host.append(articleRow(article, 0));

  const roots = app.folders.filter(f => !f.parent);
  for (const folder of roots) renderFolder(folder, byFolder, 0);

  renderTrashToggle();
}

function renderFolder(folder, byFolder, depth) {
  const isCollapsed = collapsed.has(folder.path);
  const children = app.folders.filter(f => f.parent === folder.path);
  const articles = byFolder.get(folder.path) || [];
  const count = articles.length + countDescendants(folder.path, byFolder);

  host.append(folderRow(folder, depth, isCollapsed, count));

  if (isCollapsed) return;
  for (const article of articles) host.append(articleRow(article, depth + 1));
  for (const child of children) renderFolder(child, byFolder, depth + 1);
}

function countDescendants(path, byFolder) {
  let total = 0;
  for (const [key, list] of byFolder) {
    if (key.startsWith(`${path}/`)) total += list.length;
  }
  return total;
}

function folderRow(folder, depth, isCollapsed, count) {
  const row = el('div', {
    class: 'library-folder',
    style: { paddingLeft: `${8 + depth * 14}px` },
    dataset: { folder: folder.path },
    onClick: () => {
      if (isCollapsed) collapsed.delete(folder.path); else collapsed.add(folder.path);
      localStorage.setItem('mdtex.collapsedFolders', JSON.stringify([...collapsed]));
      render();
    },
    onContextMenu: (e) => folderMenu(e, folder),
  },
    el('span', { class: `folder-caret${isCollapsed ? ' collapsed' : ''}` }, '▾'),
    el('span', { class: 'folder-name' }, folder.name),
    el('span', { class: 'folder-count' }, String(count)),
  );

  row.addEventListener('dragover', (e) => {
    if (!e.dataTransfer.types.includes('application/x-mdtex-article')) return;
    e.preventDefault();
    e.stopPropagation();
    row.classList.add('drop-target');
  });
  row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
  row.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    row.classList.remove('drop-target');
    const id = e.dataTransfer.getData('application/x-mdtex-article');
    if (id) await moveArticle(id, folder.path);
  });

  return row;
}

function articleRow(article, depth) {
  const active = app.currentArticleId === article.id;
  const isLatex = article.sourceFormat === 'latex';
  const row = el('div', {
    class: `library-item${active ? ' active' : ''}`,
    style: { paddingLeft: `${10 + depth * 14}px` },
    dataset: { id: article.id },
    draggable: true,
    tabIndex: 0,
    onClick: () => onSelect?.(article.id),
    onKeyDown: (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect?.(article.id); }
      if (e.key === 'F2') { e.preventDefault(); renameArticle(article); }
      if (e.key === 'Delete') { e.preventDefault(); deleteArticle(article); }
    },
    onContextMenu: (e) => articleMenu(e, article),
    onDragStart: (e) => {
      e.dataTransfer.setData('application/x-mdtex-article', article.id);
      e.dataTransfer.effectAllowed = 'move';
      row.classList.add('dragging');
    },
    onDragEnd: () => row.classList.remove('dragging'),
  },
    el('div', { class: 'library-item-main' },
      el('span', { class: 'library-item-title', title: article.title }, article.title),
      article.status && article.status !== 'draft'
        ? el('span', { class: `status-pill status-${article.status}` }, statusLabel(article.status))
        : null,
    ),
    el('div', { class: 'library-item-meta' },
      el('span', {
        class: `format-chip ${article.sourceFormat}`,
        title: isLatex ? t('library.formatLatex') : t('library.formatMarkdown'),
      }, isLatex ? 'TeX' : 'MD'),
      el('span', {}, relativeTime(article.updatedAt)),
      article.series
        ? el('span', { class: 'series-chip', title: t('library.seriesTooltip', { series: article.series }) }, article.series)
        : null,
      ...(article.tags || []).slice(0, 2).map(tag => el('span', { class: 'tag-chip' }, tag)),
    ),
  );

  return row;
}

function renderSearchResults() {
  const header = el('div', { class: 'library-section' },
    el('span', {}, t('library.searchResults', { n: searchResults.length })),
    el('button', {
      class: `link-btn${searchIncludesBody ? ' on' : ''}`,
      title: t('library.fullTextTitle'),
      onClick: () => { searchIncludesBody = !searchIncludesBody; runSearch(); },
    }, searchIncludesBody ? t('library.fullTextOn') : t('library.fullText')),
  );
  host.append(header);

  if (!searchResults.length) {
    host.append(el('div', { class: 'library-empty' },
      el('p', {}, t('library.noMatch')),
      el('p', { class: 'muted' }, searchIncludesBody ? '' : t('library.tryFullText')),
    ));
    return;
  }

  for (const article of searchResults) {
    const row = articleRow(article, 0);
    if (article.folder) {
      const meta = row.querySelector('.library-item-meta');
      if (meta) mount(meta, el('span', { class: 'folder-hint' }, `/${article.folder}`));
    }
    host.append(row);
  }
}

function renderTrashToggle() {
  if (!app.trash.length) return;
  host.append(el('button', {
    class: 'library-trash-toggle',
    onClick: () => { showTrash = true; render(); },
  }, t('library.trashToggle', { n: app.trash.length })));
}

function renderTrash() {
  host.append(el('div', { class: 'library-section' },
    el('span', {}, t('library.trashHeader', { n: app.trash.length })),
    el('button', { class: 'link-btn', onClick: () => { showTrash = false; render(); } }, t('library.back')),
  ));

  if (!app.trash.length) {
    host.append(el('div', { class: 'library-empty' }, el('p', {}, t('library.trashEmpty'))));
    return;
  }

  for (const article of app.trash) {
    host.append(el('div', { class: 'library-item trashed' },
      el('div', { class: 'library-item-main' },
        el('span', { class: 'library-item-title' }, article.title)),
      el('div', { class: 'library-item-meta' },
        el('span', {}, t('library.deletedAgo', { time: relativeTime(article.deletedAt) }))),
      el('div', { class: 'library-item-actions' },
        el('button', {
          class: 'link-btn',
          onClick: async () => {
            await backend.workspace.restore(article.id);
            toast(t('library.restoredTitle', { title: article.title }));
            await refreshLibrary();
          },
        }, t('library.restore')),
        el('button', {
          class: 'link-btn danger',
          onClick: async () => {
            const ok = await confirmDialog({
              title: t('library.purgeTitle'),
              message: t('library.purgeMessage', { title: article.title }),
              detail: t('library.cannotUndo'),
              confirmLabel: t('library.deletePermanently'),
              danger: true,
            });
            if (!ok) return;
            await backend.workspace.purge(article.id);
            toast(t('library.purged'));
            await refreshLibrary();
          },
        }, t('library.delete')),
      ),
    ));
  }

  host.append(el('button', {
    class: 'library-trash-toggle danger',
    onClick: async () => {
      const ok = await confirmDialog({
        title: t('library.emptyTrashTitle'),
        message: t('library.emptyTrashMessage', { n: app.trash.length }),
        confirmLabel: t('library.emptyTrash'),
        danger: true,
      });
      if (!ok) return;
      await backend.workspace.emptyTrash();
      showTrash = false;
      toast(t('library.trashEmptied'));
      await refreshLibrary();
    },
  }, t('library.emptyTrash')));
}

function emptyState() {
  return el('div', { class: 'library-empty' },
    el('div', { class: 'empty-icon' }, '📄'),
    el('p', { class: 'empty-title' }, t('library.emptyTitle')),
    el('p', { class: 'muted' }, t('library.emptyHint')),
    el('button', { class: 'btn btn-primary btn-sm', onClick: () => createArticle() }, t('library.newArticle')),
  );
}

// ── Actions ───────────────────────────────────────────────────────────────────

function articleMenu(event, article) {
  contextMenu(event, [
    { label: t('library.menu.open'), onClick: () => onSelect?.(article.id) },
    { label: t('library.menu.properties'), shortcut: 'Ctrl+I', onClick: () => openProperties(article.id) },
    { separator: true },
    { label: t('library.menu.rename'), shortcut: 'F2', onClick: () => renameArticle(article) },
    { label: t('library.menu.move'), onClick: () => moveArticleInteractive(article) },
    { label: t('library.menu.duplicate'), onClick: () => duplicateArticle(article) },
    { separator: true },
    { label: t('library.delete'), shortcut: t('library.key.delete'), danger: true, onClick: () => deleteArticle(article) },
  ]);
}

function folderMenu(event, folder) {
  event.stopPropagation();
  contextMenu(event, [
    { label: t('library.menu.newArticleHere'), onClick: () => createArticle(folder.path) },
    { label: t('library.menu.newSubfolder'), onClick: () => createFolder(folder.path) },
    { separator: true },
    { label: t('library.menu.renameFolder'), onClick: () => renameFolder(folder) },
    { label: t('library.menu.deleteFolder'), danger: true, onClick: () => deleteFolder(folder) },
  ]);
}

export async function openProperties(articleId) {
  const saved = await openArticleProperties(articleId);
  if (saved) {
    await refreshLibrary();
    emit('article:metadata-changed', saved);
  }
}

function folderChoices() {
  return [
    { value: '', label: t('library.workspaceRoot') },
    ...app.folders.map(f => ({ value: f.path, label: `/${f.path}` })),
  ];
}

export async function createArticle(folder = '') {
  const schema = app.schema || await backend.workspace.schema();

  let titleField, formatField, folderField, templateField;
  const created = await modal({
    title: t('library.newArticle'),
    width: 520,
    render: () => {
      titleField = field({ label: t('library.field.title'), value: '', placeholder: t('library.untitled'), wide: true });
      formatField = field({
        label: t('library.field.sourceFormat'), type: 'select', value: 'markdown',
        options: schema.sourceFormats.map(f => ({ value: f.value, label: `${f.label} (${f.file})` })),
      });
      folderField = field({
        label: t('library.field.folder'), type: 'select', value: folder,
        options: folderChoices(),
      });
      templateField = field({
        label: t('library.field.pdfTemplate'), type: 'select', value: 'default',
        options: schema.pdfTemplates,
      });
      return el('div', { class: 'field-grid' },
        titleField.node, formatField.node, folderField.node, templateField.node);
    },
    actions: [
      { label: t('library.cancel'), value: undefined },
      {
        label: t('library.create'),
        variant: 'primary',
        onClick: async (ctx) => {
          const title = titleField.get().trim() || t('library.untitled');
          try {
            const { article } = await backend.workspace.create({
              title,
              folder: folderField.get(),
              sourceFormat: formatField.get(),
              pdfTemplate: templateField.get(),
            });
            ctx.close(article);
          } catch (e) {
            titleField.setError(e.message);
            return false;
          }
          return false;
        },
      },
    ],
  });

  if (!created) return null;
  await refreshLibrary();
  onSelect?.(created.id);
  toast(t('library.created', { title: created.title }));
  return created;
}

export async function createFolder(parent = '') {
  const name = await promptDialog({
    title: parent ? t('library.newFolderIn', { parent }) : t('library.newFolder'),
    label: t('library.folderName'),
    placeholder: t('library.folderPlaceholder'),
    confirmLabel: t('library.createFolder'),
    validate: (v) => (v.trim() ? null : t('library.folderNameRequired')),
  });
  if (name === undefined) return;

  try {
    await backend.workspace.createFolder(parent ? `${parent}/${name}` : name);
    await refreshLibrary();
    toast(t('library.folderCreated', { name }));
  } catch (e) {
    toast(e.message, { type: 'error' });
  }
}

async function renameFolder(folder) {
  const name = await promptDialog({
    title: t('library.renameFolderTitle'),
    label: t('library.folderName'),
    value: folder.name,
    confirmLabel: t('library.rename'),
    validate: (v) => (v.trim() ? null : t('library.folderNameRequired')),
  });
  if (name === undefined || name === folder.name) return;

  try {
    await backend.workspace.renameFolder(folder.path, name);
    await refreshLibrary();
    toast(t('library.folderRenamed'));
  } catch (e) {
    toast(e.message, { type: 'error', timeout: 5000 });
  }
}

async function deleteFolder(folder) {
  const ok = await confirmDialog({
    title: t('library.deleteFolderTitle'),
    message: t('library.deleteFolderMessage', { name: folder.name }),
    detail: t('library.deleteFolderDetail'),
    confirmLabel: t('library.deleteFolder'),
    danger: true,
  });
  if (!ok) return;

  try {
    await backend.workspace.deleteFolder(folder.path);
    await refreshLibrary();
    toast(t('library.folderDeleted'));
  } catch (e) {
    toast(e.message, { type: 'error', timeout: 6000 });
  }
}

async function renameArticle(article) {
  const title = await promptDialog({
    title: t('library.renameArticleTitle'),
    label: t('library.field.title'),
    value: article.title,
    hint: t('library.renameHint'),
    confirmLabel: t('library.rename'),
    validate: (v) => (v.trim() ? null : t('library.titleRequired')),
  });
  if (title === undefined || title === article.title) return;

  try {
    await backend.workspace.saveMeta(article.id, { title });
    await refreshLibrary();
    emit('article:metadata-changed', { id: article.id, title });
    toast(t('library.renamed'));
  } catch (e) {
    toast(e.message, { type: 'error' });
  }
}

async function moveArticleInteractive(article) {
  const folder = await chooseDialog({
    title: t('library.moveArticleTitle'),
    subtitle: article.title,
    options: folderChoices(),
    value: article.folder ?? '',
    confirmLabel: t('library.moveHere'),
  });
  if (folder === undefined) return;
  await moveArticle(article.id, folder);
}

async function moveArticle(id, folder) {
  const article = app.articles.find(a => a.id === id);
  if (article && (article.folder ?? '') === folder) return;
  try {
    await backend.workspace.move(id, folder);
    await refreshLibrary();
    toast(folder ? t('library.movedTo', { folder }) : t('library.movedToRoot'));
  } catch (e) {
    toast(e.message, { type: 'error', timeout: 5000 });
  }
}

async function duplicateArticle(article) {
  try {
    const { article: copy } = await backend.workspace.duplicate(article.id);
    await refreshLibrary();
    onSelect?.(copy.id);
    toast(t('library.duplicated', { title: copy.title }));
  } catch (e) {
    toast(e.message, { type: 'error' });
  }
}

async function deleteArticle(article) {
  const ok = await confirmDialog({
    title: t('library.trashTitle'),
    message: t('library.trashMessage', { title: article.title }),
    detail: t('library.trashDetail'),
    confirmLabel: t('library.moveToTrash'),
    danger: true,
  });
  if (!ok) return;

  try {
    await backend.workspace.remove(article.id);
    await refreshLibrary();
    toast(t('library.movedToTrash', { title: article.title }), {
      action: {
        label: t('library.undo'),
        onClick: async () => {
          await backend.workspace.restore(article.id);
          await refreshLibrary();
          toast(t('library.restored'));
        },
      },
      timeout: 6000,
    });
    if (app.currentArticleId === article.id) {
      const next = app.articles[0];
      if (next) onSelect?.(next.id);
      else emit('article:none');
    }
  } catch (e) {
    toast(e.message, { type: 'error' });
  }
}

export { deleteArticle, renameArticle, duplicateArticle, moveArticleInteractive };
