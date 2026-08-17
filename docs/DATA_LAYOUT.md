# Data Layout

The application separates code, configuration, persistent data, and cache into distinct locations. Updating application code never touches user data.

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

This directory is managed by git and npm. Updates replace its contents.

### User Configuration

```
~/.config/publisher/
  config.json        General config (default theme, platform, output dir)
  preferences.json   Editor preferences (font size, tab size, dark mode)
  platforms.json     Platform-specific settings
  secrets.env        API credentials (AppID, AppSecret, tokens)
```

Follows XDG Base Directory Specification. Respects `$XDG_CONFIG_HOME`.

### Persistent User Data

```
~/.local/share/publisher/
  themes/            Custom CSS themes (user-created or copied)
  workspace/         Article workspace
  history/           Export history
  assets/            User assets (images, etc.)
  presets/           Saved compilation presets
  backups/           Automatic and manual backups
```

Respects `$XDG_DATA_HOME`.

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

User themes with the same name as a built-in theme take priority. This allows users to customize a built-in theme without it being overwritten by updates.

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

Backups do not include the workspace, assets, or cache (too large, and they don't change during updates).
