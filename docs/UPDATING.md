# Updating

MDTeX updates by pulling the git checkout it runs from. `publisher update` does
that safely; `publisher start` only tells you when there is something to pull.

---

## The check on start

`publisher start` asks the remote whether its branch has moved on, after the
server is up and the browser is opening. It never delays the launch, and it
never modifies the checkout: the question is asked with `git ls-remote`, which
reads the remote's refs and writes nothing locally — no fetch, no ref update,
no objects.

The cost of that restraint is precision. Without the remote's objects the check
can see that the commit differs, not how far behind you are or what changed, so
it reports "a newer version is available" and never a commit count that nobody
verified.

```text
┌───────────────────────────────────────────────────┐
│ A newer version is available                      │
│ installed  a431c7f  →  9f2c1de  on origin/main    │
│                                                   │
│ Update with  publisher update                     │
│ Turn this check off:  publisher update --auto off │
└───────────────────────────────────────────────────┘
```

Only that outcome is printed. Being up to date is the expected case and says
nothing worth interrupting for, and a check that could not run says nothing
either — "the remote could not be reached" is not news to someone who is
offline.

The answer is remembered for 24 hours in `~/.config/publisher/update-check.json`,
so a launch does not always make a network request. The cache records which
commit it was about, so after an update the previous answer is discarded rather
than repeated.

### Asking explicitly

```bash
publisher update --check
```

Reports every outcome, because you asked: up to date, an update available, or
the reason the check could not run. Changes nothing either way, and an
unreachable remote is not an error exit — being offline is not a failure of
this command.

### Turning it off

```bash
publisher update --auto off      # stop checking on start
publisher update --auto on       # start again
publisher start --no-update-check   # skip it once, without changing the setting
```

The setting is `update_check` in `~/.config/publisher/config.json`. With it off,
no network request is made at launch at all.

---

> **Updating MDTeX changes the application, not your workspace.**
>
> Articles, folders, images, LaTeX projects, themes, snippets, metadata,
> AI profiles, preferences and secrets all live outside the application
> directory and are never replaced, reset or deleted by an update. You never
> need to back them up by hand before updating.
>
> See [DATA_LAYOUT.md](DATA_LAYOUT.md) for the full classification.

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
2. **Refuses to continue if any user data sits where an update would replace it** —
   before git is touched, because once `git pull` has started there is no safe
   way to discover that articles were in the checkout
3. Migrates any data still in a legacy location out to the persistent root
4. Takes a census of every protected location, to compare against afterwards
5. Checks for uncommitted changes in the app source (aborts if dirty)
6. Backs up user config, themes, and presets
7. Runs `git pull --ff-only` **in the application checkout only**
8. Runs `npm install`
9. Runs config schema migrations — merging new settings, never replacing values
10. Rebuilds the UI
11. Runs rendering self-tests
12. Re-counts the protected locations and **fails if anything shrank**

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

  Article workspace        1284 file(s)  412.7 MB
  User themes                 4 file(s)   18.2 KB
  User snippets              11 file(s)    4.1 KB
  Presets                     2 file(s)    1.0 KB
  Publication history         1 file(s)   88.4 KB
  Backups                    36 file(s)    2.2 MB
  Configuration               5 file(s)    6.7 KB

✓ User data intact: nothing was removed or replaced.
✓ Application updated
✓ UI rebuilt
```

Those counts are measured, not asserted. If any protected location has fewer
files or bytes after the update than before, the update reports failure and
points at the pre-update backup.

## What Gets Updated

- Application source code (via git pull)
- npm dependencies
- Built-in themes (in `themes/builtin/`)
- Web UI build

## What Is Never Touched

Everything below survives every update unchanged, unless an explicit schema
migration is required — and a migration adds fields, it does not replace values:

- Articles, folders and nested folder structure
- Article metadata, tags and series/column metadata
- Markdown and LaTeX sources
- Imported images and article assets
- Bibliography files, custom `.sty`, `.cls` and project-local files
- Custom CSS themes, including your version of a built-in theme's name
- Custom snippets and templates
- The article library index and saved workspace state
- AI connection profiles and Remote ClaudeClaw configuration
- User preferences, publication settings, Blog Pipeline configuration
- Publication and build history
- Secrets and credentials
- Backups

On Linux these live in `~/.config/publisher/` and `~/.local/share/publisher/`;
on Windows in `%LOCALAPPDATA%\MDTeX\config\` and `%LOCALAPPDATA%\MDTeX\data\`.
Neither is inside the application directory, which is what makes the guarantee
structural rather than a matter of the updater being careful.

## What an update may replace

- Application source code (via `git pull` in the checkout)
- npm dependencies
- Built-in themes in `themes/builtin/` and built-in PDF templates
- The web UI bundle in `dist/ui/`

## How updating is *not* implemented

An update never deletes the installation directory and re-clones it. That
pattern is safe only until someone's articles are in that directory, and it
fails silently and completely when they are. `git pull`, checkout and reset run
against the application checkout and nothing else; the workspace is never a git
working tree.

If you want to see this demonstrated rather than promised:

```bash
npm run check:data-safety
```

That script performs the update as delete-the-whole-installation-and-reinstall,
then verifies every category of user data byte for byte.

## Checking before you update

```bash
publisher preflight     # is any user data at risk?
publisher doctor        # full report, including legacy locations
```

`preflight` exits non-zero if user data is stored where an update would replace
it, and both installers run it before `git pull`.

## Migrating from an older layout

If an older installation kept articles or themes inside the application
directory, or used the pre-split Windows root (`%LOCALAPPDATA%\publisher\`),
they are migrated automatically on the next `init`, `update` or installer run.

The migration copies, verifies, records where the data came from, and **leaves
the original in place**. Nothing is overwritten: a conflicting file is kept
alongside under a content-stamped name rather than discarded. Re-running it does
nothing, because everything is already there.

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
