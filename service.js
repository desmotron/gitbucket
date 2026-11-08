// GitBucket - Silent background Git check-in watcher for Windows
// Watches a folder for .lnk (shortcut) files. When one is dropped,
// resolves the target path and runs git init + commit on it.

const chokidar = require('chokidar');
const { execFile, exec } = require('child_process');
const path = require('path');
const fs = require('fs');

// --- Config & Logging ---

const CONFIG_PATH = path.join(__dirname, 'config.json');
const LOG_PATH = path.join(__dirname, 'gitbucket.log');

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  fs.appendFileSync(LOG_PATH, line);
}

const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
const WATCH_FOLDERS = config.watchFolders || (config.watchFolder ? [config.watchFolder] : ['C:\\GitCheckin']);

for (const folder of WATCH_FOLDERS) {
  fs.mkdirSync(folder, { recursive: true });
}
log(`GitBucket started. Watching: ${WATCH_FOLDERS.join(', ')}`);

// --- Shortcut Resolution ---

function resolveLnk(lnkPath) {
  return new Promise((resolve, reject) => {
    // Use PowerShell COM to read the shortcut target
    const escaped = lnkPath.replace(/'/g, "''");
    const cmd = `(New-Object -ComObject WScript.Shell).CreateShortcut('${escaped}').TargetPath`;
    exec(`powershell -NoProfile -Command "${cmd}"`, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr.trim() || err.message));
      resolve(stdout.trim());
    });
  });
}

// --- Git Operations ---

function git(args, cwd) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr.trim() || err.message));
      resolve(stdout.trim());
    });
  });
}

async function checkin(folderPath) {
  log(`Processing: ${folderPath}`);

  const isRepo = fs.existsSync(path.join(folderPath, '.git'));
  if (!isRepo) {
    await git(['init'], folderPath);
    log(`Initialized new repo: ${folderPath}`);
  }

  await git(['add', '.'], folderPath);

  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const message = `GitBucket checkin ${timestamp}`;

  try {
    const result = await git(['commit', '-m', message], folderPath);
    log(`Committed: ${result.split('\n')[0]}`);
  } catch (err) {
    if (err.message.includes('nothing to commit')) {
      log(`Nothing to commit in: ${folderPath}`);
    } else {
      throw err;
    }
  }
}

// --- Watcher ---

const watcher = chokidar.watch(WATCH_FOLDERS, {
  depth: 0,
  ignoreInitial: true,
  awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 }
});

watcher.on('add', async (filePath) => {
  if (path.extname(filePath).toLowerCase() !== '.lnk') return;

  try {
    const target = await resolveLnk(filePath);
    if (!target) throw new Error('Shortcut target is empty');

    const stat = fs.statSync(target);
    if (!stat.isDirectory()) throw new Error(`Target is not a folder: ${target}`);

    await checkin(target);
    fs.unlinkSync(filePath);
    log(`Done. Cleaned up: ${path.basename(filePath)}`);
  } catch (err) {
    log(`ERROR: ${err.message}`);
  }
});

watcher.on('error', (err) => log(`Watcher error: ${err.message}`));
