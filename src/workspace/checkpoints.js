import { existsSync, readFileSync, writeFileSync, readdirSync, rmSync, statSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { ensureDir } from '../core/paths.js';

/**
 * Article checkpoints.
 *
 * Before any AI-driven or otherwise automated edit touches an article, MDTeX
 * snapshots the source (and, when a theme is in scope, the CSS) into
 * `<article>/.checkpoints/`. Every applied edit is therefore reversible with a
 * single click, which is what makes it safe to let an agent write to the file.
 *
 * Checkpoints are per-article and never leave the article directory, so they
 * travel with it when the article is moved.
 */

const DIR_NAME = '.checkpoints';
const MAX_CHECKPOINTS = 30;

function checkpointDir(article) {
  if (!article?.dir) throw new Error('Article has no directory on disk.');
  return join(article.dir, DIR_NAME);
}

/**
 * Snapshot the current state.
 * @returns {{ id, label, createdAt }}
 */
export function createCheckpoint(article, { label = '', themeName = null, themeCss = null, origin = 'manual' } = {}) {
  const dir = ensureDir(checkpointDir(article));
  const id = `${new Date().toISOString().replace(/[:.]/g, '-')}_${randomUUID().slice(0, 8)}`;

  const record = {
    id,
    label,
    origin,
    createdAt: new Date().toISOString(),
    articleId: article.id,
    sourceFile: article.sourceFile,
    source: article.readSource(),
    metadata: article.toJSON(),
    themeName,
    themeCss,
  };

  writeFileSync(join(dir, `${id}.json`), JSON.stringify(record, null, 2), 'utf-8');
  prune(dir);

  return { id, label, origin, createdAt: record.createdAt };
}

export function listCheckpoints(article) {
  const dir = checkpointDir(article);
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try {
        const record = JSON.parse(readFileSync(join(dir, f), 'utf-8'));
        return {
          id: record.id,
          label: record.label,
          origin: record.origin,
          createdAt: record.createdAt,
          bytes: statSync(join(dir, f)).size,
          hasTheme: Boolean(record.themeCss),
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

export function readCheckpoint(article, id) {
  const file = join(checkpointDir(article), `${sanitiseId(id)}.json`);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Restore an article to a checkpoint.
 * Takes a checkpoint of the *current* state first, so restoring is itself
 * reversible.
 */
export function restoreCheckpoint(article, id) {
  const record = readCheckpoint(article, id);
  if (!record) throw new Error(`Checkpoint not found: ${id}`);

  createCheckpoint(article, { label: `Before restoring ${record.label || record.id}`, origin: 'pre-restore' });

  // A checkpoint records which file the content came from, and the source
  // format can change between taking one and restoring it — adopting LaTeX
  // does exactly that. Restoring the content without restoring the container
  // would write Markdown into main.tex and leave the article claiming to be a
  // LaTeX project, so the container is restored first and the file the article
  // no longer uses is removed. The pre-restore checkpoint above already holds
  // its contents, so nothing is lost.
  const previousSourcePath = article.sourcePath;
  const recordedFormat = record.metadata?.sourceFormat
    || (record.sourceFile === 'main.tex' ? 'latex' : 'markdown');
  if (recordedFormat !== article.sourceFormat) {
    article.setSourceContainer(recordedFormat);
  }

  article.writeSource(record.source);

  if (previousSourcePath && previousSourcePath !== article.sourcePath && existsSync(previousSourcePath)) {
    rmSync(previousSourcePath, { force: true });
  }
  if (record.metadata) {
    article.applyMetadata({
      title: record.metadata.title,
      subtitle: record.metadata.subtitle,
      author: record.metadata.author,
      summary: record.metadata.summary,
      language: record.metadata.language,
      tags: record.metadata.tags,
      series: record.metadata.series,
      targets: record.metadata.targets,
      theme: record.metadata.theme,
      pdfTemplate: record.metadata.pdfTemplate,
      pdfEngine: record.metadata.pdfEngine,
      status: record.metadata.status,
    });
  }

  return {
    restored: record.id,
    source: record.source,
    sourceFormat: article.sourceFormat,
    sourceFile: article.sourceFile,
    themeName: record.themeName,
    themeCss: record.themeCss,
  };
}

export function deleteCheckpoint(article, id) {
  const file = join(checkpointDir(article), `${sanitiseId(id)}.json`);
  if (!existsSync(file)) return false;
  rmSync(file, { force: true });
  return true;
}

function prune(dir) {
  const files = readdirSync(dir).filter(f => f.endsWith('.json')).sort();
  if (files.length <= MAX_CHECKPOINTS) return;
  for (const f of files.slice(0, files.length - MAX_CHECKPOINTS)) {
    try { rmSync(join(dir, f), { force: true }); } catch {}
  }
}

function sanitiseId(id) {
  return String(id).replace(/[^A-Za-z0-9._-]/g, '');
}
