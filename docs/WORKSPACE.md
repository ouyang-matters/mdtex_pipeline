# Workspace and UI

How articles are organised on disk, and how the application works with them.

---

## Layout

```text
~/.local/share/publisher/workspace/
  weekly-digest/
    article.json
    source.md
    assets/
      diagram-1.png
    dist/
      weekly-digest.wechat.html
      pdf/
        article.pdf
        article.log
        tex/                      generated LaTeX (Markdown articles)
    .checkpoints/
      2026-08-25T21-30-00-000Z_1ee0968d.json
  research/
    bayesian-notes/
      article.json
      source.md
      assets/
    paper-draft/
      article.json
      main.tex                    a real LaTeX project
      sections/
      refs.bib
      figures/
      mystyle.sty
  .trash/
    deleted-article/
```

An article is a small self-contained project. Folders are user organisation and
carry no meaning beyond grouping.

---

## Identity versus presentation

This distinction is enforced by the backend, surfaced in the properties dialog,
and covered by tests.

**Identity — fixed, never editable**

| Field | Why |
| --- | --- |
| `id` | A UUID. Keys build caches, checkpoints and publish state. |
| `createdAt` | When the article was created. |
| directory name | Slugified from the original title, then frozen. |

Renaming an article changes its title. It does **not** rename the directory, and
it cannot change the ID. Moving an article between folders changes where it
lives and nothing else. A metadata update that tries to set an identity field
has that field ignored and reported back in `ignored`, rather than silently
dropped — the properties dialog shows these three fields read-only with a
`stable` badge and an explanation.

**Presentation — freely editable**

`title`, `subtitle`, `author`, `summary`, `language`, `tags`, `series`,
`seriesIndex`, `status`, `targets`, `theme`, `pdfTemplate`, `pdfEngine`, `slug`,
and `sourceFormat`.

`article.json`:

```json
{
  "id": "9db815c7-faa9-4547-8ad1-b9d46d916438",
  "title": "Numerical Methods for Regularized Inference",
  "subtitle": "",
  "author": "",
  "summary": "",
  "language": "zh-CN",
  "tags": ["numerics", "inference"],
  "series": "Inference Notes",
  "seriesIndex": 3,
  "sourceFormat": "markdown",
  "sourceFile": "source.md",
  "targets": ["wechat", "pdf"],
  "theme": "default",
  "pdfTemplate": "academic",
  "pdfEngine": "xelatex",
  "status": "draft",
  "createdAt": "2026-08-25T23:05:46.000Z",
  "updatedAt": "2026-08-25T23:41:12.000Z",
  "publishState": {}
}
```

### Changing source format

Switching between Markdown and LaTeX in Properties renames the source file
(`source.md` ↔ `main.tex`) after a confirmation that says plainly: the text is
kept verbatim, MDTeX does not convert it. To actually convert the content, use
the AI panel's *Convert Markdown → LaTeX* scope.

---

## The interface

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ ☰ MDTeX  Import │ Article title  MD  saved 2m ago │ Style Target  Compile │
│                                                     Copy HTML Export AI ⚙ │
├───────────┬──────────────────────────┬───────────────────────────────────┤
│ Search    │ Source          MD       │ Preview  WeChat    WeChat: ready  │
│ +Article  │  B I ` $ $$ [] >         │                                   │
│ +Folder   │        Image Insert PDF  │  Rendered article with live       │
│           │                          │  mathematics                      │
│ Weekly…   │  # Numerical Methods…    │                                   │
│ ▾ research│                          │                                   │
│   Bayes…  │  The estimator below…    │                                   │
│   Paper…  │                          │                                   │
├───────────┴──────────────────────────┴───────────────────────────────────┤
│ Style │ AI Assistant │ Build Output                                    × │
│ …                                                                        │
├──────────────────────────────────────────────────────────────────────────┤
│ 59P · 38H · 143 math · 9 code · 4 img · 6 tbl                            │
└──────────────────────────────────────────────────────────────────────────┘
```

### Library

- Folder tree with collapse state remembered between sessions
- Right-click an article: Open, Properties, Rename, Move to, Duplicate, Delete
- Right-click a folder: New article here, New subfolder, Rename, Delete
- Drag an article onto a folder to move it; drop on empty space for the root
- Keyboard: Enter opens, F2 renames, Delete moves to trash
- Search across titles, folders, tags, series and summaries, with an optional
  full-text toggle for article bodies
- Trash at the bottom, with per-item Restore and Delete permanently
- Empty state with a single obvious action

Every destructive action is a styled confirmation, and deleting an article shows
an **Undo** toast. There is no `window.prompt()` or `window.confirm()` anywhere
in the application — one dialog system, one context menu, one toast.

### Editor

- Markdown or LaTeX, format shown in the header
- Quick-insert toolbar that changes with the format
- Snippet palette (`Insert`), with keyboard shortcuts
- Auto-closing `$…$`, `{…}`, `(…)` and friends
- Images: the `Image` button, drag-and-drop **at the drop position**, or paste
- Auto-save about a second after you stop typing; header shows `unsaved` or
  `saved 2m ago`

Dropping an image stores it in the article's `assets/` directory and inserts a
relative reference — `![name](assets/name.png)` or a full `figure` environment
for LaTeX. Nothing is embedded as a data URI, so articles stay small and the
PDF build can find the file.

### Preview

Live KaTeX rendering with the selected theme. Statistics and validation warnings
in the diagnostics bar. Display equations scale to fit, then scroll locally if
they cannot — see
[WECHAT_RENDERING.md](WECHAT_RENDERING.md#mathematics-overflow).

After a PDF build the same pane shows the PDF, with a Close PDF button to return
to the live preview.

### Bottom panel

**Style** — live CSS editing with Save, Save as, Rename, Delete, Revert.
Built-in themes are read-only; saving one offers to create an editable copy.

**AI Assistant** — Quick Connect when nothing is configured, otherwise a chat
against the open article. See [AI_CONNECTIONS.md](AI_CONNECTIONS.md).

**Build Output** — target and PDF compilation, stage-by-stage progress, a Cancel
button, parsed errors and warnings with jump-to-line, and the full compiler log.

### Keyboard

| Shortcut | Action |
| --- | --- |
| Ctrl/Cmd+S | Save now |
| Ctrl/Cmd+Shift+N | New article |
| Ctrl/Cmd+I | Article properties |
| Ctrl/Cmd+Shift+P | Compile PDF |
| Ctrl/Cmd+Shift+F | Focus the library search |
| Ctrl/Cmd+, | Settings |
| F2 | Rename the selected article |
| Delete | Move the selected article to trash |
| Esc | Close a dialog, menu or search |

---

## Where state lives

Articles, themes, settings and secrets are on disk and shared with the
`publisher` command line. Browser storage holds only view state that is
worthless if lost: which article was open, whether the library is collapsed,
which folders are expanded.

Clearing your browser data cannot lose an article.

---

## Checkpoints

Every AI edit is checkpointed into `<article>/.checkpoints/` before it is
applied, so it is one click from being undone. Checkpoints travel with the
article when it moves, and the newest thirty are kept.

Restoring is itself checkpointed first, so restoring is reversible too.

---

## Trash

Deleting moves the article directory to `<workspace>/.trash/`, recording where
it came from. Restore puts it back in its original folder. Emptying the trash is
a separate, explicitly confirmed action.

---

## CLI equivalents

```bash
publisher ws create "My Article" --folder research --format latex
publisher ws list
publisher ws search "bayesian"
publisher ws import ~/Downloads/draft.md --folder inbox
```

The UI and the CLI read and write the same directory, so an article created in
one appears in the other.
