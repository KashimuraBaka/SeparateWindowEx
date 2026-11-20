/**
 * Build the extension and launch Edge/Chrome with it loaded, then VERIFY that the
 * running browser actually loaded this build (not a stale one).
 *
 *   node tools/install-edge.js
 *   node tools/install-edge.js https://example.com
 *
 * Why the verification matters:
 *   Chromium ignores --load-extension when an instance is already running for the
 *   same --user-data-dir; it just opens another window with the OLD extension code.
 *   That silently keeps old builds loaded, so this script
 *     1. closes any instance already using the dev profile, then
 *     2. launches fresh, then
 *     3. connects over the DevTools protocol and checks that the background service
 *        worker really runs the new code.
 *
 * Requires Node >= 22 (global fetch + WebSocket).
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(...a);

function findBrowser() {
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
  return candidates.find(p => { try { return fs.existsSync(p); } catch { return false; } });
}

// An instance already using the same profile swallows --load-extension and keeps
// old code loaded, and a profile killed repeatedly can end up in a state where the
// extension no longer loads at all. So every run uses a fresh profile directory
// under a fixed prefix, and any leftover browser from a previous run is closed.
function closePreviousRuns() {
  if (process.platform !== 'win32') return;
  const ps = [
    `$procs = Get-CimInstance Win32_Process -Filter "Name='msedge.exe' OR Name='chrome.exe'" |`,
    `  Where-Object { $_.CommandLine -and $_.CommandLine.Contains('--user-data-dir=') -and $_.CommandLine.Contains('separate-window-dev') } |`,
    `  Select-Object -ExpandProperty ProcessId`,
    `$n = 0`,
    `foreach ($procId in $procs) { try { Stop-Process -Id $procId -Force -ErrorAction Stop; $n++ } catch {} }`,
    `$n`,
  ].join('\n');
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' });
    const closed = parseInt(out.trim(), 10) || 0;
    if (closed > 0) log(`Closed ${closed} browser process(es) from a previous run.`);
  } catch (e) {
    log('(could not check for previous runs: ' + e.message + ')');
  }
}

async function readPort(portFile, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (fs.existsSync(portFile)) {
      const lines = fs.readFileSync(portFile, 'utf8').split('\n').map(s => s.trim()).filter(Boolean);
      if (lines[0]) return parseInt(lines[0], 10);
    }
    await sleep(250);
  }
  return null;
}

function cdpEval(wsUrl, expression) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => { try { ws.close(); } catch (e) {} reject(new Error('CDP timeout')); }, 8000);
    ws.onopen = () => ws.send(JSON.stringify({
      id: 1, method: 'Runtime.evaluate',
      params: { expression, returnByValue: true, awaitPromise: true },
    }));
    ws.onerror = () => { clearTimeout(timer); reject(new Error('websocket error')); };
    ws.onmessage = ev => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.id !== 1) return;
        clearTimeout(timer);
        try { ws.close(); } catch (e) {}
        resolve(msg.result && msg.result.result ? msg.result.result.value : undefined);
      } catch (e) { /* ignore */ }
    };
  });
}

// Opens a CDP session, enables Runtime and returns the isolated world id used by
// this extension's content script (named "Separate Window").
function contentScriptContext(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const ctxs = [];
    let id = 0;
    const timer = setTimeout(() => { try { ws.close(); } catch (e) {} resolve(null); }, 8000);
    ws.onopen = () => {
      ws.send(JSON.stringify({ id: ++id, method: 'Runtime.enable' }));
      setTimeout(() => {
        clearTimeout(timer);
        try { ws.close(); } catch (e) {}
        const hit = ctxs.find(c => c.name === 'Separate Window');
        resolve(hit ? hit.id : null);
      }, 900);
    };
    ws.onerror = e => { clearTimeout(timer); reject(new Error('websocket error')); };
    ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.method === 'Runtime.executionContextCreated') ctxs.push(m.params.context);
    };
  });
}

function cdpEvalInContext(wsUrl, contextId, expression) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => { try { ws.close(); } catch (e) {} reject(new Error('CDP timeout')); }, 8000);
    ws.onopen = () => ws.send(JSON.stringify({
      id: 1, method: 'Runtime.evaluate',
      params: { expression, contextId, returnByValue: true, awaitPromise: true },
    }));
    ws.onerror = () => { clearTimeout(timer); reject(new Error('websocket error')); };
    ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.id !== 1) return;
      clearTimeout(timer);
      try { ws.close(); } catch (e) {}
      resolve(m.result && m.result.result ? m.result.result.value : undefined);
    };
  });
}

async function main() {
  // ---- build
  log('Building extension...');
  require('./build.js');
  if (!fs.existsSync(path.join(dist, 'manifest.json'))) {
    console.error('Build failed — dist/manifest.json not found.');
    process.exit(1);
  }

  const browser = findBrowser();
  if (!browser) {
    console.error('Could not find Edge or Chrome. Set EDGE_PATH to the browser executable.');
    process.exit(1);
  }

  // Fresh profile per run: guarantees the newly built extension is loaded and avoids
  // the stale/corrupted-profile problems that made earlier launches load old code.
  const profileDir = path.join(os.tmpdir(), 'separate-window-dev-' + Date.now().toString(36));
  fs.mkdirSync(profileDir, { recursive: true });
  closePreviousRuns();
  await sleep(600);

  // ---- launch
  const portFile = path.join(profileDir, 'DevToolsActivePort');
  try { fs.rmSync(portFile, { force: true }); } catch (e) {}

  const args = [
    `--user-data-dir=${profileDir}`,
    `--load-extension=${dist}`,
    `--disable-extensions-except=${dist}`,
    '--remote-debugging-port=0',
    '--no-first-run',
    '--no-default-browser-check',
  ];
  // Start on a blank page: navigating to the target URL at launch can happen
  // before the extension is registered, in which case content scripts never
  // inject into that first page.
  args.push('about:blank');
  const openUrl = process.argv[2];

  log('Launching ' + path.basename(browser) + ' ...');
  log('  profile:   ' + profileDir);
  log('  extension: ' + dist);
  const child = spawn(browser, args, { detached: true, stdio: 'ignore' });
  child.unref();

  // ---- verify
  const port = await readPort(portFile, 25000);
  if (!port) {
    log('');
    log('⚠️  Could not read the DevTools port (the browser probably attached to an');
    log('    instance that was already running). Close all dev-profile windows and retry.');
    return;
  }

  // Give the extension a moment to register before opening the real page.
  await sleep(1500);

  let targets = [];
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch('http://127.0.0.1:' + port + '/json/list');
      targets = await res.json();
      if (targets.some(t => t.type === 'page')) break;
    } catch (e) { /* retry */ }
    await sleep(400);
  }

  // Open the requested page AFTER the extension is ready so content scripts inject.
  if (openUrl) {
    try {
      await fetch('http://127.0.0.1:' + port + '/json/new?' + encodeURIComponent(openUrl),
        { method: 'PUT' });
      for (let i = 0; i < 20; i++) {
        await sleep(500);
        const res = await fetch('http://127.0.0.1:' + port + '/json/list');
        const l = await res.json();
        const hit = l.find(t => t.type === 'page' && t.url && t.url.indexOf(openUrl) !== -1);
        if (hit) { targets = l; break; }
        targets = l;
      }
    } catch (e) {
      log('(could not open ' + openUrl + ': ' + e.message + ')');
    }
  }

  const pageT = targets.find(t => t.type === 'page' && t.url && /^https?:/.test(t.url)) ||
                targets.find(t => t.type === 'page');
  const sw = targets.find(t => t.type === 'service_worker' && t.url && t.url.indexOf('/js/background.js') !== -1);

  log('');
  if (sw) {
    log('✅ Extension loaded — id: ' + new URL(sw.url).host);
  }

  // Verify through the CONTENT SCRIPT instead of the (often idle) service worker:
  // the cached useDocPip value proves which build is actually running in pages.
  let probe = 'no page target';
  if (pageT) {
    try {
      const wsUrl = pageT.webSocketDebuggerUrl;
      // The content script starts at document_start but its isolated world may not
      // be registered the instant the target appears — poll for it.
      let ctx = null;
      for (let i = 0; i < 12 && !ctx; i++) {
        ctx = await contentScriptContext(wsUrl);
        if (!ctx) await sleep(600);
      }
      if (ctx) {
        probe = await cdpEvalInContext(wsUrl, ctx, "JSON.stringify({" +
          "useDocPipDefault: __AppPanel.cfg.useDocPip," +
          "hasPipFeature: typeof __AppPanel._promptActivate === 'function'," +
          "version: chrome.runtime.getManifest().version})");
      } else {
        probe = 'content script not present on ' + pageT.url + ' (load an http(s) page)';
      }
    } catch (e) {
      probe = 'probe failed: ' + e.message;
    }
  }

  log('   running build: ' + probe);
  if (String(probe).indexOf('"hasPipFeature":true') !== -1) {
    log('   -> current Document PiP build is running.');
  } else if (String(probe).indexOf('"hasPipFeature":false') !== -1) {
    log('   ⚠️  OLD build loaded (no Document PiP). Reload the extension.');
  }
  log('');
  log('Test: toolbar icon -> 高级设置 -> 窗口模式 switch (unchecked = top-most PiP).');
  log('      Select a region on a page -> a Picture-in-Picture window should open.');
}

main().catch(e => { console.error(e); process.exit(1); });
