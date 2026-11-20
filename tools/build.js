/**
 * Build: copy src/ -> dist/ (an unpacked, load-ready MV3 extension).
 * No bundler/transpiler needed; the extension is plain ES5 that loads directly.
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const src = path.join(root, 'src');
const dist = path.join(root, 'dist');

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const f = path.join(from, entry.name);
    const t = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(f, t);
    else fs.copyFileSync(f, t);
  }
}

fs.rmSync(dist, { recursive: true, force: true });
copyDir(src, dist);

const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else files.push(path.relative(dist, p).replace(/\\/g, '/'));
  }
})(dist);

console.log(`Built dist/ (${files.length} files)`);
