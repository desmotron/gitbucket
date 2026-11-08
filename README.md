# GitBucket

Automatically commits any folder to Git — no terminal required. Drop a shortcut into a watch folder and GitBucket handles the rest silently in the background.

---

## How It Works

GitBucket watches `C:\GitCheckin` for Windows shortcut files. When you drop a shortcut to a project folder there, it:

1. Initializes a Git repo in that folder (if one doesn't exist yet)
2. Stages all files (`git add .`)
3. Creates a timestamped commit
4. Deletes the shortcut

---

## Installation

1. Clone or copy this repo to `C:\GitBucket`
2. Right-click `install.bat` → **Run as administrator**

That's it. GitBucket will now start automatically every time you log in.

---

## How to Commit a Folder

> **Important:** You must RIGHT-click drag — not left-click drag. Regular (left) drag will **copy or move** the folder. Right-click drag lets you choose "Create shortcut here".

**Steps:**

1. Open `C:\GitCheckin` in one Explorer window and your project folder in another (so you can see both)
2. **Right-click and hold** your project folder
3. Drag it into `C:\GitCheckin`
4. Release — a context menu appears
5. Choose **"Create shortcuts here"**

GitBucket detects the shortcut within a second, commits the folder, and deletes the shortcut automatically. Check `C:\GitBucket\gitbucket.log` to confirm it ran.

---

## Checking the Log

Open `C:\GitBucket\gitbucket.log` to see what happened:

```
[2026-03-08T22:07:05.692Z] Processing: C:\Projects\MyApp
[2026-03-08T22:07:08.272Z] Committed: [master bbaf3ab] GitBucket checkin 2026-03-08 22:07:07
[2026-03-08T22:07:08.273Z] Done. Cleaned up: MyApp - Shortcut.lnk
```

If there was nothing new to commit, you'll see:

```
[2026-03-08T22:07:08.273Z] Nothing to commit in: C:\Projects\MyApp
```

---

## Uninstallation

Right-click `uninstall.bat` → **Run as administrator**

---

## Requirements

- Windows 10 or later
- [Node.js](https://nodejs.org) installed
- [Git](https://git-scm.com) installed and available in PATH
