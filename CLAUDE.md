# GitBucket

## What It Does

GitBucket is a Windows background service that automatically commits project folders to Git. The workflow: drop a Windows shortcut (`.lnk`) file into a watch folder, and GitBucket silently initializes a Git repo (if needed), stages all files, and commits them with a timestamp. The shortcut is deleted after processing.

**Use case:** One-action version control — right-drag a project folder to a drop folder (`C:\GitCheckin`, or one on another drive such as `D:\GitCheckin`), choose "Create shortcut here", and GitBucket handles the rest with no terminal interaction.

---

## Architecture

```
GitBucket\
├── service.js          Core Node.js service (file watcher + safety checks + Git operations)
├── config.json         Configuration (watchFolders, branch, safetyChecks)
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
5. **Nesting check** — `git rev-parse --show-toplevel`; if the folder is inside another repo (not its root), refuse.
6. **Git init** — runs `git init` if the folder isn't a repo (`git init -b checkin-YYYY-MM-DD` in dated mode).
7. **Safety checks** — `git add --dry-run -A .` lists what would be staged (so `.gitignore` is honoured); each file is checked by name, extension, size, and (for small text files) content patterns for keys/tokens. Any hit → refuse; a `.git` created in step 6 is removed again.
8. **Branch** — in `"branch": "dated"` mode, switch to a new `checkin-YYYY-MM-DD` branch off the current one; refuse if that branch exists but isn't checked out.
9. **Stage + commit** — `git add -A .`, then `git diff --cached --quiet` to detect "nothing to commit", else `git commit -m "GitBucket checkin YYYY-MM-DD HH:MM:SS"`.
10. **Cleanup** — deletes the `.lnk` file (only on success; a refusal leaves it in place).
11. **Log + toast** — every step is appended to `gitbucket.log`; success, refusal and errors also show a Windows toast.

### Key Implementation Details

- **Shortcut resolution** (`resolveLnk`): Uses `exec` + PowerShell rather than a native Node package to avoid binary dependencies. Single-quote escaping prevents injection from paths containing apostrophes.
- **Git wrapper** (`git`): `execFile('git', ...)` avoids shell interpolation. Uses `cwd` option so Git operates on the target folder, not the service folder. 64 MB `maxBuffer` for dry-runs on big folders.
- **Refusals** (`Refused` class): thrown for rule violations; the watcher logs `REFUSED:` and toasts instead of `ERROR:`. Rule lists are the regex constants above `checkStaging`.
- **Toasts** (`toast`): Windows PowerShell's WinRT `ToastNotificationManager`, script passed via `-EncodedCommand`, text via env vars. Failures are only logged.
- **Watcher config**: `depth: 0` (top-level only), `ignoreInitial: true` (skip files already present on startup), `awaitWriteFinish` (prevents partial-file reads). chokidar accepts an array of paths so one watcher covers all folders.

---

## Configuration

Edit `config.json` before running `install.bat`:

```json
{
  "watchFolders": ["C:\\GitCheckin", "D:\\GitCheckin"],
  "branch": "current",
  "safetyChecks": true
}
```

- `watchFolders`: one drop folder per drive is the intended pattern; the service auto-creates them all on startup. The old single `watchFolder` string is still supported as a fallback.
- `branch`: `"current"` (default) commits on the checked-out branch; `"dated"` commits on `checkin-YYYY-MM-DD`.
- `safetyChecks`: default `true`; `false` restores the old commit-everything behaviour.

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
[2026-03-08T22:03:44.020Z] GitBucket started. Watching: C:\GitCheckin, D:\GitCheckin (branch: current, safety checks: on)
[2026-03-08T22:07:05.692Z] Processing: C:\SomeProject
[2026-03-08T22:07:08.272Z] Committed: [master bbaf3ab] GitBucket checkin 2026-03-08 22:07:07
[2026-03-08T22:07:08.273Z] Done. Cleaned up: SomeProject - Shortcut.lnk
```

Errors are logged as `ERROR: <message>`, safety-check refusals as `REFUSED: <reason>` (with each offending file on its own line above), and neither crashes the service.
