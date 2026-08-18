# LaTeX and PDF Compilation

MDTeX supports both Markdown and LaTeX source formats, with PDF compilation
for both via local LaTeX engines.

## Source Formats

### Markdown Projects
- Standard Markdown with inline/display LaTeX math (`$...$`, `$$...$$`)
- Compiled to HTML (WeChat, Zhihu) and PDF
- PDF compilation: Markdown → LaTeX intermediate → latexmk → PDF

### LaTeX Projects
- Native `.tex` files with `main.tex` entry point
- Supports `\input`, `\include`, `\bibliography`
- Figures in `assets/` directory
- Compiled directly via latexmk

## PDF Compilation

### Requirements
- A LaTeX distribution: TeX Live, MiKTeX, or MacTeX
- `latexmk` (included with TeX Live)
- For Chinese text: XeLaTeX or LuaLaTeX with appropriate fonts

### Engine Selection

The compiler detects available engines in order:
1. XeLaTeX (best for Chinese/Unicode)
2. LuaLaTeX (alternative Unicode engine)
3. pdfLaTeX (basic, ASCII-focused)

Per-article engine override via `article.json`:
```json
{
  "pdfEngine": "xelatex"
}
```

### CLI Usage

```bash
# Compile a LaTeX project
publisher build article-dir/ --target pdf

# The article directory should contain main.tex
```

### Markdown → LaTeX Conversion

For Markdown articles, MDTeX generates a LaTeX intermediate document:
- Headings → `\section`, `\subsection`, etc.
- Bold/italic → `\textbf`, `\textit`
- Math expressions → preserved as-is (already LaTeX)
- Code blocks → `verbatim` environment
- Images → `\includegraphics`
- Links → `\href`

The generated LaTeX uses:
- `article` document class, 12pt, A4
- `amsmath`, `amssymb`, `amsthm` for mathematics
- `hyperref` for links
- `graphicx` for images
- `geometry` for margins

### Build Output

Compilation produces:
```
article-dir/dist/
  article.pdf       Final PDF
  article.log       LaTeX log
  article.aux       Auxiliary files
```

Errors and warnings are extracted from the log and reported:
- `!` lines → errors
- `Warning:` lines → warnings
- `Overfull`/`Underfull` → layout warnings

## Integration with Workspace

Each article in the workspace can have PDF as a build target:

```json
{
  "targets": ["wechat", "zhihu", "pdf"]
}
```

The article's `dist/` directory contains build outputs for all targets.

## Future Improvements

- Custom LaTeX templates (matching blog PDF style)
- BibTeX/BibLaTeX bibliography compilation
- PDF preview in the UI
- SyncTeX for source-PDF synchronization
