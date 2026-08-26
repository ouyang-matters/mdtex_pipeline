# LaTeX and PDF

PDF compilation runs locally, from the UI, on Windows and Linux alike. This
document covers how MDTeX finds your TeX installation, what it does with it, and
what to do when something is missing.

---

## Pressing Compile PDF

The `PDF` button in the editor header (or Ctrl+Shift+P) compiles whatever is
open:

- **A Markdown article** goes through the deterministic Markdown → LaTeX
  converter into the PDF template selected in the article's properties, then
  through `latexmk`.
- **A LaTeX project** is compiled as-is: `latexmk` runs *in the project
  directory*, so `\input`, local `.sty`/`.cls` files, `.bib` bibliographies,
  figures and cross-references resolve exactly as they would in a terminal.

Either way the build:

- streams progress into the Build Output panel (`LaTeX pass 2 (xelatex)`,
  `Running bibtex…`)
- can be cancelled while it runs
- reports parsed errors and warnings with file and line, with a "Go to line"
  link back into the editor
- writes the PDF to `<article>/dist/pdf/` and previews it in the right-hand pane
- keeps the full compiler log, reachable from the same panel

From the command line the same build is:

```bash
publisher build <article-dir> --target pdf
publisher build <article-dir> --target pdf --engine lualatex --template academic
```

---

## Environment detection

MDTeX never assumes `/usr/bin/latexmk`. Detection goes through a cross-platform
executable resolver (`src/core/exec/which.js`) that searches PATH plus the
standard installation directories for the platform.

### What it looks for

| Tool | Why |
| --- | --- |
| `latexmk` | Drives the build, including reruns and bibliography passes |
| `xelatex` | Default engine — Unicode and system fonts |
| `lualatex` | Alternative Unicode engine |
| `pdflatex` | Fallback; cannot typeset CJK |
| `xdvipdfmx` / `dvipdfmx` | XeLaTeX emits an `.xdv`; this turns it into a PDF |
| `biber`, `bibtex` | Bibliographies |
| `kpsewhich` | Package preflight and CJK support probing |

### Where it looks

**Windows**

- every directory on `PATH`, honouring `PATHEXT` so `.exe`, `.cmd` and `.bat`
  shims all resolve
- `C:\texlive\<year>\bin\windows` and `…\bin\win32`
- `%ProgramFiles%\texlive\<year>\bin\…`, `%USERPROFILE%\texlive\<year>\bin\…`
- `%ProgramFiles%\MiKTeX\miktex\bin\x64`, `%ProgramFiles(x86)%\MiKTeX\miktex\bin`
- `%LOCALAPPDATA%\Programs\MiKTeX\miktex\bin\x64` (per-user MiKTeX)

**Linux**

- every directory on `PATH`
- `/usr/bin`, `/usr/local/bin`, `/bin`
- `/usr/local/texlive/<year>/bin/<arch>`, `/opt/texlive/<year>/bin/<arch>`
- `~/texlive/<year>/bin/<arch>`, `~/.texlive/<year>/bin/<arch>`
- `~/.local/bin`, `~/bin`

**macOS**

- `/Library/TeX/texbin`, `/usr/texbin`
- `/usr/local/texlive/<year>/bin/universal-darwin`
- `/opt/homebrew/bin`, `/usr/local/bin`

Years searched: next year through six years back, newest first.

Inspect the result at any time:

```bash
publisher latex            # what was found
publisher latex --verbose  # every directory searched
publisher doctor           # the same, in context
```

or in the UI: **Settings → LaTeX**, which lists each tool's resolved path and
has a **Re-detect** button.

### Split installations

Distributions do not always keep TeX in one place. A common Linux layout has
`latexmk` and `xelatex` in `/usr/bin` from distribution packages while
`xdvipdfmx`, `biber` and `kpsewhich` live in `/usr/local/texlive/<year>/bin/…`
and are not on `PATH` at all.

`latexmk` calls those helpers by bare name, so it would stop after producing an
`.xdv` and report no PDF. MDTeX collects every directory a TeX binary was found
in and prepends all of them to the build's `PATH`, which makes split
installations work without the user reconfiguring anything.

If `xelatex` is present but no `xdv`-to-PDF converter is, MDTeX says so and
prefers an engine that can finish.

---

## When LaTeX is missing

The UI does not pretend PDF compilation exists but is unavailable. Pressing
`PDF` opens a setup card that states what is missing, gives the install command
for the detected platform, and offers **Check again** — which re-detects without
restarting the application.

The install guidance MDTeX shows:

| Platform | Suggested |
| --- | --- |
| Debian / Ubuntu | `sudo apt install texlive-xetex texlive-latex-extra latexmk` |
| Fedora | `sudo dnf install texlive-scheme-medium texlive-latexmk` |
| Arch | `sudo pacman -S texlive-basic texlive-latexextra texlive-xetex texlive-binextra` |
| Windows | [TeX Live](https://tug.org/texlive/windows.html) or [MiKTeX](https://miktex.org/download) |
| macOS | `brew install --cask mactex`, or BasicTeX plus `sudo tlmgr install latexmk` |
| Any | [Upstream TeX Live](https://tug.org/texlive/quickinstall.html) |

On Windows, reopen MDTeX after installing so the new PATH is picked up — though
MDTeX also searches the standard TeX Live and MiKTeX directories directly, so a
default install is usually found without any restart at all.

---

## Markdown → LaTeX

The converter (`src/core/latex/markdown-to-latex.js`) walks the markdown-it
token stream rather than rewriting text with regular expressions. That
distinction matters: a regex converter cannot tell an underscore in prose from
one inside `$x_1$`, and will corrupt the mathematics while escaping the text.

| Markdown | LaTeX |
| --- | --- |
| `# Title` (first heading) | document title, remaining headings shift up |
| `##`, `###`, … | `\section`, `\subsection`, … |
| `$x$` / `$$…$$` | `\(x\)` / `\[…\]`, **verbatim** |
| `**bold**`, `*em*` | `\textbf{}`, `\emph{}` |
| `` `code` `` | `\texttt{}` with escaping |
| fenced code | `lstlisting` with the language, or `verbatim` as a fallback |
| tables | `tabular` with the source's column alignment |
| lists | `itemize` / `enumerate`, nested |
| images | `figure` + `\includegraphics`, with the alt text as the caption |
| links | `\href` |
| footnotes | `\footnote{}`, inlined at the reference |
| blockquote | `quote` |
| `---` | a rule |

Everything outside mathematics and verbatim spans is escaped: `\ { } $ & # ^ _ ~ %`.

### Images

Article source references images by an article-relative path
(`assets/figure-01.png`) — see
[WORKSPACE.md](WORKSPACE.md#images) for the canonical rule.

The generated `.tex` lives in a build directory, so that path would not resolve
from there. Each referenced image is copied into the build directory and the
**generated** LaTeX is rewritten to a bare, flat filename (`image-1.png`). The
canonical Markdown source is never modified to suit the build directory. Data
URIs — from a pasted screenshot — are decoded to files first.

Bare filenames also keep absolute paths out of `\includegraphics`, which is what
breaks LaTeX builds under directories containing spaces (`C:\Users\Zhang Wei\…`),
and keeps Unicode and nested directories out of the file names TeX has to read.

An image that cannot be resolved **fails the build**. It is not a warning: a PDF
that compiles with a figure missing looks fine until somebody reads it. The
error names the reference, the article root and the path that was expected.

Remote `https://` images are not downloaded for PDF builds; the build warns.

Native LaTeX projects are left alone — latexmk runs in the project root, so
relative paths, `\graphicspath`, `\input` and `.bib` all resolve exactly as they
do in a terminal. Before compiling, `\includegraphics` targets are preflighted so
a missing figure is reported as such instead of buried in the TeX log.

### Code languages

`listings` predates most modern languages. MDTeX only emits a `language=` option
for languages `listings` actually knows, and teaches it the rest in the template
preamble: Rust, Go, JavaScript, TypeScript, Kotlin, Swift, JSON and YAML. An
unknown language is typeset without keyword highlighting rather than failing the
build with *"Couldn't load requested language"*.

---

## PDF templates

Templates are LaTeX skeletons with placeholders, selected per article in
Properties → Publishing.

| Template | For |
| --- | --- |
| `default` (Article) | Clean single-column article. The default. |
| `academic` (Academic Paper) | Numbered sections, theorem environments, abstract support, tighter margins. |
| `notes` (Compact Notes) | Dense layout, small margins, tight lists. |

Placeholders: `{{DOCUMENTCLASS_OPTIONS}}`, `{{FONT_SETUP}}`, `{{TITLE}}`,
`{{AUTHOR}}`, `{{DATE}}`, `{{TITLE_BLOCK}}`, `{{BODY}}`.

Customise one by copying it into the user template directory:

```bash
# ~/.local/share/publisher/pdf-templates/<name>.tex
```

A user template shadows a built-in of the same name. The backend exposes
`POST /api/pdf-templates/:id/eject` to do this from the UI.

Built-in templates deliberately depend only on packages a base TeX Live install
provides. Before a Markdown build MDTeX asks `kpsewhich` whether the template's
packages are present and warns about any that are missing, rather than letting
the build fail with a file-not-found deep in the log.

---

## Fonts and CJK

| Engine | Fonts | CJK |
| --- | --- | --- |
| XeLaTeX | `fontspec`, system fonts | via `xeCJK`, when installed |
| LuaLaTeX | `fontspec`, system fonts | via `xeCJK`, when installed |
| pdfLaTeX | `lmodern`, `inputenc` | not possible |

For an article whose language starts with `zh`, `ja` or `ko`, MDTeX probes for
`xeCJK.sty` or `ctex.sty` with `kpsewhich`:

- found → loads `xeCJK`
- not found → compiles anyway and warns that CJK text may not render, with the
  package to install (`texlive-lang-chinese` on Debian/Ubuntu)
- engine is pdfLaTeX → warns that pdfLaTeX cannot typeset CJK at all and that
  the engine should be changed

---

## Compiler diagnostics

`latexmk` runs with `-file-line-error`, so most errors arrive as
`file.tex:12: message` and can be linked back to a line in the editor.

Diagnostics are parsed from the **final** `.log` file, not from the streamed
console output. The console replays every pass, so parsing it would surface
"Rerun to get cross-references right" warnings that `latexmk` had already
resolved by rerunning.

Recognised:

- `! LaTeX Error: …`, `! Undefined control sequence`, with the `l.<n>` context
- `file:line: message`
- missing `.sty` / `.cls` files, reported as a missing package with installation
  advice
- `LaTeX Warning:`, `Package X Warning:`, wrapped continuations joined
- Overfull / Underfull boxes, collected separately as layout notes
- latexmk-level failures such as a helper binary that could not be run — these
  never appear in the TeX log at all

---

## Build layout

```text
<article>/
  article.json
  source.md            (or main.tex)
  assets/
  dist/
    pdf/
      article.pdf      ← the result
      article.log      ← full compiler log
      article.aux, .fls, .fdb_latexmk, .synctex.gz
      tex/             ← generated LaTeX project (Markdown articles only)
        article.tex
        image-1.png    ← materialised images
```

For a LaTeX project the output directory is the same `dist/pdf/`, but `latexmk`
runs with the project directory as its working directory, so the source tree is
untouched.

---

## Engines

Selected per article in Properties → Publishing, or with `--engine`.

| Engine | latexmk flag | Notes |
| --- | --- | --- |
| `xelatex` | `-xelatex` | Default. Unicode, system fonts. Needs `xdvipdfmx`. |
| `lualatex` | `-lualatex` | Unicode, system fonts, Lua scripting. |
| `pdflatex` | `-pdf` | Fastest, most compatible; no system fonts, no CJK. |

If the requested engine is not installed, MDTeX falls back to one that is and
says so in the build warnings rather than failing.
