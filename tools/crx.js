/**
 * Package dist/ into a signed CRX3 extension file.
 *
 * Uses a Chromium browser's own packager (Chrome or Edge), which is the only tool that
 * reliably emits the current CRX3 format. Signing requires a private key (.pem):
 *   - If keys/<name>.pem exists it is reused, so the extension ID stays stable across builds.
 *   - Otherwise a fresh RSA-2048 key is generated and saved for future builds.
 *
 * The private key is what publishes updates for a given extension ID — keep it secret and
 * back it up. It is git-ignored by default.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const keysDir = path.join(root, 'keys');
const manifest = JSON.parse(fs.readFileSync(path.join(dist, 'manifest.json'), 'utf8'));
const crxName = `${manifest.name.replace(/\s+/g, '_')}_v${manifest.version}.crx`;
const crxPath = path.join(root, crxName);
const pemPath = path.join(keysDir, 'extension_key.pem');

if (!fs.existsSync(path.join(dist, 'manifest.json'))) {
  console.error('dist/ not built yet — run "npm run build" first.');
  process.exit(1);
}

// 1. Locate a Chromium browser that can pack extensions.
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe'),
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const browser = candidates.find(p => { try { return fs.existsSync(p); } catch { return false; } });
if (!browser) {
  console.error('Could not find Chrome or Edge. Set CHROME_PATH to a chrome.exe/msedge.exe and retry.');
  process.exit(1);
}

// 2. Ensure a signing key exists (stable extension ID across builds).
fs.mkdirSync(keysDir, { recursive: true });
if (!fs.existsSync(pemPath)) {
  const { privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    // Chromium's packager requires a PKCS#8 PEM-encoded RSA key.
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  fs.writeFileSync(pemPath, privateKey, { mode: 0o600 });
  console.log(`Generated new signing key: ${path.relative(root, pemPath)} (back this up)`);
}

// 3. Pack with the browser. The packager writes <dir>.crx next to the input dir.
if (fs.existsSync(crxPath)) fs.rmSync(crxPath);
const tmpCrx = dist.replace(/\\$/, '') + '.crx';
if (fs.existsSync(tmpCrx)) fs.rmSync(tmpCrx);

execFileSync(browser, [
  '--headless',
  `--pack-extension=${dist}`,
  `--pack-extension-key=${pemPath}`,
  '--no-sandbox',
  '--disable-gpu',
], { stdio: 'pipe' });

if (!fs.existsSync(tmpCrx)) {
  console.error('Packaging did not produce a .crx. The browser may need a visible profile; try running without --headless.');
  process.exit(1);
}
fs.renameSync(tmpCrx, crxPath);

console.log(`Packaged ${crxName} (${(fs.statSync(crxPath).size / 1024).toFixed(1)} KB) signed with ${path.relative(root, pemPath)}`);
