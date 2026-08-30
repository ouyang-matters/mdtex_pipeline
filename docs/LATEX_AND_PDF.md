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
| `kpsewhich` | Package preflight and CJK package probing |
| `fc-list` | CJK font discovery (fontconfig; Windows reads the font directory) |

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

MDTeX typesets Chinese, Japanese and Korean, and treats a PDF that dropped
characters as a failed build. That second half matters more than the first: TeX
reports each glyph it cannot draw, carries on, exits zero, and hands back a page
with nothing on it. Reporting that as success is worse than failing.

### What support is made of

| Piece | Required? | Notes |
| --- | --- | --- |
| **Font** covering the script | **Yes** | This is the part that decides whether characters reach the page. |
| **Engine** — XeLaTeX or LuaLaTeX | **Yes** | pdfLaTeX cannot typeset CJK at all. |
| **Package** — `xeCJK` or `luatexja` | No | Improves line breaking and punctuation spacing. Its absence costs quality, not correctness. |

The font is the mandatory piece and the package the optional one. `fontspec`
plus an installed CJK font already produces correct glyphs; `xeCJK` decides how
they are spaced and where lines may break.

### How the decision is made

Before the build, MDTeX asks this machine what it has and plans from the answer.
Every probe that can answer is asked and the answers merged, because no single
one is right everywhere:

| Probe | Where it is trusted |
| --- | --- |
| `fc-list` (fontconfig) | Authoritative on Linux and macOS. On Windows it is usually TeX Live's own `fc-list`, whose cache covers TeX Live's fonts rather than the system's — so there it contributes, but never settles the question. |
| Font registry | Authoritative on Windows. `HKLM` and `HKCU` list installed *family names* directly, so a font MDTeX has no filename for is still found. |
| Font directories | Windows backstop: `%SystemRoot%\Fonts` **and** `%LOCALAPPDATA%\Microsoft\Windows\Fonts`, since a font installed "for me only" never appears in the system one. |
| `kpsewhich` | Packages (`xeCJK`, `luatexja`). |

The outcome:

| Situation | Result |
| --- | --- |
| Font found, package found | `xeCJK` (XeLaTeX) or `luatexja-fontspec` (LuaLaTeX), with `\setCJKmainfont`, sans and mono all set |
| Font found, no package | `\setmainfont` with the CJK font, plus `\XeTeXlinebreaklocale` under XeLaTeX. Warns that spacing is basic, and says how to install the package *on this distribution* — `tlmgr install xecjk` for TeX Live, the MiKTeX Console for MiKTeX, the apt name only on Debian |
| No font, and a probe answered | **Build refused**, naming what to install and which probes were consulted. It would otherwise produce a blank page |
| No font, and no probe could answer | Proceeds with the font that platform has always shipped (SimSun on Windows, Songti SC on macOS, Noto on Linux) and says so. A wrong guess stops the build with "font not found"; it never produces a PDF with the text missing |
| Engine is pdfLaTeX | **Build refused**, telling you to switch engine |

The trigger is the *text*, not the language tag. An article marked `en` that
quotes a Chinese title still gets a font that can draw it — metadata is the last
thing anyone updates, and reading the content is the only check that cannot be
wrong about what the document contains.

Fonts are chosen per script — Simplified, Traditional, Japanese, Korean — from a
preference list intersected with what is installed, so `zh-TW` gets a Traditional
face rather than a Simplified one. A specific font can be pinned per article in
**Properties → CJK font**; that list only offers fonts this machine actually has.

"Could not find out" is not "there is none". Refusing on a detection gap turns a
missing probe into a wall, and there is no need for the guess to be safe — the
check below catches a guess that was wrong.

### The check after the build

Whatever the preamble said, the TeX log is read for `Missing character` and any
occurrence fails the build, naming the font and the characters it could not
draw. This covers LaTeX projects too, whose preamble MDTeX does not write — so
a hand-written `main.tex` with Chinese in it and no CJK font is caught the same
way a generated one is.

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
