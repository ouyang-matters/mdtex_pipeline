# Installation

## Requirements

- Node.js >= 18
- npm
- git (for updates)

## Linux / macOS

```bash
git clone git@github.com:ouyang-matters/mdtex_pipeline.git
cd mdtex_pipeline
./install.sh
```

The installer will:

1. Detect your OS and verify Node.js/npm versions
2. Install npm dependencies
3. Build the web UI
4. Initialize user directories and default configuration
5. Install the `publisher` CLI command to `~/.local/bin/`
6. Run a self-test
7. Print the command to start the UI

If `~/.local/bin` is not in your PATH, add to your shell profile:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

## Windows (PowerShell)

```powershell
git clone git@github.com:ouyang-matters/mdtex_pipeline.git
cd mdtex_pipeline
.\install.ps1
```

Or install manually:

```powershell
git clone git@github.com:ouyang-matters/mdtex_pipeline.git
cd mdtex_pipeline
npm install
npx vite build
node src/cli/index.js init
```

On Windows, use `node src/cli/index.js` instead of `publisher`:

```powershell
node src/cli/index.js build article.md --target wechat
node src/cli/index.js doctor
node src/cli/index.js version
```

To update on Windows, run the installer again (it pulls and rebuilds):

```powershell
cd C:\path\to\mdtex_pipeline
.\install.ps1
```

## Manual Install (any platform)

```bash
git clone git@github.com:ouyang-matters/mdtex_pipeline.git
cd mdtex_pipeline
npm install
npx vite build
node src/cli/index.js init
```

## Verify Installation

```bash
node src/cli/index.js doctor
```

## Start the UI

```bash
cd /path/to/mdtex_pipeline
npm run dev
# Open http://localhost:3000
```

## Troubleshooting

### VS Code terminal shows unexpected logs

If you see messages like `StorageMainService`, `AgentHostProcessManager`, or `Unknown channel: agentHostClientProxy` — these come from **VS Code itself**, not from this project. This project does not launch VS Code or any Electron process.

To avoid this, run commands from a **standalone terminal** (PowerShell, Terminal.app, or a regular terminal emulator) rather than VS Code's integrated terminal. VS Code's integrated terminal sometimes inherits its own process output.

## What Gets Created

### Application (inside the git checkout)
```
src/             Application source code
themes/builtin/  Built-in CSS themes
tests/           Tests and fixtures
scripts/         Utility scripts
```

### User Configuration
```
~/.config/publisher/          (Linux/macOS)
%LOCALAPPDATA%\publisher\     (Windows, via XDG_CONFIG_HOME or fallback)

config.json       General configuration
preferences.json  Editor preferences
platforms.json    Platform settings
secrets.env       API credentials (never committed)
```

### User Data
```
~/.local/share/publisher/     (Linux/macOS)

themes/     Custom CSS themes
workspace/  Article workspace
history/    Export history
assets/     Generated assets
presets/    User presets
backups/    Configuration backups
```

### Cache
```
~/.cache/publisher/           (Linux/macOS)

rendered/   Rendered HTML cache
images/     Image cache
formulas/   Cached formula SVG/PNG assets
```
