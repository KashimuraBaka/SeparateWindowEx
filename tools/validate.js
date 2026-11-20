/**
 * Validate dist/ against Chrome/Edge Manifest V3 requirements:
 *  - manifest parses, manifest_version === 3, required keys present
 *  - no MV2-only keys (background.persistent, browser_action, key, update_url)
 *  - no MV2-only APIs referenced in shipped JS (executeScript, getBackgroundPage,
 *    browserAction, chrome.extension.*)
 *  - service_worker file exists
 *  - every action/content-script/web_accessible_resource/icon/locale path exists
 *  - every messages.json key used via i18n.getMessage / __MSG_ exists in _locales/en
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const errors = [];
const warnings = [];

function exists(p) { return fs.existsSync(path.join(dist, p)); }
function read(p) { return fs.readFileSync(path.join(dist, p), 'utf8'); }
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(path.relative(dist, p).replace(/\\/g, '/'));
  }
  return out;
}

let manifest;
try {
  manifest = JSON.parse(read('manifest.json'));
} catch (e) {
  console.error('FATAL: manifest.json does not parse:', e.message);
  process.exit(1);
}

const allFiles = walk(dist);

// 1. MV3 core
if (manifest.manifest_version !== 3) errors.push(`manifest_version must be 3, got ${manifest.manifest_version}`);
for (const key of ['name', 'version', 'manifest_version']) {
  if (!manifest[key]) errors.push(`Missing required key "${key}"`);
}

// 2. MV2-only manifest keys must be gone
const bannedKeys = ['browser_action', 'page_action', 'background.persistent', 'background.scripts', 'key', 'update_url', 'offline_enabled'];
for (const bk of bannedKeys) {
  if (bk.includes('.')) {
    const [a, b] = bk.split('.');
    if (manifest[a] && Object.prototype.hasOwnProperty.call(manifest[a], b)) {
      errors.push(`MV2-only key "${bk}" present`);
    }
  } else if (Object.prototype.hasOwnProperty.call(manifest, bk)) {
    errors.push(`MV2-only key "${bk}" present (store-only artifacts must be removed)`);
  }
}

// 3. background service worker
if (!manifest.background || manifest.background.type !== undefined && manifest.background.type !== 'service_worker') {
  // service_worker is the default; only flag if a non-worker type is set
}
if (!manifest.background || !manifest.background.service_worker) {
  errors.push('background.service_worker is required in MV3');
} else if (!exists(manifest.background.service_worker)) {
  errors.push(`background.service_worker not found: ${manifest.background.service_worker}`);
}

// 4. permissions: scripting needed for chrome.scripting; host_permissions for broad injection
const perms = manifest.permissions || [];
if (perms.includes('<all_urls>')) errors.push('MV2-style "<all_urls>" permission present; use host_permissions');
const needsScripting = allFiles.some(f => f.endsWith('.js')) &&
  /chrome\.scripting\.executeScript/.test(read(path.join('js', 'background.js')));
if (needsScripting && !perms.includes('scripting')) {
  errors.push('code uses chrome.scripting.executeScript but "scripting" permission is missing');
}
if (needsScripting && !(manifest.host_permissions || []).length) {
  errors.push('chrome.scripting.executeScript needs host_permissions');
}

// 5. paths referenced by the manifest must exist
function checkPath(p, label) {
  if (!p) return;
  if (!exists(p)) errors.push(`${label} not found: ${p}`);
}
(manifest.action && manifest.action.default_icon) && checkPath(manifest.action.default_icon, 'action.default_icon');
manifest.action && manifest.action.default_popup && checkPath(manifest.action.default_popup, 'action.default_popup');
for (const [size, p] of Object.entries(manifest.icons || {})) checkPath(p, `icons[${size}]`);
for (const cs of manifest.content_scripts || []) {
  for (const j of cs.js || []) checkPath(j, 'content_scripts.js');
  for (const c of cs.css || []) checkPath(c, 'content_scripts.css');
}
// web_accessible_resources: object form
const war = manifest.web_accessible_resources || [];
for (const entry of war) {
  if (typeof entry === 'string') {
    errors.push('web_accessible_resources uses MV2 string form; MV3 requires {resources, matches} objects');
    continue;
  }
  if (!entry.matches) errors.push('web_accessible_resources entry missing "matches"');
  for (const r of entry.resources || []) checkPath(r, 'web_accessible_resources');
}

// 6. MV2-only APIs in shipped JS (ignore occurrences inside comments, where the
//    migration notes legitimately name the old APIs)
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')   // block comments
    .replace(/\/\/.*$/gm, ' ');           // line comments
}
const jsFiles = allFiles.filter(f => f.endsWith('.js'));
const bannedApi = [
  [/chrome\.extension\./, 'chrome.extension.*'],
  [/chrome\.tabs\.executeScript/, 'chrome.tabs.executeScript'],
  [/chrome\.browserAction/, 'chrome.browserAction'],
  [/getBackgroundPage/, 'getBackgroundPage'],
];
for (const f of jsFiles) {
  const text = stripComments(read(f));
  for (const [re, label] of bannedApi) {
    if (re.test(text)) errors.push(`${f}: uses MV2-only API ${label}`);
  }
}

// 7. locale keys referenced by i18n / __MSG_ exist
const localesDir = path.join(dist, '_locales');
let enKeys = new Set();
const defaultLocale = manifest.default_locale || 'en';
try {
  const en = JSON.parse(read(`_locales/${defaultLocale}/messages.json`));
  enKeys = new Set(Object.keys(en));
} catch (e) {
  errors.push(`_locales/${defaultLocale}/messages.json missing or invalid`);
}
for (const f of allFiles) {
  if (!/\.(js|html|css)$/.test(f)) continue;
  const text = read(f);
  for (const m of text.matchAll(/(?:getMessage\(\s*'|__MSG_)([A-Za-z0-9_]+)/g)) {
    if (!enKeys.has(m[1])) errors.push(`${f}: i18n key "${m[1]}" not in ${defaultLocale} messages.json`);
  }
}
// every locale must define extDesc (used by manifest description)
try {
  for (const loc of fs.readdirSync(localesDir)) {
    const msgs = JSON.parse(read(`_locales/${loc}/messages.json`));
    if (!msgs.extDesc) errors.push(`_locales/${loc} missing extDesc (manifest description uses it)`);
  }
} catch (e) { /* already reported above if missing */ }

// 8. content script js files referenced in the worker via chrome.scripting exist
for (const f of ['js/player.js', 'js/iframe.js']) {
  if (!exists(f)) errors.push(`scripting target file missing: ${f}`);
}

if (warnings.length) console.log('Warnings:\n - ' + warnings.join('\n - '));
if (errors.length) {
  console.error(`Validation FAILED with ${errors.length} issue(s):`);
  for (const e of errors) console.error(' - ' + e);
  process.exit(1);
} else {
  console.log(`Validation PASSED: MV3-compliant. ${allFiles.length} files, ${jsFiles.length} JS, ${enKeys.size} en locale keys.`);
}
