# Migrations

## Overview

Configuration and data schemas are versioned. When the application updates, migrations bring existing user config to the current schema without losing data.

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
