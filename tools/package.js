/** Package dist/ into a store-uploadable zip using PowerShell Compress-Archive. */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const manifest = JSON.parse(fs.readFileSync(path.join(dist, 'manifest.json'), 'utf8'));
const zipName = `${manifest.name.replace(/\s+/g, '_')}_v${manifest.version}.zip`;
const zipPath = path.join(root, zipName);

if (fs.existsSync(zipPath)) fs.rmSync(zipPath);
// -Path dist\* so the zip root contains the extension files (manifest.json at top level)
execFileSync('powershell', [
  '-NoProfile', '-Command',
  `Compress-Archive -Path "${dist}\\*" -DestinationPath "${zipPath}" -Force`
], { stdio: 'inherit' });

console.log(`Packaged ${zipName}`);
