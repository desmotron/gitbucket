# GitBucket

## What It Does

GitBucket is a Windows background service that automatically commits project folders to Git. The workflow: drop a Windows shortcut (`.lnk`) file into a watch folder, and GitBucket silently initializes a Git repo (if needed), stages all files, and commits them with a timestamp. The shortcut is deleted after processing.

**Use case:** One-action version control — right-drag a project folder to `C:\GitCheckin` or `H:\GitCheckin`, choose "Create shortcut here", and GitBucket handles the rest with no terminal interaction.

---

## Architecture

```
H:\GitBucket\
├── service.js          Core Node.js service (file watcher + Git operations)
├── config.json         Configuration (watchFolders array)
├── package.json        npm manifest; declares chokidar dependency
├── launcher.vbs        VBScript that launches service.js with no visible window
├── install.bat         Registers Windows scheduled task + starts service
├── uninstall.bat       Removes scheduled task
└── gitbucket.log       Append-only activity log (written by service.js)
```

**Runtime:** Node.js + chokidar (file system watcher). No database, no network, no UI.

**Persistence:** Windows Task Scheduler runs `launcher.vbs` at user login with highest privilege. `launcher.vbs` uses `WScript.Shell.Run` with window mode `0` (hidden) so no console appears.

---

## How It Works

### Startup

1. `install.bat` creates `C:\GitCheckin`, runs `npm install`, registers the scheduled task, and starts the service immediately.
2. `launcher.vbs` launches `node service.js` with a hidden window.
3. `service.js` reads `config.json`, creates all watch folders if missing, logs startup, and begins watching.

### Processing a Shortcut

When a `.lnk` file appears in the watch folder:

1. **Stabilize** — chokidar waits 500ms after the write finishes before firing.
2. **Filter** — non-`.lnk` files are ignored.
3. **Resolve target** — PowerShell COM (`WScript.Shell.CreateShortcut().TargetPath`) extracts the shortcut's destination path.
4. **Validate** — confirms target exists and is a directory.
5. **Git init** — runs `git init` if no `.git` folder exists.
6. **Stage** — runs `git add .`.
7. **Commit** — runs `git commit -m "GitBucket checkin YYYY-MM-DD HH:MM:SS"`. Silently swallows "nothing to commit".
8. **Cleanup** — deletes the `.lnk` file.
9. **Log** — every step (and every error) is appended to `gitbucket.log`.

### Key Implementation Details

- **Shortcut resolution** (`service.js:28-38`): Uses `exec` + PowerShell rather than a native Node package to avoid binary dependencies. Single-quote escaping prevents injection from paths containing apostrophes.
- **Git wrapper** (`service.js:42-49`): `execFile('git', ...)` avoids shell interpolation. Uses `cwd` option so Git operates on the target folder, not the service folder.
- **Watcher config** (`service.js:80-84`): `depth: 0` (top-level only), `ignoreInitial: true` (skip files already present on startup), `awaitWriteFinish` (prevents partial-file reads). chokidar accepts an array of paths so one watcher covers all folders.

---

## Configuration

Edit `config.json` before running `install.bat`:

```json
{ "watchFolders": ["C:\\GitCheckin", "H:\\GitCheckin"] }
```

The service auto-creates all watch folders on startup. The old single `watchFolder` string is still supported as a fallback.

---

## Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| chokidar | ^3.6.0 | Cross-platform file system watcher |

Runtime requirements: **Node.js**, **Git** (in PATH), **Windows** (uses PowerShell, VBScript, schtasks).

---

## Installation / Uninstallation

```batch
# Install (requires admin for schtasks)
install.bat

# Uninstall
uninstall.bat
```

The scheduled task is named `GitBucket Watcher` and runs as the current user at login.

---

## Logging

All activity is appended to `gitbucket.log` with ISO 8601 timestamps:

```
[2026-03-08T22:03:44.020Z] GitBucket started. Watching: C:\GitCheckin, H:\GitCheckin
[2026-03-08T22:07:05.692Z] Processing: C:\SomeProject
[2026-03-08T22:07:08.272Z] Committed: [master bbaf3ab] GitBucket checkin 2026-03-08 22:07:07
[2026-03-08T22:07:08.273Z] Done. Cleaned up: SomeProject - Shortcut.lnk
```

Errors are logged as `ERROR: <message>` and do not crash the service.
