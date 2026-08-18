# Article Workspace

MDTeX manages articles as small projects in a persistent workspace.

## Location

```
~/.local/share/publisher/workspace/
```

## Article Structure

Each article is a directory containing:

```
article-name/
  article.json    Metadata (ID, title, tags, targets, theme)
  source.md       Primary Markdown source (or main.tex for LaTeX)
  assets/         Managed images and files
  dist/           Build outputs (WeChat HTML, PDF, etc.)
```

## Article Metadata

`article.json` contains:

```json
{
  "id": "stable-uuid",
  "title": "Article Title",
  "language": "zh-CN",
  "tags": ["math", "tutorial"],
  "series": "Bayesian Methods",
  "sourceFormat": "markdown",
  "sourceFile": "source.md",
  "targets": ["wechat", "zhihu", "pdf"],
  "theme": "default",
  "pdfEngine": "xelatex",
  "createdAt": "2026-08-18T...",
  "updatedAt": "2026-08-18T...",
  "publishState": {}
}
```

The `id` is stable across renames and folder moves. Folder structure is for user organization.

## CLI Commands

```bash
# Create articles
publisher ws create "Article Title"
publisher ws create "Paper" --format latex
publisher ws create "Note" --folder research/notes

# List and search
publisher ws list
publisher ws list --folder research
publisher ws search "bayesian"

# Import existing files
publisher ws import article.md
publisher ws import article.md --folder imported
```

## Source Formats

### Markdown
- Standard Markdown with inline/display LaTeX math
- Images via `assets/` directory
- Compiled to WeChat, Zhihu, PDF

### LaTeX
- Standard `.tex` files with `main.tex` entry point
- Figures, bibliography, multiple included files
- Compiled via `latexmk` with XeLaTeX/LuaLaTeX
- PDF preview with error/warning display

## Asset Management

Images imported into an article are copied to `assets/` with safe filenames.
Moving or renaming the article preserves all asset references.

```bash
# Assets are auto-managed when importing via UI drag-and-drop or file chooser
# The appropriate Markdown/LaTeX reference is inserted automatically
```

## Build Targets

One article can be compiled for multiple targets:

| Target | Output | Method |
|--------|--------|--------|
| Preview | Live HTML | KaTeX for speed |
| WeChat | Inline-SVG HTML | MathJax SVG + CSS inlining |
| Zhihu | Platform-adapted HTML | MathJax SVG + Zhihu adapter |
| PDF | PDF file | latexmk (LaTeX) or Markdown→LaTeX→PDF |
| Blog | Handed to blogpipe CLI | Source + metadata + assets |

## Data Safety

Articles live in `~/.local/share/publisher/workspace/`, outside the git repo.
Application updates never touch this directory.
