# AI Backends

MDTeX supports AI-assisted editing through a pluggable backend system.

## Architecture

```
Editor UI
    │
    ▼
AIBackend interface
    ├── LocalClaudeCodeBackend (installed Claude Code CLI)
    ├── RemoteClaudeClawBackend (remote worker via HTTP/SSH)
    └── (future) AnthropicAPIBackend
```

## Backend Interface

All backends implement:

```js
class AIBackend {
  async isAvailable()    // Check if backend is reachable
  async execute(request) // Send prompt, receive edits
}
```

### Request

```js
{
  prompt: "Change the h2 style to use a left border",
  articleSource: "# Title\n...",
  themeCss: "#nice h2 { ... }",
  targetScope: "content" | "theme" | "metadata",
  context: { ... }
}
```

### Response

```js
{
  success: true,
  edits: [
    { file: "article", content: "modified content" },
    { file: "theme", content: "modified CSS" },
  ],
  message: "Claude's response"
}
```

## Scope Constraints

- `targetScope: "content"` — AI edits only the article source
- `targetScope: "theme"` — AI edits only the CSS theme
- `targetScope: "metadata"` — AI edits only article metadata

This prevents accidental cross-contamination (e.g., asking to fix a style
shouldn't rewrite the article prose).

## LocalClaudeCodeBackend

Uses the locally installed, already-authenticated Claude Code CLI.
No API keys needed — relies on existing Claude Code authentication.

```bash
# Verify availability
claude --version
```

## RemoteClaudeClawBackend

Connects to a remote Claude/ClaudeClaw worker.

```json
{
  "ai": {
    "type": "remote",
    "host": "workstation.local",
    "port": 8822,
    "transport": "http"
  }
}
```

Supports HTTP and SSH transports.

## Transparency

- AI edits are shown as diffs before application
- Accept/reject per-file
- Undo available via article version history
- AI never silently rewrites large portions of content
