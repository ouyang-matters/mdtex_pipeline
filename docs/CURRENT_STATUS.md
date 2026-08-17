# Current Status

## Installation

```bash
git clone git@github.com:ouyang-matters/mdtex_pipeline.git
cd mdtex_pipeline
./install.sh
```

## Update

```bash
publisher update
```

## Start the UI

```bash
cd /path/to/mdtex_pipeline && npm run dev
# Open http://localhost:3000
```

## Persistent Data Locations

| Category | Path |
|----------|------|
| Config | `~/.config/publisher/config.json` |
| Preferences | `~/.config/publisher/preferences.json` |
| Platform settings | `~/.config/publisher/platforms.json` |
| Secrets | `~/.config/publisher/secrets.env` |
| User themes | `~/.local/share/publisher/themes/` |
| Workspace | `~/.local/share/publisher/workspace/` |
| Backups | `~/.local/share/publisher/backups/` |
| Assets | `~/.local/share/publisher/assets/` |
| Cache | `~/.cache/publisher/` |

All paths respect XDG Base Directory Specification (`$XDG_CONFIG_HOME`, `$XDG_DATA_HOME`, `$XDG_CACHE_HOME`).

## Migration Behavior

- Config schema version: **1**
- Data schema version: **1**
- Migrations add new keys with defaults, never remove existing keys
- Unknown user keys are preserved
- Config is backed up before migration
- Migration files in `migrations/` directory

## Backup Behavior

- Automatic backup before each update (`pre-update` label)
- Manual backups via `publisher backups create`
- Backups include: config, preferences, platforms, secrets, user themes, presets
- Backups exclude: workspace, assets, cache (too large, unchanged by updates)
- Restore via `publisher backups restore <name>`

## Tested Upgrade Path

| Scenario | Status |
|----------|--------|
| Clean installation | Tested |
| Running installer twice | Tested (idempotent) |
| Repeated `init` | Tested (preserves existing config) |
| Upgrade with custom themes | Tested (user themes untouched) |
| Upgrade with modified preferences | Tested (preferences preserved) |
| Upgrade with stored secrets | Tested (secrets preserved) |
| Upgrade with workspace files | Tested (workspace preserved) |
| Upgrade with generated cache | Tested (cache preserved) |
| Config schema migration | Tested (v0→v1) |
| Overlapping theme names | Tested (user theme takes priority) |
| Unknown config keys | Tested (preserved through migration) |
| Rendering fixture after upgrade | Tested (selftest) |
| Dirty git checkout | Tested (aborts with message, --force available) |

## Math Rendering

Formulas are rendered using a dual-renderer architecture:

- **Preview**: KaTeX HTML (fast, selectable, for live editing)
- **Publish**: MathJax SVG (self-contained `<path>` elements, no CSS dependency)

Publishing output modes: `--math svg` (default), `--math png` (3x resolution), `--math auto`.

Formula assets are cached by content hash in `~/.cache/publisher/formulas/`.

Formula count validation: source formula count must match rendered formula count — any mismatch fails the build.

## Known Limitations

1. `publisher update` requires a git checkout (won't work from downloaded archive)
2. The web UI loads themes from `themes/builtin/` at build time; user themes from `~/.local/share/publisher/themes/` are only available via CLI
3. SVG data URIs may not render in all WeChat versions; use `--math png` as fallback
4. Formula images are data URIs — large math-heavy articles produce large HTML. Phase 2 can upload formula images to WeChat CDN
5. WeChat content images must be uploaded to WeChat CDN manually (Phase 2 will add API upload)
6. The `publisher` CLI wrapper is installed to `~/.local/bin/` which may not be in PATH on all systems

## CLI Commands

| Command | Description |
|---------|-------------|
| `publisher build <file>` | Compile Markdown for a target platform |
| `publisher validate <file>` | Validate without compiling |
| `publisher preview [file]` | Show how to start the preview UI |
| `publisher themes list` | List all themes (builtin + user) |
| `publisher themes copy <src> <dst>` | Copy a theme to user themes |
| `publisher init` | Initialize user directories (idempotent) |
| `publisher version` | Show version and schema info |
| `publisher doctor` | Full health check with rendering tests |
| `publisher update` | Safe in-place update |
| `publisher backups list` | List all backups |
| `publisher backups create` | Create a manual backup |
| `publisher backups restore <name>` | Restore from backup |
