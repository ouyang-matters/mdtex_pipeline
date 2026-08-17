#!/usr/bin/env bash
set -euo pipefail

# ── MDTeX Pipeline Installer ───────────────────────────────────────────────────
# Installs the publisher CLI and initializes user directories.
# Safe to run multiple times (idempotent).

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_NAME="publisher"
MIN_NODE_MAJOR=18

red()    { printf '\033[0;31m%s\033[0m\n' "$*"; }
green()  { printf '\033[0;32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[0;33m%s\033[0m\n' "$*"; }
bold()   { printf '\033[1m%s\033[0m\n' "$*"; }

echo ""
bold "MDTeX Pipeline Installer"
echo "========================"
echo ""

# ── 1. Detect OS ───────────────────────────────────────────────────────────────

OS="$(uname -s)"
case "$OS" in
  Linux*)  PLATFORM="linux";;
  Darwin*) PLATFORM="macos";;
  *)       red "Unsupported OS: $OS"; exit 1;;
esac
echo "Platform: $PLATFORM"

# ── 2. Check Node.js ──────────────────────────────────────────────────────────

if ! command -v node &>/dev/null; then
  red "Error: Node.js is not installed."
  echo "Install Node.js >= $MIN_NODE_MAJOR from https://nodejs.org/"
  exit 1
fi

NODE_VERSION="$(node -v)"
NODE_MAJOR="$(echo "$NODE_VERSION" | sed 's/v\([0-9]*\).*/\1/')"
if [ "$NODE_MAJOR" -lt "$MIN_NODE_MAJOR" ]; then
  red "Error: Node.js $NODE_VERSION is too old. Need >= v$MIN_NODE_MAJOR."
  exit 1
fi
echo "Node.js: $NODE_VERSION"

# ── 3. Check npm ──────────────────────────────────────────────────────────────

if ! command -v npm &>/dev/null; then
  red "Error: npm is not installed."
  exit 1
fi
echo "npm: $(npm -v)"

# ── 4. Check git ──────────────────────────────────────────────────────────────

if ! command -v git &>/dev/null; then
  yellow "Warning: git not found. Update command will not work."
else
  echo "git: $(git --version | head -1)"
fi

echo ""

# ── 5. Install dependencies ──────────────────────────────────────────────────

bold "Installing dependencies..."
cd "$SCRIPT_DIR"
npm install --no-audit --no-fund 2>&1 | tail -3
echo ""

# ── 6. Build UI ───────────────────────────────────────────────────────────────

bold "Building UI..."
npx vite build 2>&1 | grep -E '(built in|✓)' || true
echo ""

# ── 7. Initialize user directories ───────────────────────────────────────────

bold "Initializing user directories..."
node src/cli/index.js init
echo ""

# ── 8. Install CLI command ────────────────────────────────────────────────────

bold "Setting up CLI..."

# Create a wrapper script in a user-accessible bin directory
USER_BIN=""
if [ -d "$HOME/.local/bin" ]; then
  USER_BIN="$HOME/.local/bin"
elif [ -d "$HOME/bin" ]; then
  USER_BIN="$HOME/bin"
else
  mkdir -p "$HOME/.local/bin"
  USER_BIN="$HOME/.local/bin"
fi

WRAPPER="$USER_BIN/$APP_NAME"
cat > "$WRAPPER" << WRAPPER_EOF
#!/usr/bin/env bash
exec node "$SCRIPT_DIR/src/cli/index.js" "\$@"
WRAPPER_EOF
chmod +x "$WRAPPER"
echo "CLI installed: $WRAPPER"

# Check if it's in PATH
if ! echo "$PATH" | tr ':' '\n' | grep -qx "$USER_BIN"; then
  yellow "Note: $USER_BIN is not in your PATH."
  echo "Add this to your shell profile (~/.bashrc or ~/.zshrc):"
  echo ""
  echo "  export PATH=\"$USER_BIN:\$PATH\""
  echo ""
fi

# ── 9. Run self-test ─────────────────────────────────────────────────────────

echo ""
bold "Running self-test..."
if node "$SCRIPT_DIR/scripts/selftest.js"; then
  echo ""
  green "Self-test passed."
else
  echo ""
  yellow "Warning: Some self-tests failed. Run 'publisher doctor' for details."
fi

# ── 10. Done ──────────────────────────────────────────────────────────────────

echo ""
bold "Installation complete!"
echo ""
echo "Start the UI:"
echo "  cd $SCRIPT_DIR && npm run dev"
echo ""
echo "Or use the CLI:"
echo "  publisher build article.md --target wechat"
echo "  publisher themes list"
echo "  publisher doctor"
echo "  publisher version"
echo ""
echo "Configuration:  ~/.config/$APP_NAME/"
echo "User themes:    ~/.local/share/$APP_NAME/themes/"
echo "Workspace:      ~/.local/share/$APP_NAME/workspace/"
echo ""
