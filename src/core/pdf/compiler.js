import { existsSync, writeFileSync, readFileSync, copyFileSync, rmSync, readdirSync, statSync } from 'fs';
import { join, dirname, basename, extname, resolve, relative, isAbsolute, sep } from 'path';
import { createHash } from 'crypto';
import { ensureDir } from '../paths.js';
import { runCommand } from '../exec/run.js';
import {
  detectLatexEnvironment, chooseEngine, ENGINES, DEFAULT_ENGINE, isSupportedEngine,
} from '../latex/environment.js';
import { DEFAULT_TEMPLATE } from '../latex/templates.js';
import { buildLatexDocument } from '../latex/document.js';
import { parseLatexLog, parseLatexmkProgress } from './log-parser.js';
import { AssetResolver, AssetKind, LATEX_IMAGE_EXTENSIONS } from '../assets/resolver.js';

/**
 * Local PDF compilation.
 *
 * Two paths, both ending in latexmk:
 *
 *   Markdown article -> deterministic Markdown->LaTeX -> selected PDF template
 *                       -> build directory -> latexmk
 *   LaTeX project    -> latexmk run in the project directory itself, so
 *                       \input, local .sty/.cls, .bib, figures and cross
 *                       references all resolve the way they do in a terminal
 *
 * Every run streams progress and can be cancelled through an AbortSignal.
 */

const IMAGE_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg', '.eps', '.svg', '.gif'];

/** Convert a filesystem path into something LaTeX will accept on any platform. */
export function texPath(p) {
  return String(p).split(sep).join('/');
}

/**
 * Ask kpsewhich whether a set of LaTeX packages is installed.
 * Returns { available: string[], missing: string[] } — an empty `missing` when
 * kpsewhich itself is unavailable, since we cannot prove absence in that case.
 */
export async function preflightPackages(packageNames, environment, { signal } = {}) {
  const kpsewhich = environment?.tools?.kpsewhich?.path;
  if (!kpsewhich || !packageNames?.length) {
    return { available: [], missing: [], checked: false };
  }

  const available = [];
  const missing = [];
  for (const name of packageNames) {
    const result = await runCommand(kpsewhich, [`${name}.sty`], { timeout: 8000, signal });
    if (result.code === 0 && result.stdout.trim()) available.push(name);
    else missing.push(name);
  }
  return { available, missing, checked: true };
}

/** Whether this TeX installation can typeset CJK with XeLaTeX. */
export async function detectCjkSupport(environment, { signal } = {}) {
  const kpsewhich = environment?.tools?.kpsewhich?.path;
  if (!kpsewhich) return { available: false, checked: false };
  for (const candidate of ['xeCJK.sty', 'ctex.sty']) {
    const result = await runCommand(kpsewhich, [candidate], { timeout: 8000, signal });
    if (result.code === 0 && result.stdout.trim()) return { available: true, checked: true, package: candidate };
  }
  return { available: false, checked: true };
}

// ── Markdown → LaTeX project materialisation ────────────────────────────────

/**
 * Turn a Markdown article into a self-contained LaTeX project inside `buildDir`.
 *
 * All referenced images are copied (or decoded, for data URIs) into the build
 * directory and referenced by bare filename. That keeps \includegraphics free
 * of absolute paths, which is what breaks LaTeX builds under directories
 * containing spaces — a common case on Windows.
 */
export function materialiseMarkdownProject({
  source,
  buildDir,
  baseDir = null,
  articleId = null,
  title = null,
  author = '',
  date = '',
  language = 'en',
  template: templateId = DEFAULT_TEMPLATE,
  engine = DEFAULT_ENGINE,
  cjkAvailable = false,
  cjkFont = null,
  mainName = 'article',
}) {
  ensureDir(buildDir);
  const warnings = [];
  const assetErrors = [];
  const assets = [];
  let assetCounter = 0;
  const seen = new Map();

  // The same resolver the preview and the WeChat renderer use, rooted at the
  // article. The generated .tex lives in a build directory, so `assets/x.png`
  // would not resolve from there — the file is copied in and the *generated*
  // reference is rewritten. The canonical Markdown source is never touched.
  const resolver = new AssetResolver({ articleRoot: baseDir, articleId });

  const resolveImage = (src) => {
    if (seen.has(src)) return seen.get(src);

    const record = resolver.resolve(src);
    let outName = null;

    if (record.kind === AssetKind.DATA) {
      const dataMatch = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(src);
      if (!dataMatch) {
        assetErrors.push({
          message: `Embedded image could not be parsed`,
          diagnostic: `Image not found\n\nSource:\n  ${truncate(src, 60)}\n\nReason:\n  Malformed data URI.`,
          source: src,
        });
        seen.set(src, null);
        return null;
      }
      const ext = mimeToExtension(dataMatch[1]);
      if (!ext) {
        assetErrors.push({
          message: `Embedded image has an unsupported type for LaTeX: ${dataMatch[1]}`,
          diagnostic: `Image not found\n\nSource:\n  data:${dataMatch[1]},…\n\nReason:\n  `
            + `LaTeX can only use ${LATEX_IMAGE_EXTENSIONS.join(', ')}.`,
          source: src,
        });
        seen.set(src, null);
        return null;
      }
      outName = `embedded-${++assetCounter}${ext}`;
      try {
        const buffer = dataMatch[2]
          ? Buffer.from(dataMatch[3], 'base64')
          : Buffer.from(decodeURIComponent(dataMatch[3]), 'utf-8');
        writeFileSync(join(buildDir, outName), buffer);
        assets.push(outName);
      } catch (e) {
        assetErrors.push({
          message: `Embedded image could not be decoded: ${e.message}`,
          diagnostic: `Image not found\n\nSource:\n  data:…\n\nReason:\n  ${e.message}`,
          source: src,
        });
        seen.set(src, null);
        return null;
      }
    } else if (record.kind === AssetKind.REMOTE) {
      warnings.push(`Remote image is not downloaded for PDF builds: ${truncate(src, 70)}`);
      seen.set(src, null);
      return null;
    } else {
      // Article-relative (the canonical case) or absolute.
      if (!record.exists) {
        assetErrors.push({
          message: `Image not found: ${src}`,
          diagnostic: resolver.describeFailure(src),
          source: src,
          articleRoot: resolver.articleRoot,
          expected: record.expected,
        });
        seen.set(src, null);
        return null;
      }

      const ext = extname(record.absolutePath).toLowerCase();
      if (!LATEX_IMAGE_EXTENSIONS.includes(ext)) {
        assetErrors.push({
          message: `LaTeX cannot use "${ext}" images: ${src}`,
          diagnostic: `Image not usable\n\nSource:\n  ${src}\n\nArticle root:\n  `
            + `${resolver.articleRoot}\n\nFound:\n  ${record.absolutePath}\n\nReason:\n  `
            + `LaTeX supports ${LATEX_IMAGE_EXTENSIONS.join(', ')}. Convert the image first.`,
          source: src,
          articleRoot: resolver.articleRoot,
          expected: record.absolutePath,
        });
        seen.set(src, null);
        return null;
      }

      if (record.kind === AssetKind.ABSOLUTE) {
        warnings.push(
          `Image "${truncate(src, 60)}" uses an absolute path. Move it into the article's `
          + 'assets directory so the article stays portable.',
        );
      }

      // Copied in with a flat, generated name so \includegraphics never has to
      // deal with spaces, Unicode or nested directories in the build directory.
      outName = `image-${++assetCounter}${ext}`;
      copyFileSync(record.absolutePath, join(buildDir, outName));
      assets.push(outName);
    }

    seen.set(src, outName);
    return outName;
  };

  // The document itself is assembled by the shared builder, so the .tex this
  // build compiles and the .tex the editor's LaTeX view shows are produced by
  // the same code. Only the image strategy above differs.
  const document = buildLatexDocument({
    source, title, author, date, language,
    template: templateId, engine, cjkAvailable, cjkFont,
    resolveImage,
  });
  warnings.push(...document.warnings);

  const mainFile = join(buildDir, `${mainName}.tex`);
  writeFileSync(mainFile, document.tex, 'utf-8');

  return {
    mainFile,
    tex: document.tex,
    assets,
    warnings,
    assetErrors,
    stats: document.stats,
    template: document.template,
    title: document.title,
    articleRoot: resolver.articleRoot,
  };
}

function truncate(value, max) {
  const text = String(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function mimeToExtension(mime) {
  const map = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/gif': '.gif',
    'application/pdf': '.pdf',
  };
  return map[mime.toLowerCase()] || null;
}

// ── latexmk invocation ───────────────────────────────────────────────────────

/**
 * Run latexmk over a main .tex file.
 *
 * @param {object} options
 * @param {string} options.mainFile   absolute path to the main .tex
 * @param {string} options.projectDir directory latexmk runs in (resolves \input, .sty, .bib)
 * @param {string} options.outputDir  where the PDF and aux files land
 * @param {string} options.engine     xelatex | lualatex | pdflatex
 * @param {AbortSignal} options.signal
 * @param {(event) => void} options.onProgress
 */
export async function runLatexmk({
  mainFile,
  projectDir,
  outputDir,
  engine = DEFAULT_ENGINE,
  environment,
  signal,
  onProgress = () => {},
  timeout = 300000,
  extraArgs = [],
  clean = false,
}) {
  const env = environment || await detectLatexEnvironment();
  if (!env.available) {
    return {
      success: false,
      pdfPath: null,
      log: '',
      errors: [{ severity: 'error', message: env.missing.length
        ? `LaTeX is not available: missing ${env.missing.join(', ')}.`
        : 'LaTeX is not available.' }],
      warnings: [],
      environment: env,
      engine: null,
    };
  }

  const picked = chooseEngine(engine, env);
  if (!picked.engine) {
    return {
      success: false, pdfPath: null, log: '',
      errors: [{ severity: 'error', message: 'No usable LaTeX engine found.' }],
      warnings: [], environment: env, engine: null,
    };
  }

  const engineWarnings = [];
  if (picked.fallback) {
    engineWarnings.push({
      severity: 'warning',
      source: 'mdtex',
      message: `Requested engine "${picked.requested}" is not installed; used ${ENGINES[picked.engine].label} instead.`,
    });
  }

  ensureDir(outputDir);

  const args = [
    ENGINES[picked.engine].flag,
    '-interaction=nonstopmode',
    '-file-line-error',
    '-synctex=1',
    '-halt-on-error',
    `-output-directory=${outputDir}`,
    ...extraArgs,
    mainFile,
  ];

  onProgress({ phase: 'latex', message: `Running latexmk (${ENGINES[picked.engine].label})…`, engine: picked.engine });

  let logBuffer = '';
  let currentPass = 0;

  // latexmk shells out to the engine and to helper programs (xdvipdfmx, bibtex,
  // biber, mktexpk) by bare name. Prepending every directory a TeX binary was
  // discovered in makes split installations work — e.g. latexmk in /usr/bin
  // while xdvipdfmx only exists under /usr/local/texlive/<year>/bin/<arch>.
  const pathSeparator = process.platform === 'win32' ? ';' : ':';
  const childEnv = {
    ...process.env,
    PATH: [...(env.binDirs || []), dirname(env.latexmk.path), dirname(env.engines[picked.engine].path), process.env.PATH || '']
      .filter(Boolean).join(pathSeparator),
    // Keep the engine from wrapping log lines, so -file-line-error output stays parseable.
    max_print_line: '10000',
    error_line: '254',
    half_error_line: '238',
  };

  const result = await runCommand(env.latexmk.path, args, {
    cwd: projectDir,
    env: childEnv,
    timeout,
    signal,
    onOutput: (chunk) => {
      logBuffer += chunk;
      for (const line of chunk.split(/\r?\n/)) {
        if (!line.trim()) continue;
        const progress = parseLatexmkProgress(line);
        if (progress?.kind === 'pass') {
          currentPass = progress.run;
          onProgress({ phase: 'latex', message: `LaTeX pass ${progress.run} (${progress.rule})`, pass: progress.run });
        } else if (progress?.kind === 'rule' && /bib(tex|er)/i.test(progress.rule)) {
          onProgress({ phase: 'bibliography', message: `Running ${progress.rule}…` });
        }
        onProgress({ phase: 'log', line });
      }
    },
  });

  // latexmk writes the .log next to the PDF when -output-directory is used.
  // Diagnostics come from that file only: it reflects the FINAL pass, whereas
  // the streamed console output replays every pass, so parsing the stream would
  // report "Rerun to get ... right" warnings that latexmk already resolved.
  const stem = basename(mainFile, extname(mainFile));
  const logPath = join(outputDir, `${stem}.log`);
  let texLog = '';
  if (existsSync(logPath)) {
    try { texLog = readFileSync(logPath, 'utf-8'); } catch { /* fall back to the stream */ }
  }

  const parsed = parseLatexLog(texLog || logBuffer);

  // latexmk-level failures (a helper binary missing, a rule that never
  // converged) never appear in the TeX log — only on latexmk's own stdout.
  for (const line of logBuffer.split(/\r?\n/)) {
    const m = line.match(/^\s{2}(\S+): Command for '\S+' gave return code (\d+)/);
    if (m) {
      parsed.errors.push({
        severity: 'error',
        message: `latexmk could not run "${m[1]}" (exit ${m[2]}). `
          + 'The TeX distribution appears to be incomplete — run "publisher doctor" for details.',
      });
    }
    if (/not found|No such file or directory/.test(line) && /sh: |command not found/.test(line)) {
      parsed.errors.push({ severity: 'error', message: line.trim() });
    }
  }

  const fullLog = logBuffer + (texLog ? `\n\n===== ${stem}.log =====\n${texLog}` : '');
  const pdfPath = join(outputDir, `${stem}.pdf`);
  const pdfExists = existsSync(pdfPath);

  const errors = [...parsed.errors];
  if (result.aborted) {
    errors.length = 0;
    errors.push({ severity: 'error', message: 'Compilation cancelled.' });
  } else if (result.timedOut) {
    errors.push({ severity: 'error', message: `Compilation timed out after ${Math.round(timeout / 1000)}s.` });
  } else if (result.spawnError) {
    errors.push({ severity: 'error', message: `Could not run latexmk: ${result.spawnError.message}` });
  } else if (!pdfExists && errors.length === 0) {
    errors.push({ severity: 'error', message: 'latexmk finished without producing a PDF. See the full log for details.' });
  }

  if (parsed.missingPackages.length) {
    errors.push({
      severity: 'error',
      message: `Missing LaTeX package(s): ${parsed.missingPackages.join(', ')}. `
        + 'Install them through your TeX distribution (tlmgr install … / MiKTeX package manager).',
    });
  }

  const success = pdfExists && errors.length === 0;

  if (clean && success) {
    for (const f of readdirSync(outputDir)) {
      if (/\.(aux|fls|fdb_latexmk|out|toc|lof|lot|bbl|blg|nav|snm|synctex\.gz)$/.test(f)) {
        try { rmSync(join(outputDir, f), { force: true }); } catch {}
      }
    }
  }

  return {
    success,
    pdfPath: pdfExists ? pdfPath : null,
    pdfBytes: pdfExists ? statSync(pdfPath).size : 0,
    logPath: existsSync(logPath) ? logPath : null,
    log: fullLog,
    errors,
    warnings: [...engineWarnings, ...parsed.warnings],
    layoutNotes: parsed.layoutNotes,
    passes: currentPass,
    engine: picked.engine,
    environment: env,
    cancelled: result.aborted,
  };
}

// ── High level entry points ──────────────────────────────────────────────────

/**
 * The source text of a compile subject.
 *
 * A subject is normally a plain descriptor carrying `source`, so an unsaved
 * editor buffer can be compiled. A workspace Article keeps its text on disk
 * and exposes `readSource()` instead — and reading `.source` off one yields
 * `undefined`, which would quietly compile an empty document. Accept both.
 */
export function subjectSource(subject) {
  if (!subject) return '';
  if (typeof subject.source === 'string') return subject.source;
  if (typeof subject.readSource === 'function') return subject.readSource();
  return '';
}

/**
 * Compile an article to PDF.
 *
 * `article` is a plain object so both the workspace Article model and an
 * unsaved buffer from the editor can be compiled:
 *   { sourceFormat, source, dir, sourceFile, title, language, pdfTemplate, pdfEngine }
 */
export async function compileArticleToPdf(article, {
  outputDir,
  signal,
  onProgress = () => {},
  timeout = 300000,
  environment = null,
} = {}) {
  const env = environment || await detectLatexEnvironment();

  if (!env.available) {
    return {
      success: false,
      unavailable: true,
      environment: env,
      errors: [{
        severity: 'error',
        message: 'No LaTeX installation was found, so PDF compilation cannot run.',
      }],
      warnings: [],
      log: '',
    };
  }

  const requestedEngine = isSupportedEngine(article.pdfEngine) ? article.pdfEngine : DEFAULT_ENGINE;

  if (article.sourceFormat === 'latex') {
    return compileLatexArticle(article, { outputDir, signal, onProgress, timeout, environment: env, engine: requestedEngine });
  }
  return compileMarkdownArticle(article, { outputDir, signal, onProgress, timeout, environment: env, engine: requestedEngine });
}

async function compileLatexArticle(article, { outputDir, signal, onProgress, timeout, environment, engine }) {
  const projectDir = article.dir;
  if (!projectDir || !existsSync(projectDir)) {
    return {
      success: false, errors: [{ severity: 'error', message: 'LaTeX project directory not found.' }],
      warnings: [], log: '', environment,
    };
  }

  const mainFile = resolveMainTexFile(article, projectDir);
  if (!mainFile) {
    return {
      success: false,
      errors: [{
        severity: 'error',
        message: `Main LaTeX file not found in ${projectDir}. Expected ${article.sourceFile || 'main.tex'}.`,
      }],
      warnings: [], log: '', environment,
    };
  }

  onProgress({ phase: 'prepare', message: `Compiling LaTeX project ${basename(mainFile)}…` });

  const localStyles = readdirSync(projectDir).filter(f => /\.(sty|cls)$/.test(f));
  if (localStyles.length) {
    onProgress({ phase: 'prepare', message: `Using local style files: ${localStyles.join(', ')}` });
  }
  const bibFiles = readdirSync(projectDir).filter(f => f.endsWith('.bib'));
  if (bibFiles.length) {
    onProgress({ phase: 'prepare', message: `Bibliography: ${bibFiles.join(', ')}` });
  }

  // latexmk runs with the project as its working directory, so normal LaTeX
  // relative-path semantics apply and \includegraphics{assets/figure-01.png}
  // resolves exactly as it would in a terminal. Check the referenced files up
  // front so a missing figure is reported with the article root, instead of
  // only appearing as "File `assets/figure-01.png' not found" in the log.
  const graphicsIssues = preflightLatexGraphics(article, projectDir);
  for (const issue of graphicsIssues) {
    onProgress({ phase: 'prepare', message: issue.diagnostic, level: 'error' });
  }

  const result = await runLatexmk({
    mainFile,
    projectDir,
    outputDir,
    engine,
    environment,
    signal,
    onProgress,
    timeout,
  });

  return {
    ...result,
    mode: 'latex',
    mainFile,
    projectDir,
    articleRoot: projectDir,
    assetErrors: graphicsIssues,
    errors: [
      ...graphicsIssues.map(issue => ({
        severity: 'error',
        message: issue.message,
        diagnostic: issue.diagnostic,
        source: issue.source,
        articleRoot: issue.articleRoot,
        expected: issue.expected,
      })),
      ...(result.errors || []),
    ],
    success: result.success && graphicsIssues.length === 0,
  };
}

async function compileMarkdownArticle(article, { outputDir, signal, onProgress, timeout, environment, engine }) {
  onProgress({ phase: 'prepare', message: 'Converting Markdown to LaTeX…' });

  const buildDir = join(outputDir, 'tex');
  // A stale build dir can hide renamed images; start clean each time.
  try { rmSync(buildDir, { recursive: true, force: true }); } catch {}
  ensureDir(buildDir);

  const cjk = await detectCjkSupport(environment, { signal });

  const project = materialiseMarkdownProject({
    source: subjectSource(article),
    buildDir,
    baseDir: article.dir || null,
    articleId: article.id || null,
    title: article.title || null,
    author: article.author || '',
    date: article.date || '',
    language: article.language || 'en',
    template: article.pdfTemplate || DEFAULT_TEMPLATE,
    engine,
    cjkAvailable: cjk.available,
    cjkFont: article.cjkFont || null,
  });

  for (const w of project.warnings) {
    onProgress({ phase: 'prepare', message: w, level: 'warning' });
  }

  // An image that cannot be resolved is a build failure, not a warning: the
  // PDF would silently be missing a figure. The diagnostic names the source,
  // the article root and the exact path that was expected.
  if (project.assetErrors.length) {
    for (const failure of project.assetErrors) {
      onProgress({ phase: 'prepare', message: failure.diagnostic, level: 'error' });
    }
    return {
      success: false,
      mode: 'markdown',
      engine: null,
      pdfPath: null,
      log: project.assetErrors.map(e => e.diagnostic).join('\n\n'),
      errors: project.assetErrors.map(e => ({
        severity: 'error',
        message: e.message,
        diagnostic: e.diagnostic,
        source: e.source,
        articleRoot: e.articleRoot,
        expected: e.expected,
      })),
      warnings: project.warnings.map(message => ({ severity: 'warning', source: 'mdtex', message })),
      assetErrors: project.assetErrors,
      articleRoot: project.articleRoot,
      projectDir: buildDir,
    };
  }
  onProgress({
    phase: 'prepare',
    message: `LaTeX intermediate written (${project.stats.headings} headings, `
      + `${project.stats.mathBlock + project.stats.mathInline} equations, ${project.assets.length} image(s)).`,
  });

  const preflight = await preflightPackages(project.template.packages || [], environment, { signal });
  if (preflight.checked && preflight.missing.length) {
    onProgress({
      phase: 'prepare',
      level: 'warning',
      message: `Template "${project.template.id}" wants packages that are not installed: ${preflight.missing.join(', ')}.`,
    });
  }

  const result = await runLatexmk({
    mainFile: project.mainFile,
    projectDir: buildDir,
    outputDir,
    engine,
    environment,
    signal,
    onProgress,
    timeout,
  });

  const warnings = [
    ...project.warnings.map(message => ({ severity: 'warning', source: 'mdtex', message })),
    ...result.warnings,
  ];

  if (preflight.checked && preflight.missing.length) {
    warnings.unshift({
      severity: 'warning',
      source: 'mdtex',
      message: `Missing LaTeX packages for template "${project.template.id}": ${preflight.missing.join(', ')}`,
    });
  }

  return {
    ...result,
    warnings,
    mode: 'markdown',
    mainFile: project.mainFile,
    texSource: project.tex,
    template: project.template.id,
    projectDir: buildDir,
  };
}

/**
 * Check every \includegraphics target in a LaTeX project.
 *
 * LaTeX resolves these relative to the compilation working directory, which is
 * the project root — the same root the preview and the WeChat renderer use, so
 * one canonical reference works everywhere. LaTeX also allows the extension to
 * be omitted, which is honoured here.
 */
export function preflightLatexGraphics(article, projectDir) {
  const resolver = new AssetResolver({ articleRoot: projectDir, articleId: article.id || null });
  const issues = [];
  const seen = new Set();

  const texFiles = collectTexFiles(projectDir);

  for (const texFile of texFiles) {
    let content;
    try { content = readFileSync(texFile, 'utf-8'); } catch { continue; }

    for (const match of content.matchAll(/\\includegraphics\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g)) {
      const src = match[1].trim();
      if (!src || src.includes('\\') || seen.has(src)) continue; // skip macro arguments
      seen.add(src);

      const record = resolver.resolve(src);
      if (record.exists) continue;

      // LaTeX lets you omit the extension.
      const withExtension = LATEX_IMAGE_EXTENSIONS
        .map(ext => resolver.resolve(`${src}${ext}`))
        .find(r => r.exists);
      if (withExtension) continue;

      issues.push({
        message: `Image not found: ${src}`,
        diagnostic: resolver.describeFailure(src)
          + `\n\nReferenced from:\n  ${basename(texFile)}`,
        source: src,
        articleRoot: projectDir,
        expected: record.expected,
      });
    }
  }

  return issues;
}

/** Every .tex file in a project, one level of subdirectories deep. */
function collectTexFiles(projectDir, depth = 2) {
  const found = [];
  const walk = (dir, remaining) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'dist') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory() && remaining > 0) walk(full, remaining - 1);
      else if (entry.isFile() && entry.name.endsWith('.tex')) found.push(full);
    }
  };
  walk(projectDir, depth);
  return found;
}

/**
 * Find the main .tex file of a LaTeX project.
 * Prefers the article's declared source file, then main.tex, then the only .tex
 * present, then the first file containing \documentclass.
 */
export function resolveMainTexFile(article, projectDir) {
  const declared = article.sourceFile ? join(projectDir, article.sourceFile) : null;
  if (declared && existsSync(declared)) return declared;

  const mainTex = join(projectDir, 'main.tex');
  if (existsSync(mainTex)) return mainTex;

  const texFiles = readdirSync(projectDir).filter(f => f.endsWith('.tex'));
  if (texFiles.length === 1) return join(projectDir, texFiles[0]);

  for (const f of texFiles) {
    try {
      if (/\\documentclass/.test(readFileSync(join(projectDir, f), 'utf-8'))) {
        return join(projectDir, f);
      }
    } catch { /* unreadable */ }
  }

  return null;
}

/** Stable identity for a compile request, used for build caching. */
export function pdfCacheKey(article, engine, template) {
  return createHash('sha256').update(JSON.stringify({
    source: subjectSource(article),
    format: article.sourceFormat,
    title: article.title,
    language: article.language,
    engine,
    template,
  })).digest('hex').slice(0, 16);
}
