# Architecture

## Overview

MDTeX Pipeline is a local-first academic writing and publishing workspace.
It organizes articles, renders Markdown+LaTeX for multiple platforms, manages
assets, compiles PDFs, integrates with the blog-pipeline for deployment, and
supports AI-assisted editing via local or remote Claude backends.

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  MDTeX Workspace                                            │
│                                                             │
│  Article Library (create, search, organize, import)         │
│  Asset Manager (images, figures, drag-drop, safe filenames) │
│  Source Editor (Markdown + LaTeX)                           │
│  Live Preview (KaTeX, instant)                              │
│  CSS Style Editor (builtin + custom themes)                 │
│                                                             │
│  Build Targets:                                             │
│    ├── WeChat (inline SVG math, juice CSS inlining)         │
│    ├── Zhihu (adapted HTML, separate adapter)               │
│    ├── PDF (latexmk / Markdown→LaTeX→PDF) [planned]        │
│    └── Blog (handed to blogpipe CLI)                        │
│                                                             │
│  AI Backends:                                               │
│    ├── LocalClaudeCodeBackend (installed CLI)                │
│    └── RemoteClaudeClawBackend (HTTP/SSH)                   │
└─────────────────────────────────────────────────────────────┘
         │                              │
         ▼                              ▼
    blog-pipeline                  Claude Code
    (deploy, sync,                 (content/style
     releases, rollback)            editing)
```

## Publishing Pipeline

```
Markdown source
    │
    ▼
┌─────────────────────────┐
│  markdown-it parser      │  Plugins: footnotes, texmath (KaTeX), GFM
│  + custom renderers      │  Code: highlight.js
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│  Scoped HTML (#nice)     │  Math: KaTeX HTML+MathML (for preview)
└────────────┬────────────┘
             │
   ┌─────────┴─────────┐
   │ Preview            │ Publish
   │ (KaTeX HTML)       │
   │                    ▼
   │   ┌────────────────────────┐
   │   │  MathJax post-process  │  Replace <eq>/<eqn> with inline SVG
   │   │  (tex2svg, inline)     │  <path>-only, no CSS dependencies
   │   └───────────┬────────────┘
   │               │
   │               ▼
   │   ┌────────────────────────┐
   │   │  Theme + platform CSS  │  Resolve variables, append overrides
   │   │  → juice CSS inliner   │  Inline all styles onto elements
   │   └───────────┬────────────┘
   │               │
   │               ▼
   │   ┌────────────────────────┐
   │   │  Platform adapter       │  WeChat: section wrappers, strip classes
   │   │  sanitize + validate    │  Zhihu: strip IDs, add target=_blank
   │   └───────────┬────────────┘
   │               │
   ▼               ▼
Preview        Clipboard / Export / blogpipe
```

## Module Structure

```
src/
  core/
    parser/         markdown-it + KaTeX + footnotes
    renderer/       HTML generation scoped under #nice
    math/
      index.js            MathNode, counting
      publish-renderer.js MathJax SVG singleton (server-side)
      post-processor.js   Replace KaTeX → inline SVG
      formula-cache.js    SHA-256 content-hash cache
      svg-to-png.js       sharp SVG→PNG at 3x (fallback)
    code/           highlight.js code blocks
    images/         ImageNode, resolution, uploader interface
    themes/         Theme loading (builtin + user), CSS variables
    compiler/       Pipeline orchestration, juice inlining, validation
    config/         Config loading, migration, backup/restore
    paths.js        XDG-compliant path management (Linux/macOS/Windows)

  platforms/
    base.js         PlatformAdapter interface
    wechat/         WeChat adapter (transform, sanitize, validate)
    zhihu/          Zhihu adapter

  workspace/
    article.js      Article model (metadata, source, assets)
    library.js      ArticleLibrary (create, search, organize)
    blogpipe.js     Blog Pipeline CLI integration

  ai/
    backend.js      AIBackend interface + implementations

  ui/              Browser-side rendering (Vite app)
  cli/             Commander-based CLI

themes/builtin/    Built-in CSS themes (default, minimal, modern)
tests/             Vitest test suites and fixtures
scripts/           Self-test, install helpers
docs/              Documentation
```

## Data Layout

```
Application code:     <repo>/src/, themes/builtin/, tests/
User config:          ~/.config/publisher/
User data:            ~/.local/share/publisher/
  workspace/          Article library (articles, assets, builds)
  themes/             Custom CSS themes
  backups/            Configuration backups
Cache:                ~/.cache/publisher/
  formulas/           MathJax SVG formula cache (by content hash)
```

Updates change application code only. User data survives indefinitely.

## Dependencies

| Package | Purpose |
|---------|---------|
| markdown-it + plugins | Markdown parser |
| katex | Preview math rendering |
| mathjax-full | Publishing math (SVG) |
| highlight.js | Syntax highlighting |
| juice | CSS inlining |
| sharp | SVG→PNG conversion |
| commander | CLI framework |
| vite / vitest | Dev server, test framework |
