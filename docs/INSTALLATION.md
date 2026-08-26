# Installation

One command, the same on every platform, after a one-line install.

---

## Requirements

| | Minimum | Notes |
| --- | --- | --- |
| Node.js | 18 | 22 recommended |
| npm | any recent | ships with Node |
| git | optional | needed for `publisher update` |
| TeX Live / MiKTeX | optional | needed for PDF compilation — see [LATEX_AND_PDF.md](LATEX_AND_PDF.md) |
| Claude Code CLI | optional | one of three AI options — see [AI_CONNECTIONS.md](AI_CONNECTIONS.md) |

MDTeX works without LaTeX and without any AI connection; those features show a
setup state rather than failing.

---

## Linux and macOS

```bash
git clone git@github.com:ouyang-matters/mdtex_pipeline.git
cd mdtex_pipeline
./install.sh
```

The installer:

1. checks Node, npm and git
2. pulls the latest changes (skip with `MDTEX_SKIP_PULL=1`)
3. installs dependencies and builds the UI
4. initialises `~/.config/publisher/` and `~/.local/share/publisher/`
5. writes a `publisher` launcher into `~/.local/bin`
6. **adds `~/.local/bin` to your PATH automatically**, once, with a marker
   comment so re-running never appends a duplicate
7. reports what LaTeX it found
8. runs the rendering self-test

Open a new terminal (or `export PATH="$HOME/.local/bin:$PATH"`) and:

```bash
publisher start
```

Override the install location with `MDTEX_BIN_DIR=/somewhere/else ./install.sh`.

---

## Windows

From PowerShell, in the checkout:

```powershell
.\install.ps1
```

The installer does the same work, then:

- writes **`publisher.cmd`** and **`publisher.ps1`** into
  `%LOCALAPPDATA%\Programs\MDTeX\bin`
- **adds that directory to your user PATH** with
  `[Environment]::SetEnvironmentVariable('Path', …, 'User')` — no administrator
  rights, and only once
- adds it to the current session too, so you can use `publisher` immediately

Open a new terminal and:

```powershell
publisher start
```

There is **no virtual environment to activate** and **no long
`python path\to\script.py` command**. `publisher` is a real command in both
PowerShell and CMD: `publisher.cmd` handles CMD, `publisher.ps1` is preferred by
PowerShell and forwards the child exit code so scripting works.

Override the install location by setting `MDTEX_BIN_DIR` before running.

### Why the installer resolves `npm.cmd` explicitly

PowerShell's command discovery prefers a `.ps1` script over an application, so a
plain `npm install` in a script runs **`npm.ps1`**, not `npm.cmd`. `npm.ps1`
invokes `node.exe` from inside a PowerShell scope, and Windows PowerShell 5.1
converts a native command's stderr writes into error records. Under the
installer's `$ErrorActionPreference = 'Stop'`, a routine deprecation warning
therefore became a terminating error:

```text
node.exe : npm warn deprecated whatwg-encoding@3.1.1 ...
At C:\Program Files\nodejs\npm.ps1:29 char:3
... FullyQualifiedErrorId : NativeCommandError
```

npm had exited 0. Nothing had failed.

Every native command in the installer now goes through
`scripts/windows/NativeCommand.ps1`, which:

- resolves to a `.exe`, `.cmd` or `.bat` and **never** to a `.ps1` wrapper
- relaxes the two PowerShell traps (5.1's stderr-to-error conversion, and
  PowerShell 7.3+'s `$PSNativeCommandUseErrorActionPreference`) inside the
  helper's own function scope, leaving the installer's strict error handling
  fully in force
- decides success from the process exit code and nothing else
- keeps warnings visible instead of hiding them

Warnings are printed and ignored; the installer fails only when a command
actually exits non-zero.

---

## The command contract

Identical on Windows and Linux. Same names, same arguments, same output.

```text
publisher start                                   launch MDTeX Studio
publisher init                                    create user directories and defaults
publisher doctor                                  full health check
publisher update                                  safe in-place update
publisher build <article-dir> --target pdf        compile a PDF
publisher build <article-dir> --target wechat     compile for WeChat
publisher version                                 version and schema information
```

Also available, on both:

```text
publisher validate <article> --target wechat      validate without writing output
publisher latex [--verbose]                       show the detected LaTeX environment
publisher themes list | copy <src> <dst>
publisher ws create <title> | list | search <q> | import <file>
publisher backups list | create | restore <name>
```

Only the launcher differs between platforms — a shell wrapper on Linux/macOS,
`.cmd` and `.ps1` shims on Windows. Everything above the launcher is the same
Node application.

---

## Launching

```bash
publisher start
```

starts the local backend, serves the UI from the same origin, and opens your
browser:

```text
  MDTeX Studio
  http://127.0.0.1:4173

  Workspace: /home/you/.local/share/publisher/workspace
  Config:    /home/you/.config/publisher

  The backend is bound to 127.0.0.1 and requires a per-session token.
  Press Ctrl+C to stop.
```

| Flag | Effect |
| --- | --- |
| `--port <n>` | listen on a different port (default 4173) |
| `--no-open` | do not open a browser |
| `--force` | start a second instance even if one is already running |

Running `publisher start` twice detects the existing instance and opens that one
instead of starting a competing server.

### Security posture

The backend binds to `127.0.0.1` only. Every `/api` call must carry a
per-session token, generated at startup and handed to the page when it is
served. Requests whose `Host` or `Origin` is not a loopback address are refused,
which closes the DNS-rebinding path. There is no unauthenticated network
surface, and nothing is exposed beyond the machine.

The token is written to `~/.local/share/publisher/runtime.json` with owner-only
permissions so other tools you own — the dev server proxy, the end-to-end
harness — can reach the API without the token ever crossing the network or
appearing in a command line. It is removed on shutdown.

---

## Verifying the installation

```bash
publisher doctor
```

checks the runtime, the application, whether `publisher` is on PATH, the user
directories, the LaTeX environment (each tool's resolved path), the AI
connections, the Blog Pipeline CLI, and runs the rendering self-test.

`publisher doctor --verbose` additionally lists every directory searched for
LaTeX tools, which is the fastest way to see why an installation was not found.

---

## Updating

```bash
publisher update
```

pulls, reinstalls dependencies, migrates configuration, rebuilds the UI and runs
the self-tests — taking a backup of your configuration and themes first. See
[UPDATING.md](UPDATING.md).

Re-running the installer does the same thing and is equally safe.

---

## Development

```bash
npm run dev
```

starts Vite with the MDTeX backend running in-process and `/api` proxied to it,
so the dev page talks to a real backend rather than a mock. The UI is at
`http://localhost:3000`.

```bash
npm test                          # 325 unit tests
node scripts/e2e.js               # drive the built UI in real Chrome
node scripts/e2e.js --headed      # …with a visible window
node scripts/workflow-check.js    # walk the whole primary workflow in one run
node scripts/bench-wechat.js      # measure both WeChat compilation paths
npm run test:windows              # PowerShell installer suites (needs pwsh)
npm run build                     # production build into dist/ui
```

The PowerShell suites are dependency-free — no Pester — and run on any platform
that has `pwsh`. `npm test` runs their static counterparts everywhere and
executes the PowerShell suites too when a PowerShell is on PATH.

The end-to-end and benchmark harnesses drive Chrome directly over the DevTools
Protocol (`scripts/lib/chrome.js`) and need no extra dependency: Node 22 ships a
WebSocket client, which is all CDP requires. They find Chrome automatically, or
you can set `MDTEX_CHROME`.

---

## Uninstalling

```bash
rm ~/.local/bin/publisher                     # Linux/macOS
# Windows: delete %LOCALAPPDATA%\Programs\MDTeX\bin and remove it from PATH

rm -rf ~/.config/publisher                    # configuration and secrets
rm -rf ~/.local/share/publisher               # workspace, themes, backups
rm -rf ~/.cache/publisher                     # caches
rm -rf /path/to/mdtex_pipeline                # the checkout
```

Your articles live in the workspace directory. Copy it somewhere safe before
removing anything.

---

## Troubleshooting

**`publisher: command not found`** — open a new terminal so the PATH change
takes effect, or run the installer again. `publisher doctor` reports whether the
command is on PATH.

**The UI says the backend is not reachable** — `publisher start` is not running,
or it exited. Start it and press Retry.

**"The MDTeX UI has not been built yet"** — run `npm run build` in the checkout,
or re-run the installer.

**PDF compilation is unavailable** — see
[LATEX_AND_PDF.md](LATEX_AND_PDF.md#when-latex-is-missing). `publisher latex
--verbose` lists every directory that was searched.

**Port already in use** — `publisher start --port 4174`.

**Windows: `NativeCommandError` during "Installing dependencies..."** — fixed.
If you are running an older checkout, update it. The installer used to let
PowerShell resolve `npm` to `npm.ps1`, whose stderr writes became terminating
errors under strict error handling; it now resolves `npm.cmd` and judges
success by exit code. See
[why the installer resolves npm.cmd explicitly](#why-the-installer-resolves-npmcmd-explicitly).
