# Data Layout

> **Updating MDTeX changes the application, not the user's workspace.**

That is the invariant this document exists to describe, and `src/core/data-model.js`
exists to enforce. Everything MDTeX touches falls into exactly one of five
categories, and only two of them may ever be replaced by an update:

| Category | Example | May an update replace it? |
| --- | --- | --- |
| Application code | `src/`, `dist/ui/`, `node_modules/` | **Yes** — replaced wholesale |
| Built-in resources | `themes/builtin/`, PDF templates | **Yes** — replaced wholesale |
| User configuration | preferences, AI profiles, secrets | No — merged, never replaced |
| Persistent user data | articles, assets, user themes, history | **Never touched** |
| Cache | rendered HTML, processed images, PDF scratch | Regenerable; safe to delete |

A user can accumulate years of articles, LaTeX projects, images, themes,
metadata and AI configuration, update MDTeX repeatedly, and never back anything
up by hand.

## What counts as persistent user data

All of it survives every update unchanged, unless an explicit schema migration
is required:

articles · folders and nested folder structure · article metadata · Markdown and
LaTeX sources · imported images and article assets · bibliography files · custom
`.sty`, `.cls`, `.bib` and project-local files · custom CSS themes · custom
snippets and templates · the article library index · tags and series metadata ·
AI connection profiles · Remote ClaudeClaw configuration · user preferences ·
publication settings · Blog Pipeline configuration · saved workspace state ·
build history · secrets and credentials

Note what is *not* cache: article assets, user PDF sources, custom templates and
user configuration are never treated as regenerable, even when they sit next to
generated output. An article's `dist/` build directory is regenerable, but it
lives inside the article, and nothing deletes it during an update.

## Directories

### Application Code (git checkout)

```
<repo>/
  src/               Source code
  themes/builtin/    Built-in themes (updated with app)
  tests/             Tests and fixtures
  scripts/           Utility scripts
  dist/ui/           Built web UI
  node_modules/      Dependencies
```

This directory is managed by git and npm. Updates replace its contents — which
is exactly why no user data may live here. `publisher preflight` refuses to let
an update proceed while any does, and both installers run it before `git pull`.

### User Configuration

```
~/.config/publisher/
  config.json        General config (default theme, platform, output dir)
  preferences.json   Editor preferences (font size, tab size, dark mode)
  platforms.json     Platform settings, publication and Blog Pipeline config
  ai.json            AI connection profiles (Local, Remote ClaudeClaw, API)
  secrets.env        API credentials (AppID, AppSecret, tokens)
```

Follows the XDG Base Directory Specification. Respects `$XDG_CONFIG_HOME`.

### Persistent User Data

```
~/.local/share/publisher/
  themes/            Custom CSS themes (user-created or customised)
  workspace/         Article workspace — articles, folders, assets, LaTeX projects
  snippets/          User snippets and templates
  history/           Publication history
  assets/            Assets not owned by a single article
  presets/           Saved compilation presets
  backups/           Automatic and manual backups
```

Respects `$XDG_DATA_HOME`.

### Windows

The same logical model, in the locations Windows expects:

```
%LOCALAPPDATA%\MDTeX\
  config\           Same contents as ~/.config/publisher/
  data\             Same contents as ~/.local/share/publisher/
  cache\            Same contents as ~/.cache/publisher/
```

Three separate roots, as on Linux. An earlier layout put configuration and user
data together in `%LOCALAPPDATA%\publisher\`, so "config" and "data" were the
same directory — a distinction Linux had and Windows did not. Data in the old
location is migrated automatically and non-destructively; see *Migration* below.

The cache is deliberately **not** under `%TEMP%`: cleanup tools empty that
directory, including while the application is running.

### Overriding the roots

`MDTEX_CONFIG_HOME`, `MDTEX_DATA_HOME` and `MDTEX_CACHE_HOME` each name a root
directly, on every platform. They take precedence over the XDG variables and are
what the test suite uses to exercise a full installation in a sandbox.

### Cache

```
~/.cache/publisher/
  rendered/          Rendered HTML cache
  images/            Processed image cache
```

Respects `$XDG_CACHE_HOME`. Safe to delete; will be regenerated.

## Theme Resolution Order

When loading a theme by name:

1. Absolute/relative file path (if file exists)
2. User themes (`~/.local/share/publisher/themes/<name>.css`)
3. Built-in themes (`<repo>/themes/builtin/<name>.css`)

User themes with the same name as a built-in theme take priority, and the two
live in different roots. An update replaces `themes/builtin/default.css`; a user's
own `default.css` is in the data root, is never seen by that replacement, and
continues to win at resolution time.

## Configuration Schema Versioning

Each config file contains a `config_version` field:

```json
{
  "config_version": 1,
  "default_theme": "default",
  ...
}
```

During updates, the migration system:
- Adds new keys with default values
- Preserves existing user values
- Preserves unknown keys (forward compatibility)
- Increments the version number
- Backs up config before migration

## Secrets

`secrets.env` stores sensitive credentials:

```env
# Never commit this file
WECHAT_APP_ID=
WECHAT_APP_SECRET=
```

Rules:
- Never printed in logs
- Never committed to git
- Backed up during updates (to local backup only)
- Never overwritten by init or update
- Migrated without exposing values

## Migration out of legacy locations

Data found in a legacy location — articles inside the git checkout, or the
pre-split Windows root — is moved to the persistent root by `publisher preflight`,
which runs from `publisher init`, `publisher update` and both installers **before
git touches the checkout**.

The procedure never destroys anything:

```
detect old data
  -> copy into the persistent data root
  -> verify the copy landed
  -> record where it came from (migrated-from.json)
  -> leave the original in place
```

The original is never deleted. Nothing is ever overwritten: a file already at the
destination with identical content is skipped, and one with *different* content
is copied alongside under a content-stamped name (`default.migrated-e0c70b4a.css`)
and reported as a conflict. Duplicate and conflicting files are never silently
discarded.

Running it again is a no-op — everything is already present, so nothing is copied.

## Backup Structure

```
~/.local/share/publisher/backups/<timestamp>_<label>/
  manifest.json      Backup metadata
  config.json        Config snapshot
  preferences.json   Preferences snapshot
  platforms.json     Platform settings snapshot
  secrets.env        Secrets snapshot
  themes/            User themes snapshot
  presets/            Presets snapshot
```

Backups do not include the workspace, assets, or cache: they are too large, and
an update does not change them. The workspace is protected by being in a
different root, not by being copied — and `publisher update` proves it, by taking
a census of every protected location before and after and refusing to report
success if any of it shrank.

## Verifying the invariant

```bash
publisher preflight            # is any user data at risk right now?
publisher doctor               # full report, including legacy locations
npm run check:data-safety      # delete the installation, reinstall, prove data survived
npx vitest run tests/data-safety.test.js
```

`scripts/update-safety-check.js` performs the update as the *worst* plausible
implementation — deleting the whole installation directory and replacing it —
and then checks every category of user data byte for byte. It is the answer to
"how do you know?", rather than an assurance that it ought to work.
