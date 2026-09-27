import { el, clear, mount, toast, modal, formatBytes, relativeTime, confirmDialog } from './ui-kit.js';
import { backend, followJob, CancelledError, api } from './api.js';
import { app, emit, invalidateTarget } from './state.js';
import { t } from './i18n.js';

/**
 * Build panel: WeChat/Zhihu preparation, PDF compilation and the PDF preview.
 *
 * The expensive work runs on the backend as a cancellable job with streamed
 * progress, so the editor stays responsive and the user can see exactly which
 * stage is running instead of staring at a frozen window.
 */

let nodes = {};
let activeJob = null;
let logLines = [];

/** The visible name of the current platform (the value itself stays internal). */
function platformLabel() {
  return app.platform === 'wechat' ? t('settings.platform.wechat') : t('settings.platform.zhihu');
}

export function initBuildPanel({ root }) {
  nodes.root = root;
  render();
}

export function render() {
  if (!nodes.root) return;
  clear(nodes.root);

  nodes.toolbar = el('div', { class: 'build-toolbar' },
    el('button', { class: 'btn btn-sm', onClick: () => prepareTarget({ force: true }) }, t('build.recompileTarget')),
    el('button', { class: 'btn btn-sm', onClick: () => compilePdf() }, t('build.compilePdf')),
    el('button', { class: 'btn btn-sm', onClick: () => { logLines = []; renderLog(); } }, t('build.clear')),
    el('div', { class: 'build-spacer' }),
    nodes.cancelButton = el('button', {
      class: 'btn btn-sm btn-danger-ghost hidden',
      onClick: () => activeJob?.cancel(),
    }, t('build.cancel')),
  );

  nodes.status = el('div', { class: 'build-status' });
  nodes.log = el('pre', { class: 'build-log' });
  nodes.issues = el('div', { class: 'build-issues' });

  nodes.root.append(nodes.toolbar, nodes.status, nodes.issues, nodes.log);
  renderLog();
  renderStatus();
}

function renderLog() {
  if (!nodes.log) return;
  nodes.log.textContent = logLines.length
    ? logLines.join('\n')
    : t('build.logEmpty');
  nodes.log.scrollTop = nodes.log.scrollHeight;
}

function log(line) {
  logLines.push(line);
  if (logLines.length > 2000) logLines.splice(0, logLines.length - 1500);
  renderLog();
}

function renderStatus(text = null, { busy = false, progress = null } = {}) {
  if (!nodes.status) return;
  clear(nodes.status);

  if (text) {
    mount(nodes.status,
      busy ? el('span', { class: 'spinner' }) : null,
      el('span', { class: 'build-status-text' }, text),
    );
    if (progress && progress.total) {
      const bar = el('div', { class: 'progress-bar' },
        el('div', { class: 'progress-fill', style: { width: `${(progress.done / progress.total) * 100}%` } }));
      nodes.status.append(bar);
    }
    return;
  }

  const target = app.target;
  nodes.status.append(el('span', { class: 'build-status-text' },
    target.prepared
      ? t('build.targetReady', {
        platform: platformLabel(),
        size: formatBytes(target.bytes),
        when: relativeTime(target.preparedAt),
      })
      : t('build.noTarget')));

  if (app.pdf.path) {
    nodes.status.append(el('button', {
      class: 'link-btn',
      onClick: () => openPdfPreview(),
    }, t('build.openPdfPreview')));
  }
}

function renderIssues(errors = [], warnings = []) {
  if (!nodes.issues) return;
  clear(nodes.issues);

  if (!errors.length && !warnings.length) return;

  for (const error of errors) {
    // An asset failure carries a multi-line diagnostic naming the source, the
    // article root and the expected path. Show it as-is rather than flattening
    // it into one line.
    const text = error.diagnostic
      ? el('pre', { class: 'issue-diagnostic' }, error.diagnostic)
      : el('span', { class: 'issue-text' },
          (error.file ? `${basename(error.file)}${error.line ? `:${error.line}` : ''} — ` : '') + error.message);

    mount(nodes.issues, el('div', { class: 'issue issue-error' },
      el('span', { class: 'issue-badge' }, t('build.badge.error')),
      text,
      error.line ? el('button', {
        class: 'link-btn',
        onClick: () => emit('editor:goto-line', error.line),
      }, t('build.goToLine')) : null,
    ));
  }

  for (const warning of warnings.slice(0, 40)) {
    nodes.issues.append(el('div', { class: 'issue issue-warning' },
      el('span', { class: 'issue-badge' }, t('build.badge.warning')),
      el('span', { class: 'issue-text' }, warning.message || warning),
    ));
  }
  if (warnings.length > 40) {
    nodes.issues.append(el('div', { class: 'issue issue-muted' }, t('build.moreWarnings', { count: warnings.length - 40 })));
  }
}

function basename(p) {
  return String(p).split(/[\\/]/).pop();
}

// ── Target (WeChat / Zhihu) preparation ───────────────────────────────────────

/**
 * Compile the article for the current platform and cache the result.
 *
 * Separated from the clipboard write on purpose: this is the expensive step,
 * and once it has run, "Copy" is a cache read.
 */
export async function prepareTarget({ force = false, silent = false } = {}) {
  if (app.target.busy) return null;
  if (!app.source.trim()) {
    if (!silent) toast(t('build.nothingToCompile'), { type: 'error' });
    return null;
  }

  app.target.busy = true;
  emit('target:busy', true);

  const payload = {
    articleId: app.currentArticleId || undefined,
    source: app.source,
    platform: app.platform,
    themeCss: app.themeCss,
    themeName: app.themeName,
    force,
  };

  try {
    const response = await backend.build.target(payload);

    if (response.cached) {
      app.target = {
        key: response.key,
        prepared: true,
        preparedAt: response.preparedAt,
        bytes: response.bytes,
        validation: response.validation,
        stats: response.stats,
        busy: false,
      };
      await loadPreparedBytes(response.key);
      emit('target:changed', { reason: 'cached' });
      renderStatus();
      renderIssues(
        (response.validation?.errors || []).map(m => ({ message: m })),
        (response.validation?.warnings || []).map(m => ({ message: m })),
      );
      if (!silent) toast(t('build.reusedCache'));
      return app.target;
    }

    nodes.cancelButton?.classList.remove('hidden');
    log(t('build.log.preparing', { platform: platformLabel() }));

    activeJob = followJob(response.jobId, {
      onProgress: (event) => {
        const message = event.message || event.phase;
        if (message) {
          renderStatus(message, { busy: true, progress: event.total ? { done: event.done, total: event.total } : null });
          emit('target:progress', { message, done: event.done, total: event.total });
        }
      },
      onLog: (event) => log(event.message),
    });

    const result = await activeJob.promise;

    app.target = {
      key: result.key,
      prepared: true,
      preparedAt: new Date().toISOString(),
      bytes: result.bytes,
      validation: result.validation,
      stats: { formulas: result.formulas, timings: result.timings, ...result.validation.stats },
      busy: false,
    };

    log(t('build.log.prepared', {
      size: formatBytes(result.bytes),
      ms: result.durationMs,
      total: result.formulas.total,
      cached: result.formulas.cached,
    }));
    if (result.timings) {
      log(t('build.log.timings', {
        render: result.timings.render ?? '?',
        formulas: result.timings.formulas ?? '?',
        inline: result.timings.inline ?? '?',
        validate: result.timings.validate ?? '?',
      }));
    }

    await loadPreparedBytes(result.key);

    renderStatus();
    // Asset failures come with a full diagnostic; other validation errors are
    // plain strings.
    const assetFailures = result.assets?.errors || [];
    const plainErrors = (result.validation?.errors || [])
      .filter(m => !assetFailures.some(a => a.message === m))
      .map(m => ({ message: m }));

    renderIssues(
      [...assetFailures, ...plainErrors],
      (result.validation?.warnings || []).map(m => ({ message: m })),
    );
    emit('target:changed', { reason: 'compiled' });

    if (!silent) {
      toast(result.validation.valid
        ? t('build.readyToCopy')
        : t('build.compiledWithErrors', { count: result.validation.errors.length }),
      { type: result.validation.valid ? 'success' : 'error' });
    }

    return app.target;
  } catch (e) {
    app.target.busy = false;
    if (e instanceof CancelledError) {
      log(t('build.cancelled'));
      renderStatus(t('build.cancelled'));
      if (!silent) toast(t('build.compileCancelled'));
    } else {
      log(t('build.log.error', { message: e.message }));
      renderStatus(t('build.failed', { message: e.message }));
      if (!silent) toast(e.message, { type: 'error', timeout: 6000 });
    }
    return null;
  } finally {
    app.target.busy = false;
    activeJob = null;
    nodes.cancelButton?.classList.add('hidden');
    emit('target:busy', false);
  }
}

/**
 * Pull the prepared bytes into memory as soon as they exist.
 *
 * Doing this at preparation time — not at click time — means the clipboard
 * write is synchronous with the user's gesture, which is both faster and what
 * browsers require for a rich-text `clipboard.write()` to be permitted.
 */
async function loadPreparedBytes(key) {
  try {
    const payload = await backend.build.fetchTarget(key);

    app.target.html = payload.html;
    app.target.plainText = payload.plainText || '';
  } catch {
    app.target.html = null;
    app.target.plainText = null;
  }
}

/**
 * Put the prepared target output on the clipboard.
 *
 * This step never compiles: it writes bytes that were already produced. It only
 * falls back to preparing when nothing has been compiled yet, or when the
 * cached entry was evicted.
 */
export async function copyTarget({ asPlainHtml = false } = {}) {
  let prepared = app.target;

  if (!prepared.prepared || !prepared.key) {
    prepared = await prepareTarget({ silent: true });
    if (!prepared) return false;
  }

  if (app.target.html == null) {
    await loadPreparedBytes(app.target.key);
  }

  if (app.target.html == null) {
    // The cache entry was evicted; rebuild once.
    prepared = await prepareTarget({ force: true, silent: true });
    if (!prepared || app.target.html == null) return false;
  }

  const html = app.target.html;
  const text = app.target.plainText || '';

  try {
    if (asPlainHtml) {
      await navigator.clipboard.writeText(html);
      toast(t('build.copiedHtml'));
      return true;
    }

    await navigator.clipboard.write([new ClipboardItem({
      'text/html': new Blob([html], { type: 'text/html' }),
      'text/plain': new Blob([text], { type: 'text/plain' }),
    })]);
    toast(t('build.copiedFor', { platform: platformLabel(), size: formatBytes(html.length) }));
    return true;
  } catch (e) {
    try {
      await navigator.clipboard.writeText(html);
      toast(t('build.copiedPlain'));
      return true;
    } catch {
      toast(t('build.clipboardFailed', { message: e.message }), { type: 'error', timeout: 6000 });
      return false;
    }
  }
}

export async function exportTarget() {
  let prepared = app.target;
  if (!prepared.prepared || !prepared.key) {
    prepared = await prepareTarget({ silent: true });
    if (!prepared) return;
  }
  if (app.target.html == null) await loadPreparedBytes(app.target.key);
  if (app.target.html == null) {
    toast(t('build.nothingToExport'), { type: 'error' });
    return;
  }

  const payload = { html: app.target.html };
  const title = app.currentArticle?.title || 'article';
  const doc = `<!DOCTYPE html>\n<html lang="${app.currentArticle?.language || 'zh-CN'}"><head>`
    + `<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">`
    + `<title>${title}</title></head><body>\n${payload.html}\n</body></html>`;

  const blob = new Blob([doc], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const anchor = el('a', {
    href: url,
    download: `${title.replace(/[^\p{L}\p{N}_-]+/gu, '_')}.${app.platform}.html`,
  });
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  toast(t('build.exported'));
}

// ── PDF ───────────────────────────────────────────────────────────────────────

export async function compilePdf({ openPreview = true } = {}) {
  if (!app.env?.latex?.available) {
    return showLatexSetup();
  }

  emit('panel:open', 'build');
  logLines = [];
  log(t('build.log.compilingPdf'));
  renderStatus(t('build.startingLatex'), { busy: true });
  nodes.cancelButton?.classList.remove('hidden');

  try {
    const response = await backend.build.pdf({
      articleId: app.currentArticleId || undefined,
      source: app.source,
      sourceFormat: app.currentArticle?.sourceFormat,
      title: app.currentArticle?.title,
      language: app.currentArticle?.language,
      template: app.currentArticle?.pdfTemplate,
      engine: app.currentArticle?.pdfEngine,
    });

    if (response.unavailable) return showLatexSetup();

    activeJob = followJob(response.jobId, {
      onProgress: (event) => {
        if (event.message) {
          renderStatus(event.message, { busy: true });
          log(event.message);
        }
      },
      onLog: (event) => log(event.message),
    });

    const result = await activeJob.promise;

    app.pdf = {
      path: result.pdfPath,
      url: result.pdfPath ? backend.build.pdfUrl(result.pdfPath) : null,
      logPath: result.logPath,
      at: new Date().toISOString(),
      errors: result.errors,
      warnings: result.warnings,
    };

    renderIssues(result.errors, result.warnings);

    if (result.success) {
      log(t('build.log.pdfWritten', { path: result.pdfPath, size: formatBytes(result.pdfBytes) }));
      renderStatus(t('build.pdfReady', { size: formatBytes(result.pdfBytes), engine: result.engine }));
      toast(t('build.pdfCompiled'));
      emit('pdf:ready', app.pdf);
      if (openPreview) openPdfPreview();
    } else {
      log(t('build.log.pdfFailed'));
      renderStatus(t('build.failed', { message: result.errors[0]?.message || t('build.seeLog') }));
      toast(t('build.pdfFailed', { message: result.errors[0]?.message || t('build.seeBuildOutput') }),
        { type: 'error', timeout: 7000 });
    }

    return result;
  } catch (e) {
    if (e instanceof CancelledError) {
      log(t('build.cancelled'));
      renderStatus(t('build.cancelled'));
      toast(t('build.pdfCancelled'));
    } else {
      log(t('build.log.error', { message: e.message }));
      renderStatus(t('build.failed', { message: e.message }));
      toast(e.message, { type: 'error', timeout: 6000 });
    }
    return null;
  } finally {
    activeJob = null;
    nodes.cancelButton?.classList.add('hidden');
  }
}

export function openPdfPreview() {
  if (!app.pdf.url) {
    toast(t('build.compilePdfFirst'), { type: 'error' });
    return;
  }
  emit('preview:show-pdf', app.pdf);
}

/**
 * The LaTeX setup state.
 *
 * Shown instead of pretending PDF compilation exists but is unavailable: it
 * says exactly what is missing, where MDTeX looked, and how to install it on
 * this platform.
 */
export async function showLatexSetup() {
  const latex = app.env?.latex;

  await modal({
    title: t('build.setup.title'),
    subtitle: t('build.setup.subtitle'),
    width: 620,
    render: () => {
      const body = [];

      body.push(el('p', { class: 'dialog-message' },
        latex?.missing?.length
          ? t('build.setup.missing', { missing: latex.missing.join(', ') })
          : t('build.setup.noInstall')));

      if (latex?.hint) {
        body.push(el('p', { class: 'dialog-detail' }, latex.hint.summary));
        const list = el('ul', { class: 'setup-options' });
        for (const option of latex.hint.options) {
          list.append(el('li', {},
            el('strong', {}, option.label),
            el('span', {}, ` — ${option.detail}`)));
        }
        body.push(list);
        body.push(el('p', { class: 'dialog-detail muted' }, latex.hint.note));
      }

      if (latex?.searchedDirCount) {
        body.push(el('p', { class: 'dialog-detail muted' },
          t('build.setup.searched', { count: latex.searchedDirCount })));
      }

      for (const note of latex?.notes || []) {
        body.push(el('p', { class: 'dialog-detail warn' }, note));
      }

      return body.filter(Boolean);
    },
    actions: [
      { label: t('settings.close'), value: undefined },
      {
        label: t('build.checkAgain'),
        variant: 'primary',
        onClick: async (ctx) => {
          const env = await backend.env(true);
          app.env = env;
          emit('env:changed', env);
          if (env.latex.available) {
            ctx.close(true);
            toast(t('build.latexFound', { distribution: env.latex.distribution, engine: env.latex.defaultEngine }));
            compilePdf();
          } else {
            toast(t('build.stillNotFound'), { type: 'error' });
          }
          return false;
        },
      },
    ],
  });
  return null;
}

export function appendBuildLog(line) {
  log(line);
}
