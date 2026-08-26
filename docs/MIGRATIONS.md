# Migrations

## Overview

Configuration and data schemas are versioned. When the application updates,
migrations bring existing user data to the current schema without losing any of
it. There are three kinds, and all three are additive:

| Kind | What it migrates | Where |
| --- | --- | --- |
| Config schema | `config.json`, `preferences.json`, `platforms.json` | `src/core/config/index.js` |
| Article metadata | `article.json` fields | `src/workspace/article.js` |
| Data location | data in a legacy directory | `src/core/migrate/data.js` |

**Default configuration files are templates, not the source of truth.** Shipping
a new default never replaces a value the user has set. A new required setting is
added by merge; existing values and unknown custom keys are left exactly as they
were.

## Config Schema

Current version: **1**

Each config file has a `config_version` field. Migrations run automatically during `publisher update` and can be triggered manually:

```bash
publisher update  # includes migration
```

## Migration Principles

1. **Additive**: New keys are added with defaults; existing keys are never removed
2. **Non-destructive**: User values are never overwritten with defaults
3. **Preserving**: Unknown keys (from newer versions or user additions) are kept
4. **Backed up**: Config is backed up before any migration runs
5. **Idempotent**: Running the same migration twice produces the same result
6. **Sequential**: Migrations run in order (v0→v1→v2→...)

## Migration Files

```
migrations/
  001_initial.js      Baseline schema
  002_*.js            Future migrations
```

Each migration exports:

```js
export const version = 1;
export const description = 'Initial schema setup';

export function up(config) {
  // Add new keys, transform values
  return config;
}

export function down(config) {
  // Reverse the migration (best effort)
  return config;
}
```

## What Happens During Migration

```
1. Load current config
2. Read config_version (default 0 if missing)
3. If version < current schema:
   a. Back up all config files
   b. Run each migration in sequence
   c. Add any missing default keys
   d. Preserve all existing user values
   e. Preserve all unknown keys
   f. Update config_version
   g. Save config
4. Report changes
```

## Example Migration Output

```
Running config migrations...
  Config migrated: v0 -> v1
    Added config key: output_dir
    Added preference: preview_auto_scroll
```

## Article Metadata

Two mechanisms keep `article.json` safe across versions.

**Unknown fields are carried through.** `Article` records every key it does not
recognise and writes it back out on save. Opening an article written by a newer
MDTeX — or one a user added a field to by hand — and then renaming it does not
drop the field. Without this, an ordinary edit would lose data, no upgrade
required.

**Identity is immutable.** `EDITABLE_FIELDS` and `IMMUTABLE_FIELDS` in
`src/workspace/article.js` are the enforcement point: `applyMetadata` ignores
identity fields in a patch rather than applying them, and returns what it
ignored. A metadata upgrade may add fields, but nothing may change or
regenerate:

- the article ID
- its path on disk, folder, or position in the folder tree
- its source content
- its assets
- existing metadata values — tags, series, author, dates

Adding a field means giving it a default for articles that predate it, and
leaving every other byte of `article.json` alone. Anything that cannot be done
additively is not a migration; it is a new field alongside the old one.

## Data Location

Data found in a legacy location — articles inside the git checkout, or the
pre-split Windows root — is migrated by `publisher preflight`, which runs from
`init`, `update` and both installers before git touches the checkout.

```
detect old data
  -> copy into the persistent data root
  -> verify the copy landed
  -> record the source in migrated-from.json
  -> leave the original in place
```

Unlike a config migration, this one never deletes and never overwrites:

- A destination file with identical content is skipped.
- A destination file with *different* content is kept, and the incoming version
  is written alongside it as `<name>.migrated-<hash>.<ext>`, then reported as a
  conflict. Duplicates and conflicts are never silently discarded.
- The original directory is left untouched, whether the migration succeeded or
  not. Deleting it is the user's decision, not the installer's.

Re-running does nothing: everything is already at the destination.

See [DATA_LAYOUT.md](DATA_LAYOUT.md) for the locations involved.

## Failed Migrations

If a migration fails:
- The error is reported
- The backup remains available
- The partially-migrated config is not saved
- The user can restore from backup:
  ```bash
  publisher backups list
  publisher backups restore <backup-name>
  ```
