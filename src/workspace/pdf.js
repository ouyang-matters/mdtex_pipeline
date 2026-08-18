import { existsSync, writeFileSync, readFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { execSync } from 'child_process';
import { ensureDir } from '../core/paths.js';

/**
 * PDF compilation for LaTeX and Markdown articles.
 *
 * LaTeX projects: compiled directly via latexmk.
 * Markdown projects: converted to LaTeX first, then compiled.
 */
export class PdfCompiler {
  constructor() {
    this.available = false;
    this.engine = null;
  }

  /**
   * Detect available LaTeX engine.
   */
  detect() {
    for (const engine of ['xelatex', 'lualatex', 'pdflatex']) {
      try {
        execSync(`${engine} --version`, { encoding: 'utf-8', stdio: 'pipe', timeout: 5000 });
        this.engine = engine;
        this.available = true;
        return { available: true, engine };
      } catch {}
    }

    // Check for latexmk
    try {
      execSync('latexmk --version', { encoding: 'utf-8', stdio: 'pipe', timeout: 5000 });
      this.available = true;
      this.engine = 'xelatex'; // default for latexmk
      return { available: true, engine: 'latexmk' };
    } catch {}

    return { available: false, error: 'No LaTeX engine found. Install TeX Live or MiKTeX.' };
  }

  /**
   * Compile a LaTeX project to PDF.
   *
   * @param {object} options
   * @param {string} options.mainFile - Path to the main .tex file
   * @param {string} options.outputDir - Directory for build output
   * @param {string} options.engine - LaTeX engine (xelatex, lualatex, pdflatex)
   * @returns {{ success, pdfPath, log, errors, warnings }}
   */
  compileLatex({ mainFile, outputDir, engine = null }) {
    if (!this.available) {
      const detection = this.detect();
      if (!detection.available) return { success: false, log: '', errors: [detection.error], warnings: [] };
    }

    const effectiveEngine = engine || this.engine || 'xelatex';
    ensureDir(outputDir);

    try {
      const cmd = `latexmk -${effectiveEngine} -interaction=nonstopmode -output-directory="${outputDir}" "${mainFile}"`;
      const log = execSync(cmd, {
        encoding: 'utf-8',
        stdio: 'pipe',
        cwd: dirname(mainFile),
        timeout: 120000,
      });

      const pdfName = mainFile.replace(/\.tex$/, '.pdf').split('/').pop().split('\\').pop();
      const pdfPath = join(outputDir, pdfName);

      const warnings = extractWarnings(log);
      const errors = [];

      if (!existsSync(pdfPath)) {
        errors.push('PDF was not generated');
      }

      return { success: errors.length === 0, pdfPath, log, errors, warnings };
    } catch (e) {
      const log = e.stdout || e.stderr || e.message;
      const errors = extractErrors(log);
      return { success: false, pdfPath: null, log, errors, warnings: [] };
    }
  }

  /**
   * Compile a Markdown article to PDF via LaTeX intermediate.
   *
   * Converts Markdown to a minimal LaTeX document, then compiles.
   *
   * @param {object} options
   * @param {string} options.source - Markdown source
   * @param {string} options.title - Article title
   * @param {string} options.outputDir - Build output directory
   * @param {string} options.engine - LaTeX engine
   * @returns {{ success, pdfPath, log, errors, warnings }}
   */
  compileMarkdown({ source, title = 'Article', outputDir, engine = null }) {
    const texContent = markdownToLatex(source, title);
    const texPath = join(outputDir, 'article.tex');

    ensureDir(outputDir);
    writeFileSync(texPath, texContent, 'utf-8');

    return this.compileLatex({ mainFile: texPath, outputDir, engine });
  }
}

/**
 * Convert Markdown source to a basic LaTeX document.
 * Preserves math expressions and basic formatting.
 */
function markdownToLatex(source, title = 'Article') {
  let body = source;

  // Convert headings
  body = body.replace(/^######\s+(.+)$/gm, '\\subparagraph{$1}');
  body = body.replace(/^#####\s+(.+)$/gm, '\\paragraph{$1}');
  body = body.replace(/^####\s+(.+)$/gm, '\\subsubsection{$1}');
  body = body.replace(/^###\s+(.+)$/gm, '\\subsection{$1}');
  body = body.replace(/^##\s+(.+)$/gm, '\\section{$1}');
  body = body.replace(/^#\s+(.+)$/gm, ''); // title is handled separately

  // Bold and italic
  body = body.replace(/\*\*\*(.+?)\*\*\*/g, '\\textbf{\\textit{$1}}');
  body = body.replace(/\*\*(.+?)\*\*/g, '\\textbf{$1}');
  body = body.replace(/\*(.+?)\*/g, '\\textit{$1}');

  // Inline code
  body = body.replace(/`([^`]+)`/g, '\\texttt{$1}');

  // Code blocks (simplified)
  body = body.replace(/```[\w]*\n([\s\S]*?)```/g, '\\begin{verbatim}\n$1\\end{verbatim}');

  // Blockquotes
  body = body.replace(/^>\s+(.+)$/gm, '\\begin{quote}\n$1\n\\end{quote}');

  // Links
  body = body.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '\\href{$2}{$1}');

  // Images (basic)
  body = body.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '\\begin{figure}[h]\n\\centering\n\\includegraphics[width=0.8\\textwidth]{$2}\n\\caption{$1}\n\\end{figure}');

  // Horizontal rules
  body = body.replace(/^---+$/gm, '\\hrule\\vspace{1em}');

  // Unordered lists
  body = body.replace(/^- (.+)$/gm, '\\item $1');

  return `\\documentclass[12pt]{article}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{amsmath,amssymb,amsthm}
\\usepackage{hyperref}
\\usepackage{graphicx}
\\usepackage{geometry}
\\geometry{a4paper, margin=2.5cm}

\\title{${escapeLatex(title)}}
\\date{}

\\begin{document}
\\maketitle

${body}

\\end{document}
`;
}

function extractErrors(log) {
  const errors = [];
  const lines = (log || '').split('\n');
  for (const line of lines) {
    if (line.startsWith('!') || line.includes('Fatal error') || line.includes('Emergency stop')) {
      errors.push(line.trim());
    }
  }
  return errors.length > 0 ? errors : ['LaTeX compilation failed'];
}

function extractWarnings(log) {
  const warnings = [];
  const lines = (log || '').split('\n');
  for (const line of lines) {
    if (line.includes('Warning:') || line.includes('Overfull') || line.includes('Underfull')) {
      warnings.push(line.trim());
    }
  }
  return warnings;
}

function escapeLatex(str) {
  return str.replace(/[&%$#_{}~^\\]/g, c => '\\' + c);
}
