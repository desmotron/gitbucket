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

// Windows toast via Windows PowerShell's WinRT bridge. Text goes in env vars, so
// no quoting games; failures only get logged — a toast is never worth a crash.
const TOAST_PS = String.raw`
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null
$t = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$x = $t.GetElementsByTagName('text')
$x.Item(0).AppendChild($t.CreateTextNode($env:GB_TITLE)) > $null
$x.Item(1).AppendChild($t.CreateTextNode($env:GB_BODY)) > $null
$app = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($app).Show([Windows.UI.Notifications.ToastNotification]::new($t))
`;

function toast(title, body) {
  const encoded = Buffer.from(TOAST_PS, 'utf16le').toString('base64');
  execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
    { env: { ...process.env, GB_TITLE: title, GB_BODY: body }, windowsHide: true },
    (err, _out, stderr) => { if (err) log(`toast failed: ${(stderr || err.message).trim()}`); });
}

const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
const WATCH_FOLDERS = config.watchFolders || (config.watchFolder ? [config.watchFolder] : ['C:\\GitCheckin']);
// "current": commit on whatever branch is checked out.
// "dated":   commit on checkin-YYYY-MM-DD, branched off the current one (never on main).
const BRANCH_MODE = config.branch === 'dated' ? 'dated' : 'current';
// Refuse secrets, media/models/data files, huge files and nested repos. On unless set to false.
const SAFETY_CHECKS = config.safetyChecks !== false;

for (const folder of WATCH_FOLDERS) {
  fs.mkdirSync(folder, { recursive: true });
}
log(`GitBucket started. Watching: ${WATCH_FOLDERS.join(', ')} (branch: ${BRANCH_MODE}, safety checks: ${SAFETY_CHECKS ? 'on' : 'off'})`);

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
    // maxBuffer: `add --dry-run` on a big folder lists every file.
    execFile('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr.trim() || err.message));
      resolve(stdout.trim());
    });
  });
}

// --- Safety checks ---
// Never commit secrets, media/large binaries, models, or database files; never
// nest a repo inside another. A refusal changes nothing, logs why, shows a
// toast, and leaves the shortcut in place. Set "safetyChecks": false to skip.

class Refused extends Error {}

const SECRET_NAME = /^(\.env(\..+)?|id_(rsa|ed25519|ecdsa|dsa)|.+\.(pem|key|pfx|p12|kdbx)|credentials.*\.json|token\.json|service[-_]?account.*\.json)$/i;
const SECRET_NAME_OK = /^\.env\.(example|sample|template)$/i;
const NEVER_EXT = /\.(mp4|mov|mkv|avi|webm|m4v|wmv|wav|mp3|flac|m4a|aac|ogg|psd|blend|zip|7z|rar|iso|gguf|safetensors|ckpt|pt|pth|onnx|npy|npz|h5|tflite|db|sqlite3?|mdb|accdb)$/i;
const IMAGE_EXT = /\.(jpe?g|png|webp|gif|bmp|tiff?|heic|raw|cr2|nef|dng)$/i;
const MAX_FILE = 10 * 1024 * 1024;   // any file
const MAX_IMAGE = 1024 * 1024;       // icons fine, photo dumps not
const SECRET_TEXT = [
  /sk-ant-[A-Za-z0-9_-]{20,}/, /\bsk-[A-Za-z0-9_-]{32,}/, /AKIA[0-9A-Z]{16}/,
  /gh[pousr]_[A-Za-z0-9]{36}/, /github_pat_[A-Za-z0-9_]{40,}/, /xox[abpr]-[A-Za-z0-9-]{10,}/,
  /AIza[0-9A-Za-z_-]{35}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /\b\d{8,10}:AA[A-Za-z0-9_-]{33}\b/,
];

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Returns the repo root `folder` sits in, or null if it's in none.
async function repoRoot(folder) {
  try {
    return path.resolve(await git(['rev-parse', '--show-toplevel'], folder));
  } catch (err) {
    if (/not a git repository/i.test(err.message)) return null;
    throw err;  // e.g. "dubious ownership" — don't guess, and don't init over it
  }
}

// What `git add -A .` would stage, checked against the rules. Returns problems.
async function checkStaging(folder) {
  const out = await git(['-c', 'core.quotepath=off', 'add', '--dry-run', '-A', '.'], folder);
  const problems = [];
  for (const line of out.split('\n')) {
    const m = line.match(/^add '(.*)'$/);
    if (!m) continue;
    const rel = m[1];
    const name = path.basename(rel);
    let size;
    try { size = fs.statSync(path.join(folder, rel)).size; } catch { continue; }
    if (SECRET_NAME.test(name) && !SECRET_NAME_OK.test(name)) problems.push(`secret file: ${rel}`);
    else if (NEVER_EXT.test(name)) problems.push(`media/model/data file: ${rel}`);
    else if (IMAGE_EXT.test(name) && size > MAX_IMAGE) problems.push(`large image (${(size / 1048576).toFixed(1)} MB): ${rel}`);
    else if (size > MAX_FILE) problems.push(`large file (${(size / 1048576).toFixed(1)} MB): ${rel}`);
    else if (size <= MAX_IMAGE) {
      const buf = fs.readFileSync(path.join(folder, rel));
      if (buf.subarray(0, 8000).includes(0)) continue;  // binary
      const text = buf.toString('utf8');
      if (SECRET_TEXT.some((re) => re.test(text))) problems.push(`looks like a key/token inside: ${rel}`);
    }
  }
  return problems;
}

async function checkin(folderPath) {
  log(`Processing: ${folderPath}`);
  const folder = path.resolve(folderPath);
  const dated = BRANCH_MODE === 'dated';
  const branch = dated ? `checkin-${today()}` : null;

  let root = await repoRoot(folder);
  if (root && root.toLowerCase() !== folder.toLowerCase()) {
    if (SAFETY_CHECKS) {
      throw new Refused(`it's inside the repo ${root} — drop that folder instead (no nested repos)`);
    }
    root = null;  // checks off: old behaviour, give this folder its own repo
  }

  let created = false;
  if (!root) {
    await git(dated ? ['init', '-b', branch] : ['init'], folder);
    created = true;
    log(`Initialized new repo: ${folder}${dated ? ` (branch ${branch})` : ''}`);
  }

  const problems = SAFETY_CHECKS ? await checkStaging(folder) : [];
  if (problems.length) {
    if (created) fs.rmSync(path.join(folder, '.git'), { recursive: true, force: true });
    for (const p of problems) log(`  ${p}`);
    throw new Refused(`${problems.length} file(s) not allowed (add them to .gitignore): ${problems.slice(0, 3).join('; ')}${problems.length > 3 ? '; ...' : ''}`);
  }

  if (dated && !created) {
    const current = await git(['branch', '--show-current'], folder);
    if (current !== branch) {
      let exists = true;
      try { await git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], folder); } catch { exists = false; }
      if (exists) {
        throw new Refused(`${branch} already exists but ${current || 'a detached HEAD'} is checked out — switch to ${branch} first`);
      }
      await git(['switch', '-c', branch], folder);
      log(`Branched ${branch} off ${current || 'HEAD'}`);
    }
  }

  const on = branch || (await git(['branch', '--show-current'], folder)) || 'HEAD';
  await git(['add', '-A', '.'], folder);
  try {
    await git(['diff', '--cached', '--quiet'], folder);
    log(`Nothing to commit in: ${folder}`);
    return `nothing new to commit (on ${on})`;
  } catch { /* exit 1 = there are staged changes */ }

  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const message = `GitBucket checkin ${timestamp}`;
  const result = await git(['commit', '-m', message], folder);
  log(`Committed: ${result.split('\n')[0]}`);
  return `committed on ${on}`;
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

    const outcome = await checkin(target);
    fs.unlinkSync(filePath);
    log(`Done. Cleaned up: ${path.basename(filePath)}`);
    toast(`GitBucket: ${path.basename(target)}`, outcome);
  } catch (err) {
    if (err instanceof Refused) {
      log(`REFUSED: ${err.message} (shortcut left in place)`);
      toast(`GitBucket refused: ${path.basename(filePath, '.lnk')}`, err.message);
    } else {
      log(`ERROR: ${err.message}`);
      toast('GitBucket error', err.message);
    }
  }
});

watcher.on('error', (err) => log(`Watcher error: ${err.message}`));
