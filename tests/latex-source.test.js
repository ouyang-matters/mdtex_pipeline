import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Article } from '../src/workspace/article.js';
import {
  latexSourceOf, adoptLatexSource, saveLatexSnapshot, discardLatexSnapshot, readLatexSnapshot,
  DERIVED_DIR, DERIVED_FILE, SAVED_DIR, SAVED_FILE,
} from '../src/workspace/latex-source.js';
import { createCheckpoint, restoreCheckpoint, listCheckpoints } from '../src/workspace/checkpoints.js';
import { materialiseMarkdownProject } from '../src/core/pdf/compiler.js';

const TEST_DIR = join(tmpdir(), `publisher-latex-source-${process.pid}`);

// A one-pixel PNG, so the asset tests exercise real bytes.
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG_BYTES = Buffer.from(PNG_BASE64, 'base64');

function makeArticle(name, source, meta = {}) {
  const dir = join(TEST_DIR, name);
  mkdirSync(join(dir, 'assets'), { recursive: true });
  const article = new Article({ title: 'Test', _dir: dir, ...meta });
  article.writeSource(source);
  return article;
}

beforeEach(() => mkdirSync(TEST_DIR, { recursive: true }));
afterEach(() => rmSync(TEST_DIR, { recursive: true, force: true }));

describe('latexSourceOf', () => {
  it('derives a complete document from a Markdown article', () => {
    const article = makeArticle('basic', '# Title\n\nSome **text** and $x^2$.\n');
    const view = latexSourceOf(article);

    expect(view.derived).toBe(true);
    expect(view.tex).toContain('\\documentclass');
    expect(view.tex).toContain('\\begin{document}');
    expect(view.tex).toContain('\\textbf{text}');
    expect(view.tex).toContain('\\end{document}');
    expect(view.errors).toEqual([]);
  });

  it('returns the real source, undedrived, for a LaTeX article', () => {
    const article = makeArticle('tex', '\\documentclass{article}\n\\begin{document}Hi\\end{document}\n', {
      sourceFormat: 'latex',
      sourceFile: 'main.tex',
    });
    const view = latexSourceOf(article);

    expect(view.derived).toBe(false);
    expect(view.tex).toContain('Hi');
    expect(view.sourceFile).toBe('main.tex');
  });

  it('is a pure function of the source: two derivations are byte-identical', () => {
    const article = makeArticle('stable', '# T\n\n![a](assets/a.png)\n\ntext\n');
    writeFileSync(join(article.dir, 'assets', 'a.png'), PNG_BYTES);

    expect(latexSourceOf(article).tex).toBe(latexSourceOf(article).tex);
  });

  it('keeps images in their canonical article-relative form', () => {
    const article = makeArticle('images', '# T\n\n![fig](assets/fig.png)\n');
    writeFileSync(join(article.dir, 'assets', 'fig.png'), PNG_BYTES);

    const view = latexSourceOf(article);
    expect(view.tex).toContain('{assets/fig.png}');
    expect(view.tex).toContain('\\includegraphics');
    expect(view.errors).toEqual([]);
  });

  it('reports a missing image as an error rather than dropping it silently', () => {
    const article = makeArticle('missing', '# T\n\n![gone](assets/gone.png)\n');
    const view = latexSourceOf(article);

    expect(view.errors).toHaveLength(1);
    expect(view.errors[0].message).toContain('assets/gone.png');
  });

  it('flattens heading levels LaTeX has no command for', () => {
    const article = makeArticle('deep', 'Intro.\n\n##### five\n\n###### six\n');
    const view = latexSourceOf(article);

    // Both land on \\subparagraph: the distinction is not recoverable, which is
    // why the LaTeX view is one-way.
    expect(view.tex).toContain('\\subparagraph{five}');
    expect(view.tex).toContain('\\subparagraph{six}');
  });

  it('names an embedded image by its content, not its position', () => {
    const source = `# T\n\n![b](data:image/png;base64,${PNG_BASE64})\n`;
    const a = makeArticle('embed-a', source);
    // The same image, but with another one ahead of it in the document.
    const b = makeArticle('embed-b', `# T\n\n![x](assets/x.png)\n\n![b](data:image/png;base64,${PNG_BASE64})\n`);
    writeFileSync(join(b.dir, 'assets', 'x.png'), PNG_BYTES);

    const nameA = latexSourceOf(a).embedded[0].name;
    const nameB = latexSourceOf(b).embedded[0].name;
    expect(nameA).toBe(nameB);
  });

  it('persists the derived document under dist/ when asked', () => {
    const article = makeArticle('persist', '# T\n\ntext\n');
    const view = latexSourceOf(article, { persist: true });

    const onDisk = join(article.dir, DERIVED_DIR, DERIVED_FILE);
    expect(existsSync(onDisk)).toBe(true);
    expect(readFileSync(onDisk, 'utf-8')).toBe(view.tex);
  });

  it('does not write anything unless persistence is asked for', () => {
    const article = makeArticle('no-write', `# T\n\n![b](data:image/png;base64,${PNG_BASE64})\n`);
    latexSourceOf(article);

    expect(existsSync(join(article.dir, DERIVED_DIR, DERIVED_FILE))).toBe(false);
    expect(article.listAssets()).toHaveLength(0);
  });
});

describe('adoptLatexSource', () => {
  it('writes exactly the document the view showed', () => {
    const article = makeArticle('adopt', '# Title\n\nSome text with $x^2$.\n');
    const shown = latexSourceOf(article).tex;

    const result = adoptLatexSource(article);

    expect(result.tex).toBe(shown);
    expect(readFileSync(join(article.dir, 'main.tex'), 'utf-8')).toBe(shown);
  });

  it('leaves exactly one source file behind', () => {
    const article = makeArticle('one-source', '# Title\n\ntext\n');
    adoptLatexSource(article);

    expect(article.sourceFormat).toBe('latex');
    expect(article.sourceFile).toBe('main.tex');
    expect(existsSync(join(article.dir, 'main.tex'))).toBe(true);
    expect(existsSync(join(article.dir, 'source.md'))).toBe(false);
  });

  it('survives a reload: the metadata on disk points at the new source', () => {
    const article = makeArticle('reload', '# Title\n\ntext\n');
    adoptLatexSource(article);

    const reloaded = Article.fromDir(article.dir);
    expect(reloaded.sourceFormat).toBe('latex');
    expect(reloaded.readSource()).toContain('\\documentclass');
  });

  it('materialises embedded images into assets/ and references them there', () => {
    const article = makeArticle('embedded', `# T\n\n![shot](data:image/png;base64,${PNG_BASE64})\n`);
    const result = adoptLatexSource(article);

    expect(result.assets).toHaveLength(1);
    const name = result.assets[0].name;
    expect(existsSync(join(article.dir, 'assets', name))).toBe(true);
    expect(result.tex).toContain(`{assets/${name}}`);
  });

  it('refuses rather than adopt a document whose images are unresolved', () => {
    const article = makeArticle('broken', '# T\n\n![gone](assets/gone.png)\n');

    expect(() => adoptLatexSource(article)).toThrow(/unresolved/i);
    // Nothing moved.
    expect(article.sourceFormat).toBe('markdown');
    expect(existsSync(join(article.dir, 'source.md'))).toBe(true);
    expect(existsSync(join(article.dir, 'main.tex'))).toBe(false);
  });

  it('refuses to overwrite a main.tex it did not write', () => {
    const article = makeArticle('occupied', '# T\n\ntext\n');
    writeFileSync(join(article.dir, 'main.tex'), '% someone else was here\n');

    expect(() => adoptLatexSource(article)).toThrow(/already exists/i);
    expect(readFileSync(join(article.dir, 'main.tex'), 'utf-8')).toContain('someone else');
  });

  it('is refused a second time', () => {
    const article = makeArticle('twice', '# T\n\ntext\n');
    adoptLatexSource(article);

    expect(() => adoptLatexSource(article)).toThrow(/already uses LaTeX/i);
  });

  it('clears the derived copy under dist/, which no longer describes anything', () => {
    const article = makeArticle('clears', '# T\n\ntext\n');
    latexSourceOf(article, { persist: true });
    expect(existsSync(join(article.dir, DERIVED_DIR, DERIVED_FILE))).toBe(true);

    adoptLatexSource(article);
    expect(existsSync(join(article.dir, DERIVED_DIR, DERIVED_FILE))).toBe(false);
  });
});

describe('adoption is reversible', () => {
  it('restores the Markdown, the format and the file name', () => {
    const markdown = '# Title\n\nThe original **Markdown**.\n';
    const article = makeArticle('reversible', markdown);

    const { checkpoint } = adoptLatexSource(article);
    expect(article.sourceFormat).toBe('latex');

    const restored = restoreCheckpoint(article, checkpoint.id);

    expect(restored.sourceFormat).toBe('markdown');
    expect(article.sourceFormat).toBe('markdown');
    expect(article.sourceFile).toBe('source.md');
    expect(article.readSource()).toBe(markdown);
    expect(existsSync(join(article.dir, 'source.md'))).toBe(true);
    expect(existsSync(join(article.dir, 'main.tex'))).toBe(false);
  });

  it('keeps the adopted LaTeX recoverable after restoring', () => {
    const article = makeArticle('recoverable', '# Title\n\ntext\n');
    const { checkpoint, tex } = adoptLatexSource(article);
    restoreCheckpoint(article, checkpoint.id);

    // The pre-restore checkpoint holds the LaTeX we just stepped back from.
    const preRestore = listCheckpoints(article).find(c => c.origin === 'pre-restore');
    expect(preRestore).toBeTruthy();

    const back = restoreCheckpoint(article, preRestore.id);
    expect(back.sourceFormat).toBe('latex');
    expect(article.readSource()).toBe(tex);
  });

  it('restores a same-format checkpoint without disturbing the source file', () => {
    const article = makeArticle('same-format', '# One\n');
    const checkpoint = createCheckpoint(article, { label: 'first' });
    article.writeSource('# Two\n');

    restoreCheckpoint(article, checkpoint.id);

    expect(article.sourceFormat).toBe('markdown');
    expect(article.readSource()).toBe('# One\n');
    expect(existsSync(join(article.dir, 'source.md'))).toBe(true);
  });
});

describe('the build and the editor agree', () => {
  it('produces the same document body for the same source', () => {
    const source = '# Title\n\nA paragraph with $e^{i\\pi}$ and a list:\n\n- one\n- two\n';
    const article = makeArticle('agree', source);

    const view = latexSourceOf(article);
    const buildDir = join(TEST_DIR, 'agree-build');
    const project = materialiseMarkdownProject({
      source,
      buildDir,
      baseDir: article.dir,
      articleId: article.id,
      title: article.title,
      language: article.language,
    });

    // The image strategies differ by design; everything else must not.
    expect(project.tex).toBe(view.tex);
  });
});

describe('keeping a generated document', () => {
  it('shows the saved text next time instead of generating again', () => {
    const article = makeArticle('kept', '# Title\n\nOriginal prose.\n');
    const generated = latexSourceOf(article).tex;
    saveLatexSnapshot(article, generated);

    const reopened = latexSourceOf(article);
    expect(reopened.saved).toBe(true);
    expect(reopened.stale).toBe(false);
    expect(reopened.tex).toBe(generated);
  });

  it('keeps exactly the text it was handed, not a fresh derivation', () => {
    const article = makeArticle('verbatim', '# Title\n\ntext\n');
    saveLatexSnapshot(article, '% hand-checked\n\\documentclass{article}\n');

    expect(latexSourceOf(article).tex).toBe('% hand-checked\n\\documentclass{article}\n');
  });

  it('survives a reload, because the record is in article.json', () => {
    const article = makeArticle('durable', '# Title\n\ntext\n');
    saveLatexSnapshot(article, latexSourceOf(article).tex);

    const reloaded = Article.fromDir(article.dir);
    expect(reloaded.latexSnapshot?.savedAt).toBeTruthy();
    expect(latexSourceOf(reloaded).saved).toBe(true);
  });

  it('writes it where it cannot be mistaken for the source', () => {
    const article = makeArticle('placement', '# Title\n\ntext\n');
    saveLatexSnapshot(article, latexSourceOf(article).tex);

    expect(existsSync(join(article.dir, SAVED_DIR, SAVED_FILE))).toBe(true);
    // Not at the article root, where a .tex reads as the source file.
    expect(existsSync(join(article.dir, 'main.tex'))).toBe(false);
    expect(article.sourceFormat).toBe('markdown');
  });

  it('notices when the Markdown has moved on, by content not by clock', () => {
    const article = makeArticle('stale', '# Title\n\nBefore.\n');
    saveLatexSnapshot(article, latexSourceOf(article).tex);
    expect(latexSourceOf(article).stale).toBe(false);

    article.writeSource('# Title\n\nAfter.\n');
    const shown = latexSourceOf(article);
    expect(shown.saved).toBe(true);
    expect(shown.stale).toBe(true);
    // Still the saved text: that is what "saved" means.
    expect(shown.tex).not.toContain('After');
    expect(shown.warnings.join(' ')).toMatch(/earlier version/);
  });

  it('is not stale again once the source is changed back', () => {
    const original = '# Title\n\nBefore.\n';
    const article = makeArticle('reverted', original);
    saveLatexSnapshot(article, latexSourceOf(article).tex);

    article.writeSource('# Title\n\nAfter.\n');
    expect(latexSourceOf(article).stale).toBe(true);

    article.writeSource(original);
    expect(latexSourceOf(article).stale).toBe(false);
  });

  it('regenerates on request, without discarding what was saved', () => {
    const article = makeArticle('regen', '# Title\n\nBefore.\n');
    saveLatexSnapshot(article, latexSourceOf(article).tex);
    article.writeSource('# Title\n\nAfter.\n');

    const fresh = latexSourceOf(article, { regenerate: true });
    expect(fresh.saved).toBe(false);
    expect(fresh.tex).toContain('After');

    // The saved copy is still there until the user replaces or discards it.
    expect(latexSourceOf(article).saved).toBe(true);
    expect(latexSourceOf(article).tex).not.toContain('After');
  });

  it('goes back to generating every time once discarded', () => {
    const article = makeArticle('discard', '# Title\n\ntext\n');
    saveLatexSnapshot(article, latexSourceOf(article).tex);

    const result = discardLatexSnapshot(article);
    expect(result.discarded).toBe(true);
    expect(existsSync(join(article.dir, SAVED_DIR, SAVED_FILE))).toBe(false);
    expect(readLatexSnapshot(article)).toBeNull();
    expect(latexSourceOf(article).saved).toBe(false);
  });

  it('refuses to save nothing', () => {
    const article = makeArticle('empty-save', '# Title\n\ntext\n');
    expect(() => saveLatexSnapshot(article, '')).toThrow(/no LaTeX to save/i);
    expect(() => saveLatexSnapshot(article, '   ')).toThrow(/no LaTeX to save/i);
  });

  it('forgets the saved copy when LaTeX becomes the source', () => {
    const article = makeArticle('adopt-clears', '# Title\n\ntext\n');
    saveLatexSnapshot(article, latexSourceOf(article).tex);

    adoptLatexSource(article);

    expect(article.latexSnapshot).toBeNull();
    expect(existsSync(join(article.dir, SAVED_DIR, SAVED_FILE))).toBe(false);
    expect(existsSync(join(article.dir, 'main.tex'))).toBe(true);
  });

  it('ignores a record whose file has gone', () => {
    const article = makeArticle('orphaned', '# Title\n\ntext\n');
    saveLatexSnapshot(article, latexSourceOf(article).tex);
    rmSync(join(article.dir, SAVED_DIR, SAVED_FILE), { force: true });

    expect(readLatexSnapshot(article)).toBeNull();
    expect(latexSourceOf(article).saved).toBe(false);
  });
});
