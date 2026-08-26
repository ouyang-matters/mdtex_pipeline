# Updating

## Quick Update

```bash
publisher update
```

The same command on Windows and Linux. Re-running the installer for your
platform (`./install.sh` or `.\install.ps1`) does the same work and is equally
safe — it also refreshes the `publisher` command itself, which `publisher
update` does not.

This command:

1. Detects the current version
2. Checks for uncommitted changes in the app source (aborts if dirty)
3. Backs up user config, themes, and presets
4. Runs `git pull --ff-only`
5. Runs `npm install`
6. Runs config schema migrations
7. Rebuilds the UI
8. Runs rendering self-tests
9. Reports the result

Example output:

```
Publisher 0.1.0

Backing up user data...
  Backup: ~/.local/share/publisher/backups/2026-08-17T09-47-38_pre-update

Fetching updates...
Updating dependencies...
Running config migrations...
  No migration needed.
Rebuilding UI...
Running self-tests...
  ✓ Markdown parser
  ✓ KaTeX renderer
  ✓ CSS inliner (juice)
  ...

Publisher 0.1.0 -> 0.2.0

✓ User workspace preserved
✓ 4 custom theme(s) preserved
✓ Preferences preserved
✓ Secrets preserved
✓ Built-in themes updated
✓ UI rebuilt
```

## What Gets Updated

- Application source code (via git pull)
- npm dependencies
- Built-in themes (in `themes/builtin/`)
- Web UI build

## What Is Never Touched

- User config (`~/.config/publisher/`)
- Custom themes (`~/.local/share/publisher/themes/`)
- Workspace and articles (`~/.local/share/publisher/workspace/`)
- Secrets (`~/.config/publisher/secrets.env`)
- Assets and cache
- Backups

## Dirty Checkout

If you've modified application source files, the update will abort:

```
Error: Application source has uncommitted changes:

 M src/core/renderer/index.js

Use --force to update anyway, or commit/stash your changes first.
```

Use `--force` only if you're sure:

```bash
publisher update --force
```

## Rollback

If an update breaks something, restore from the automatic backup:

```bash
publisher backups list
publisher backups restore 2026-08-17T09-47-38_pre-update
```

Then revert the git checkout:

```bash
cd /path/to/mdtex_pipeline
git log --oneline -5    # find the previous commit
git checkout <commit>
npm install
npx vite build
```

## Manual Update

```bash
cd /path/to/mdtex_pipeline
git pull
npm install
npx vite build
publisher doctor
```
