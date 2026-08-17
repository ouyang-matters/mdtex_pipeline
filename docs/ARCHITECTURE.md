# Architecture

## Overview

mdtex-pipeline is a local-first publishing compiler that converts Markdown + LaTeX source into platform-ready rich text for WeChat Official Accounts and Zhihu.

## Pipeline

```
Markdown source (.md file)
    │
    ▼
┌─────────────────────────┐
│  markdown-it parser      │  Plugins: footnotes, texmath (KaTeX), GFM
│  + custom renderers      │  Code blocks: highlight.js
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│  Scoped HTML             │  Wrapped in <div id="nice">...</div>
│  (internal document)     │  Math: KaTeX HTML+MathML
│                          │  Code: highlight.js spans
└────────────┬────────────┘
             │
    ┌────────┴────────┐
    │                 │
    ▼                 ▼
┌─────────┐    ┌──────────┐
│  Theme   │    │  Images  │  Extract, resolve, validate
│  CSS     │    │  extract │
└────┬────┘    └──────────┘
     │
     ▼
┌─────────────────────────┐
│  Platform adapter        │  WeChat: transform, override CSS
│  (wechat | zhihu)        │  Zhihu: transform, override CSS
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│  CSS inliner (juice)     │  Resolve variables, compute specificity,
│                          │  inline all styles, strip <style> tags
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│  Sanitizer               │  Remove scripts, iframes, event handlers
│  (platform-specific)     │  WeChat: strip classes/IDs
│                          │  Zhihu: strip IDs, keep classes
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│  Validator               │  Count elements, check math errors,
│                          │  verify images, detect unsafe HTML
└────────────┬────────────┘
             │
     ┌───────┴───────┐
     │               │
     ▼               ▼
  Preview        Copy/Export
  (browser)      (clipboard/file)
```

## Module Structure

```
src/
  core/
    parser/         markdown-it configuration + plugins
    renderer/       HTML generation scoped under #nice
    math/           MathNode abstraction, KaTeX rendering
    code/           highlight.js code block rendering
    images/         ImageNode, extraction, resolution, uploader interface
    themes/         Theme loading, listing, CSS variable resolution
    compiler/       Pipeline orchestration, CSS inlining (juice), validation

  platforms/
    base.js         PlatformAdapter interface
    wechat/         WeChat-specific transforms and sanitization
    zhihu/          Zhihu-specific transforms and sanitization

  ui/              Browser-side rendering (Vite app)
  cli/             Commander-based CLI

themes/            CSS theme files (default.css, academic-orange.css, ...)
tests/             Vitest test suites and fixtures
docs/              Documentation
```

## Key Design Decisions

### One Core Renderer, Thin Adapters

The markdown-it parser and renderer are shared. Platform adapters only:
1. Apply platform-specific HTML transforms (e.g., div→section for WeChat)
2. Provide CSS overrides (e.g., mobile max-width)
3. Sanitize output (remove elements/attributes that won't survive)
4. Validate against platform constraints

### CSS Theme Scoping

All themes scope under `#nice` (compatible with the mdnice theme ecosystem). The compiler:
1. Renders HTML inside `<div id="nice">`
2. Loads a theme CSS file
3. Resolves CSS variables
4. Appends platform CSS overrides
5. Inlines everything with juice
6. Strips leftover `<style>`, classes, IDs

### Math Strategy

Phase 1 uses KaTeX HTML output. The `MathNode` abstraction stores `sourceLatex`, `displayMode`, `renderedHtml`, and `renderedSvg` fields, so Phase 2 can switch to SVG rendering (like doocs/md's MathJax tex2svg approach) if KaTeX HTML proves unreliable on WeChat.

### Image Abstraction

`ImageNode` classifies images as local/remote, resolves paths, and flags images needing upload. The `ImageUploader` interface enables Phase 2 upload backends without changing the renderer.

### Browser vs Server Rendering

- **Preview** (browser): Renders markdown and injects theme CSS via `<style>` tag for speed. No juice needed for live preview.
- **Copy/Export** (browser): Uses DOM-based CSS inlining (DOMParser + getComputedStyle). Sanitizes per platform.
- **CLI Build** (server): Uses juice for precise CSS inlining. Full validation pass.

## Dependencies

| Package | Purpose | License |
|---------|---------|---------|
| markdown-it | Markdown parser | MIT |
| markdown-it-footnote | Footnote support | MIT |
| markdown-it-texmath | LaTeX delimiters ($, $$) | MIT |
| katex | Math rendering | MIT |
| highlight.js | Syntax highlighting | BSD-3 |
| juice | CSS inlining | MIT |
| commander | CLI framework | MIT |
| vite | Dev server & build | MIT |
| vitest | Test framework | MIT |
