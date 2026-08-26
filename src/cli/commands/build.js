import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, readdirSync } from 'fs';
import { resolve, dirname, basename, extname, join } from 'path';
import { Compiler } from '../../core/compiler/index.js';
import { Article } from '../../workspace/article.js';
import { ArticleLibrary } from '../../workspace/library.js';
import { compileArticleToPdf } from '../../core/pdf/compiler.js';
import { detectLatexEnvironment } from '../../core/latex/environment.js';
import { paths, ensureDir } from '../../core/paths.js';

/**
 * `publisher build <target> --target <platform|pdf>`
 *
 * Accepts a source file, an article directory, or a workspace article id, so
 * the same command works whether the user is pointing at a loose Markdown file
 * or at a project MDTeX created.
 */
export async function buildCommand(target, opts) {
  const subject = resolveSubject(target);

  if (opts.target === 'pdf') {
    await buildPdf(subject, opts);
    return;
  }

  await buildPlatform(subject, opts);
}

function resolveSubject(target) {
  const abs = resolve(target);

  // A directory containing article.json is a workspace article.
  if (existsSync(abs) && statSync(abs).isDirectory()) {
    const article = Article.fromDir(abs);
    if (article) return { kind: 'article', article, source: article.readSource(), baseDir: abs };

    // A plain directory: look for a main .tex or a single markdown file.
    const files = readdirSync(abs);
    const tex = files.find(f => f === 'main.tex') || files.find(f => f.endsWith('.tex'));
    if (tex) {
      return {
        kind: 'article',
        article: new Article({ title: basename(abs), sourceFormat: 'latex', sourceFile: tex, _dir: abs }),
        source: readFileSync(join(abs, tex), 'utf-8'),
        baseDir: abs,
      };
    }
    const md = files.find(f => /\.(md|markdown)$/i.test(f));
    if (md) {
      return {
        kind: 'article',
        article: new Article({ title: basename(abs), sourceFormat: 'markdown', sourceFile: md, _dir: abs }),
        source: readFileSync(join(abs, md), 'utf-8'),
        baseDir: abs,
      };
    }
    throw new Error(`No article.json, .tex or .md file found in ${abs}`);
  }

  if (existsSync(abs)) {
    const ext = extname(abs).toLowerCase();
    const sourceFormat = ['.tex', '.latex', '.ltx'].includes(ext) ? 'latex' : 'markdown';
    return {
      kind: 'file',
      article: new Article({
        title: basename(abs, ext),
        sourceFormat,
        sourceFile: basename(abs),
        _dir: dirname(abs),
      }),
      source: readFileSync(abs, 'utf-8'),
      baseDir: dirname(abs),
      file: abs,
    };
  }

  // Finally, treat it as a workspace article id or title.
  const lib = new ArticleLibrary();
  const byId = lib.getEntryById(target);
  if (byId) {
    return { kind: 'article', article: byId.article, source: byId.article.readSource(), baseDir: byId.article.dir };
  }
  const byTitle = lib.search(target)[0];
  if (byTitle) {
    return { kind: 'article', article: byTitle.article, source: byTitle.article.readSource(), baseDir: byTitle.article.dir };
  }

  throw new Error(`Not found: ${target}\nPass a Markdown/LaTeX file, an article directory, or a workspace article title.`);
}

async function buildPlatform(subject, opts) {
  const compiler = new Compiler();
  const started = Date.now();

  const result = await compiler.compile(subject.source, {
    theme: opts.theme || subject.article.theme || 'default',
    platform: opts.target,
    baseDir: subject.baseDir,
    mathOutput: opts.math,
    // In-place progress only makes sense on a terminal; when the output is
    // piped or captured, a per-formula line would be pure noise.
    onProgress: (opts.quiet || !process.stderr.isTTY) ? null : (event) => {
      if (event.message && event.phase !== 'log') process.stderr.write(`\r  ${event.message.padEnd(48)}`);
    },
  });

  if (!opts.quiet && process.stderr.isTTY) process.stderr.write('\r' + ' '.repeat(52) + '\r');

  if (opts.dryRun) {
    console.log(`Validated: ${subject.article.title}`);
    console.log(`Platform: ${opts.target}`);
    console.log(`Theme: ${result.theme.name}`);
    console.log(`Math: ${result.mathResult.inlineRendered} inline, ${result.mathResult.displayRendered} display`);
    printValidation(result.validation);
    if (!result.validation.valid) process.exitCode = 1;
    return;
  }

  const outFile = opts.output
    ? resolve(opts.output)
    : subject.kind === 'article' && subject.article.dir
      ? join(ensureDir(join(subject.article.dir, 'dist')), `${slug(subject.article.title)}.${opts.target}.html`)
      : resolve('dist', `${basename(subject.file, extname(subject.file))}.${opts.target}.html`);

  ensureDir(dirname(outFile));
  writeFileSync(outFile, result.html, 'utf-8');

  console.log(`Compiled: ${subject.article.title} -> ${outFile}`);
  console.log(`Platform: ${opts.target}`);
  console.log(`Theme: ${result.theme.name}`);
  console.log(`Math: ${result.mathOutput} (${result.mathResult.inlineRendered} inline, ${result.mathResult.displayRendered} display, ${result.mathResult.cached} cached)`);
  console.log(`Time: ${Date.now() - started} ms`);
  printValidation(result.validation);

  if (!result.validation.valid) process.exitCode = 1;
}

async function buildPdf(subject, opts) {
  const environment = await detectLatexEnvironment();

  if (!environment.available) {
    console.error('PDF compilation needs a LaTeX installation, and none was found.');
    console.error(`Missing: ${environment.missing.join(', ')}`);
    console.error('');
    if (environment.hint) {
      console.error(environment.hint.summary);
      for (const option of environment.hint.options) {
        console.error(`  ${option.label}: ${option.detail}`);
      }
      console.error('');
      console.error(environment.hint.note);
    }
    console.error('');
    console.error('Run `publisher doctor` to see every directory that was searched.');
    process.exit(1);
  }

  const outputDir = opts.output
    ? resolve(opts.output)
    : subject.article.dir
      ? join(subject.article.dir, 'dist', 'pdf')
      : resolve('dist', 'pdf');

  const started = Date.now();
  const result = await compileArticleToPdf({
    sourceFormat: subject.article.sourceFormat,
    source: subject.source,
    dir: subject.article.dir,
    sourceFile: subject.article.sourceFile,
    title: subject.article.title,
    author: subject.article.author,
    language: subject.article.language,
    pdfTemplate: opts.template || subject.article.pdfTemplate || 'default',
    pdfEngine: opts.engine || subject.article.pdfEngine || environment.defaultEngine,
  }, {
    outputDir,
    environment,
    onProgress: opts.quiet ? () => {} : (event) => {
      if (event.phase === 'log') return;
      if (event.message) console.log(`  ${event.message}`);
    },
  });

  console.log('');
  if (result.success) {
    console.log(`PDF: ${result.pdfPath}`);
    console.log(`Engine: ${result.engine}${result.template ? `, template ${result.template}` : ''}`);
    console.log(`Size: ${(result.pdfBytes / 1024).toFixed(1)} KB`);
    console.log(`Time: ${Date.now() - started} ms`);
  } else {
    console.error('PDF compilation failed.');
  }

  for (const error of result.errors || []) {
    console.error(`  ✗ ${error.file ? `${basename(error.file)}:${error.line ?? '?'}: ` : ''}${error.message}`);
  }
  for (const warning of (result.warnings || []).slice(0, 15)) {
    console.log(`  ⚠ ${warning.message}`);
  }
  if ((result.warnings || []).length > 15) {
    console.log(`  … and ${result.warnings.length - 15} more warning(s)`);
  }
  if (result.logPath) console.log(`\nFull log: ${result.logPath}`);

  if (!result.success) process.exit(1);
}

export function printValidation(validation) {
  const { stats, warnings, errors } = validation;

  console.log('\nStats:');
  console.log(`  ${stats.paragraphs} paragraphs`);
  console.log(`  ${stats.headings} headings`);
  console.log(`  ${stats.mathTotal} equations (${stats.mathDisplay} display, ${stats.mathInline} inline)`);
  console.log(`  ${stats.images} images`);
  console.log(`  ${stats.codeBlocks} code blocks`);
  console.log(`  ${stats.tables} tables`);
  console.log(`  ${stats.links} links`);

  if (errors.length > 0) {
    console.log('\nERRORS:');
    for (const e of errors) console.log(`  ✗ ${e}`);
  }

  if (warnings.length > 0) {
    console.log('\nWARNINGS:');
    for (const w of warnings) console.log(`  ⚠ ${w}`);
  }

  if (errors.length === 0 && warnings.length === 0) {
    console.log('\n✓ No issues found.');
  }
}

function slug(str) {
  return String(str).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'article';
}
