# Installation

## Requirements

- Node.js >= 18
- npm
- git (for updates)

## Quick Install

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

## Manual Install

```bash
git clone git@github.com:ouyang-matters/mdtex_pipeline.git
cd mdtex_pipeline
npm install
npx vite build
node src/cli/index.js init
```

## Verify Installation

```bash
publisher doctor
```

## Start the UI

```bash
cd /path/to/mdtex_pipeline
npm run dev
# Open http://localhost:3000
```

## What Gets Created

### Application (inside the git checkout)
```
src/             Application source code
themes/builtin/  Built-in CSS themes
tests/           Tests and fixtures
scripts/         Utility scripts
```

### User Configuration (`~/.config/publisher/`)
```
config.json       General configuration
preferences.json  Editor preferences
platforms.json    Platform settings
secrets.env       API credentials (never committed)
```

### User Data (`~/.local/share/publisher/`)
```
themes/     Custom CSS themes
workspace/  Article workspace
history/    Export history
assets/     Generated assets
presets/    User presets
backups/    Configuration backups
```

### Cache (`~/.cache/publisher/`)
```
rendered/   Rendered HTML cache
images/     Image cache
```
