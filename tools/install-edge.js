/**
 * Build the extension and auto-launch Edge with it loaded — a one-command
 * "build + install + open" for development.
 *
 *   node tools/install-edge.js
 *   node tools/install-edge.js https://example.com   # also open a URL
 *
 * How it works:
 *   Edge/Chrome can load an unpacked extension at launch via --load-extension.
 *   Since Chrome/Edge 137 this flag is ignored on the *default* profile, so we
 *   launch with a dedicated --user-data-dir (an isolated "dev profile"). The
 *   extension is loaded fresh from dist/ every launch — no manual packing,
 *   signing, or dragging files needed.
 *
 * Notes:
 *   - This is a development/preview install (the "Developer mode" equivalent),
 *     not a store install. For a permanent/enterprise install, deploy the .crx
 *     via extension-install policy (see README).
 *   - Close all windows of this dev profile before re-running, or Edge will
 *     just open a new window on the existing profile without reloading the
 *     extension.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');

// 1. Build so dist/ is current.
console.log('Building extension...');
require('./build.js');

if (!fs.existsSync(path.join(dist, 'manifest.json'))) {
  console.error('Build failed — dist/manifest.json not found.');
  process.exit(1);
}

// 2. Locate Edge (Chrome fallback).
const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';
const candidates = [
  process.env.EDGE_PATH,
  isWin && 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  isWin && 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  isWin && 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  isMac && '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  isMac && '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  !isWin && !isMac && '/usr/bin/microsoft-edge',
  !isWin && !isMac && '/usr/bin/google-chrome',
].filter(Boolean);
const browser = candidates.find(p => { try { return fs.existsSync(p); } catch { return false; } });
if (!browser) {
  console.error('Could not find Edge or Chrome. Set EDGE_PATH to the browser executable.');
  process.exit(1);
}

// 3. Dedicated automation profile so --load-extension is honored.
const profileDir = path.join(os.tmpdir(), 'separate-window-dev-profile');
fs.mkdirSync(profileDir, { recursive: true });

const args = [
  `--user-data-dir=${profileDir}`,
  `--load-extension=${dist}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-features=DialMediaRouteProvider', // keep the toolbar action predictable
];
const openUrl = process.argv[2];
if (openUrl) args.push(openUrl);

console.log(`Launching ${path.basename(browser)} with the extension loaded...`);
console.log(`  profile: ${profileDir}`);
console.log(`  extension: ${dist}`);
const child = spawn(browser, args, { detached: true, stdio: 'ignore' });
child.unref();
console.log('Done — the extension is loaded. Pin "Separate Window" from the toolbar puzzle icon if needed.');
