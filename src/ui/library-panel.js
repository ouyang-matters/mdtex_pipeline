import { el, clear, toast, contextMenu, confirmDialog, promptDialog, chooseDialog, relativeTime, modal, field, mount } from './ui-kit.js';
import { backend } from './api.js';
import { app, emit } from './state.js';
import { openArticleProperties } from './properties-dialog.js';

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
        ? el('span', { class: `status-pill status-${article.status}` }, article.status)
        : null,
    ),
    el('div', { class: 'library-item-meta' },
      el('span', { class: `format-chip ${article.sourceFormat}` },
        article.sourceFormat === 'latex' ? 'TeX' : 'MD'),
      el('span', {}, relativeTime(article.updatedAt)),
      article.series ? el('span', { class: 'series-chip', title: `Series: ${article.series}` }, article.series) : null,
      ...(article.tags || []).slice(0, 2).map(tag => el('span', { class: 'tag-chip' }, tag)),
    ),
  );

  return row;
}

function renderSearchResults() {
  const header = el('div', { class: 'library-section' },
    el('span', {}, `${searchResults.length} result${searchResults.length === 1 ? '' : 's'}`),
    el('button', {
      class: `link-btn${searchIncludesBody ? ' on' : ''}`,
      title: 'Also search inside article text',
      onClick: () => { searchIncludesBody = !searchIncludesBody; runSearch(); },
    }, searchIncludesBody ? 'full text ✓' : 'full text'),
  );
  host.append(header);

  if (!searchResults.length) {
    host.append(el('div', { class: 'library-empty' },
      el('p', {}, 'Nothing matched that search.'),
      el('p', { class: 'muted' }, searchIncludesBody ? '' : 'Try enabling full-text search above.'),
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
  }, `Trash (${app.trash.length})`));
}

function renderTrash() {
  host.append(el('div', { class: 'library-section' },
    el('span', {}, `Trash · ${app.trash.length}`),
    el('button', { class: 'link-btn', onClick: () => { showTrash = false; render(); } }, 'back'),
  ));

  if (!app.trash.length) {
    host.append(el('div', { class: 'library-empty' }, el('p', {}, 'The trash is empty.')));
    return;
  }

  for (const article of app.trash) {
    host.append(el('div', { class: 'library-item trashed' },
      el('div', { class: 'library-item-main' },
        el('span', { class: 'library-item-title' }, article.title)),
      el('div', { class: 'library-item-meta' },
        el('span', {}, `deleted ${relativeTime(article.deletedAt)}`)),
      el('div', { class: 'library-item-actions' },
        el('button', {
          class: 'link-btn',
          onClick: async () => {
            await backend.workspace.restore(article.id);
            toast(`Restored “${article.title}”.`);
            await refreshLibrary();
          },
        }, 'Restore'),
        el('button', {
          class: 'link-btn danger',
          onClick: async () => {
            const ok = await confirmDialog({
              title: 'Delete permanently?',
              message: `“${article.title}” and all of its assets will be removed from disk.`,
              detail: 'This cannot be undone.',
              confirmLabel: 'Delete permanently',
              danger: true,
            });
            if (!ok) return;
            await backend.workspace.purge(article.id);
            toast('Deleted permanently.');
            await refreshLibrary();
          },
        }, 'Delete'),
      ),
    ));
  }

  host.append(el('button', {
    class: 'library-trash-toggle danger',
    onClick: async () => {
      const ok = await confirmDialog({
        title: 'Empty the trash?',
        message: `${app.trash.length} article(s) will be permanently removed from disk.`,
        confirmLabel: 'Empty trash',
        danger: true,
      });
      if (!ok) return;
      await backend.workspace.emptyTrash();
      showTrash = false;
      toast('Trash emptied.');
      await refreshLibrary();
    },
  }, 'Empty trash'));
}

function emptyState() {
  return el('div', { class: 'library-empty' },
    el('div', { class: 'empty-icon' }, '📄'),
    el('p', { class: 'empty-title' }, 'No articles yet'),
    el('p', { class: 'muted' }, 'Create your first article, or drop a .md / .tex file onto the editor.'),
    el('button', { class: 'btn btn-primary btn-sm', onClick: () => createArticle() }, 'New article'),
  );
}

// ── Actions ───────────────────────────────────────────────────────────────────

function articleMenu(event, article) {
  contextMenu(event, [
    { label: 'Open', onClick: () => onSelect?.(article.id) },
    { label: 'Properties…', shortcut: 'Ctrl+I', onClick: () => openProperties(article.id) },
    { separator: true },
    { label: 'Rename…', shortcut: 'F2', onClick: () => renameArticle(article) },
    { label: 'Move to…', onClick: () => moveArticleInteractive(article) },
    { label: 'Duplicate', onClick: () => duplicateArticle(article) },
    { separator: true },
    { label: 'Delete', shortcut: 'Del', danger: true, onClick: () => deleteArticle(article) },
  ]);
}

function folderMenu(event, folder) {
  event.stopPropagation();
  contextMenu(event, [
    { label: 'New article here…', onClick: () => createArticle(folder.path) },
    { label: 'New subfolder…', onClick: () => createFolder(folder.path) },
    { separator: true },
    { label: 'Rename folder…', onClick: () => renameFolder(folder) },
    { label: 'Delete folder', danger: true, onClick: () => deleteFolder(folder) },
  ]);
}

export async function openProperties(articleId) {
  const saved = await openArticleProperties(articleId);
  if (saved) {
    await refreshLibrary();
    emit('article:metadata-changed', saved);
  }
}

export async function createArticle(folder = '') {
  const schema = app.schema || await backend.workspace.schema();

  let titleField, formatField, folderField, templateField;
  const created = await modal({
    title: 'New article',
    width: 520,
    render: () => {
      titleField = field({ label: 'Title', value: '', placeholder: 'Untitled', wide: true });
      formatField = field({
        label: 'Source format', type: 'select', value: 'markdown',
        options: schema.sourceFormats.map(f => ({ value: f.value, label: `${f.label} (${f.file})` })),
      });
      folderField = field({
        label: 'Folder', type: 'select', value: folder,
        options: [{ value: '', label: '/ (workspace root)' },
          ...app.folders.map(f => ({ value: f.path, label: `/${f.path}` }))],
      });
      templateField = field({
        label: 'PDF template', type: 'select', value: 'default',
        options: schema.pdfTemplates,
      });
      return el('div', { class: 'field-grid' },
        titleField.node, formatField.node, folderField.node, templateField.node);
    },
    actions: [
      { label: 'Cancel', value: undefined },
      {
        label: 'Create',
        variant: 'primary',
        onClick: async (ctx) => {
          const title = titleField.get().trim() || 'Untitled';
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
  toast(`Created “${created.title}”.`);
  return created;
}

export async function createFolder(parent = '') {
  const name = await promptDialog({
    title: parent ? `New folder in /${parent}` : 'New folder',
    label: 'Folder name',
    placeholder: 'research',
    confirmLabel: 'Create folder',
    validate: (v) => (v.trim() ? null : 'A folder name is required.'),
  });
  if (name === undefined) return;

  try {
    await backend.workspace.createFolder(parent ? `${parent}/${name}` : name);
    await refreshLibrary();
    toast(`Folder “${name}” created.`);
  } catch (e) {
    toast(e.message, { type: 'error' });
  }
}

async function renameFolder(folder) {
  const name = await promptDialog({
    title: 'Rename folder',
    label: 'Folder name',
    value: folder.name,
    confirmLabel: 'Rename',
    validate: (v) => (v.trim() ? null : 'A folder name is required.'),
  });
  if (name === undefined || name === folder.name) return;

  try {
    await backend.workspace.renameFolder(folder.path, name);
    await refreshLibrary();
    toast('Folder renamed.');
  } catch (e) {
    toast(e.message, { type: 'error', timeout: 5000 });
  }
}

async function deleteFolder(folder) {
  const ok = await confirmDialog({
    title: 'Delete folder?',
    message: `“${folder.name}” will be removed.`,
    detail: 'Only empty folders can be deleted — move or delete the articles inside it first.',
    confirmLabel: 'Delete folder',
    danger: true,
  });
  if (!ok) return;

  try {
    await backend.workspace.deleteFolder(folder.path);
    await refreshLibrary();
    toast('Folder deleted.');
  } catch (e) {
    toast(e.message, { type: 'error', timeout: 6000 });
  }
}

async function renameArticle(article) {
  const title = await promptDialog({
    title: 'Rename article',
    label: 'Title',
    value: article.title,
    hint: 'The article keeps its ID, folder on disk, assets and history.',
    confirmLabel: 'Rename',
    validate: (v) => (v.trim() ? null : 'A title is required.'),
  });
  if (title === undefined || title === article.title) return;

  try {
    await backend.workspace.saveMeta(article.id, { title });
    await refreshLibrary();
    emit('article:metadata-changed', { id: article.id, title });
    toast('Renamed.');
  } catch (e) {
    toast(e.message, { type: 'error' });
  }
}

async function moveArticleInteractive(article) {
  const folder = await chooseDialog({
    title: 'Move article',
    subtitle: article.title,
    options: [
      { value: '', label: '/ (workspace root)' },
      ...app.folders.map(f => ({ value: f.path, label: `/${f.path}` })),
    ],
    value: article.folder ?? '',
    confirmLabel: 'Move here',
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
    toast(folder ? `Moved to /${folder}.` : 'Moved to the workspace root.');
  } catch (e) {
    toast(e.message, { type: 'error', timeout: 5000 });
  }
}

async function duplicateArticle(article) {
  try {
    const { article: copy } = await backend.workspace.duplicate(article.id);
    await refreshLibrary();
    onSelect?.(copy.id);
    toast(`Duplicated as “${copy.title}”.`);
  } catch (e) {
    toast(e.message, { type: 'error' });
  }
}

async function deleteArticle(article) {
  const ok = await confirmDialog({
    title: 'Move to trash?',
    message: `“${article.title}” will be moved to the trash.`,
    detail: 'You can restore it from the trash at the bottom of the library.',
    confirmLabel: 'Move to trash',
    danger: true,
  });
  if (!ok) return;

  try {
    await backend.workspace.remove(article.id);
    await refreshLibrary();
    toast(`“${article.title}” moved to trash.`, {
      action: {
        label: 'Undo',
        onClick: async () => {
          await backend.workspace.restore(article.id);
          await refreshLibrary();
          toast('Restored.');
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
