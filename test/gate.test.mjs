/**
 * 可见性闸门的单元测试（`node --test`）。
 *
 * 闸门是注入到页面主世界的一段自包含代码，这里用最小的假 DOM 把它跑起来：
 * 关心的只有三件事 —— 可见性事件是否被拦住、可见性状态是否被固定、
 * 隐藏期间 requestAnimationFrame 是否还能靠 PiP 窗口的帧继续跑。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const outDir = path.join(root, '.tmp');
fs.mkdirSync(outDir, { recursive: true });

function bundle(entry, name) {
  const outfile = path.join(outDir, `${name}-${process.pid}.cjs`);
  buildSync({
    entryPoints: [path.join(root, entry)],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile,
    logLevel: 'silent',
  });
  const mod = require(outfile);
  fs.rmSync(outfile, { force: true });
  return mod;
}

const { sepWinEventGate } = bundle('src/core/gate.ts', 'gate');

/** 够用的假 EventTarget：只记监听器，派发由测试自己按 window → document 走。 */
function fakeTarget() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(type, fn, opts) {
      const capture = opts === true || !!(opts && opts.capture);
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push({ fn, capture });
    },
    removeEventListener(type, fn, opts) {
      const capture = opts === true || !!(opts && opts.capture);
      const list = listeners.get(type) || [];
      const i = list.findIndex((l) => l.fn === fn && l.capture === capture);
      if (i >= 0) list.splice(i, 1);
    },
    count(type) { return (listeners.get(type) || []).length; },
  };
}

/** 手动驱动的帧时钟，测什么就什么时候跑一帧。 */
function fakeRaf() {
  const pending = new Map();
  let next = 1;
  return {
    pending,
    request(cb) { const id = next++; pending.set(id, cb); return id; },
    cancel(id) { pending.delete(id); },
    flush() {
      const list = [...pending.entries()];
      pending.clear();
      for (const [, cb] of list) cb(performance.now());
    },
  };
}

/**
 * 事件派发：事件 target 是 document，路径是 window（捕获）→ document。
 * 用一个 stopped 标志模拟 stopImmediatePropagation 的效果。
 */
function dispatchVisibility(win, doc, type, state) {
  let stopped = false;
  const evt = {
    type,
    capture: false,
    stopImmediatePropagation() { stopped = true; },
    stopPropagation() { stopped = true; },
    preventDefault() { },
  };
  for (const l of win.listeners.get(type) || []) {
    if (stopped) break;
    if (l.capture) l.fn.call(win, evt);
  }
  if (!stopped) for (const l of doc.listeners.get(type) || []) {
    l.fn.call(doc, evt);
  }
  if (!stopped) for (const l of win.listeners.get(type) || []) {
    if (!l.capture) l.fn.call(win, evt);
  }
  return !stopped;
}

/** 装一套假环境并把之前留下的闸门清掉。 */
function makeDom() {
  let hidden = false;
  const docTarget = fakeTarget();
  class FakeDocument { }
  Object.assign(FakeDocument.prototype, {
    addEventListener: docTarget.addEventListener,
    removeEventListener: docTarget.removeEventListener,
    listeners: docTarget.listeners,
    count: docTarget.count,
  });
  Object.defineProperty(FakeDocument.prototype, 'hidden', {
    configurable: true,
    get() { return hidden; },
  });
  Object.defineProperty(FakeDocument.prototype, 'visibilityState', {
    configurable: true,
    get() { return hidden ? 'hidden' : 'visible'; },
  });

  const doc = new FakeDocument();
  const win = fakeTarget();
  const nativeRaf = fakeRaf();
  const pipRaf = fakeRaf();
  const pipWin = { innerWidth: 800, innerHeight: 450, requestAnimationFrame: pipRaf.request, cancelAnimationFrame: pipRaf.cancel };

  win.requestAnimationFrame = nativeRaf.request;
  win.cancelAnimationFrame = nativeRaf.cancel;
  win.documentPictureInPicture = { window: pipWin };
  delete win.__sepWinEventGate;

  globalThis.window = win;
  globalThis.document = doc;
  globalThis.Document = FakeDocument;

  return {
    win, doc, nativeRaf, pipRaf, pipWin,
    setHidden(v) { hidden = !!v; },
    get hidden() { return hidden; },
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('隐藏期间可见性事件被拦在 window 捕获阶段，关掉后恢复放行', (t) => {
  const dom = makeDom();
  dom.setHidden(true);
  const seen = [];
  dom.doc.addEventListener('visibilitychange', () => seen.push('document'));

  assert.equal(sepWinEventGate(true), 'installed');
  t.after(() => sepWinEventGate(false));

  assert.equal(dispatchVisibility(dom.win, dom.doc, 'visibilitychange'), false);
  assert.deepEqual(seen, [], '站点在 document 上的处理器不该收到事件');

  sepWinEventGate(false);
  assert.equal(dispatchVisibility(dom.win, dom.doc, 'visibilitychange'), true);
  assert.deepEqual(seen, ['document'], '关掉闸门后事件照常送达');
});

test('隐藏期间 document.hidden / visibilityState 固定回答可见，关掉后还原', (t) => {
  const dom = makeDom();
  dom.setHidden(true);
  sepWinEventGate(true);
  t.after(() => sepWinEventGate(false));

  assert.equal(globalThis.document.hidden, false);
  assert.equal(globalThis.document.visibilityState, 'visible');

  sepWinEventGate(false);
  assert.equal(globalThis.document.hidden, true);
  assert.equal(globalThis.document.visibilityState, 'hidden');
});

test('隐藏期间 rAF 由 PiP 窗口的帧驱动，不再依赖原生帧', (t) => {
  const dom = makeDom();
  dom.setHidden(true);
  sepWinEventGate(true);
  t.after(() => sepWinEventGate(false));

  const frames = [];
  const loop = () => {
    frames.push(1);
    if (frames.length < 3) globalThis.window.requestAnimationFrame(loop);
  };
  globalThis.window.requestAnimationFrame(loop);

  const stats = globalThis.window.__sepWinEventGate.stats();
  assert.equal(stats.hidden, true, '闸门应当看到真实的隐藏状态');
  assert.equal(stats.pumping, true, '隐藏时应当切到 PiP 帧泵');
  assert.equal(dom.nativeRaf.pending.size, 0, '隐藏时不该把回调交给原生帧时钟');

  dom.pipRaf.flush();
  assert.equal(frames.length, 1);
  dom.pipRaf.flush();
  dom.pipRaf.flush();
  assert.equal(frames.length, 3, '自身的 rAF 循环应当继续逐帧前进');
  assert.equal(globalThis.window.__sepWinEventGate.stats().pending, 0);

  // 原生帧时钟在隐藏标签页里根本不跑：验证它确实没参与。
  dom.nativeRaf.flush();
  assert.equal(frames.length, 3);
});

test('可见时 rAF 与原生气质一致（不排队、不接管）', (t) => {
  const dom = makeDom();
  sepWinEventGate(true);
  t.after(() => sepWinEventGate(false));

  let ran = 0;
  const id = globalThis.window.requestAnimationFrame(() => ran++);
  assert.equal(typeof id, 'number');
  assert.equal(dom.nativeRaf.pending.size, 1, '可见时应直接交给原生帧时钟');
  assert.equal(globalThis.window.__sepWinEventGate.stats().pumping, false);

  dom.nativeRaf.flush();
  assert.equal(ran, 1);
});

test('关掉闸门时把排队中的回调交回原生帧时钟', (t) => {
  const dom = makeDom();
  dom.setHidden(true);
  sepWinEventGate(true);
  t.after(() => sepWinEventGate(false));

  let ran = 0;
  globalThis.window.requestAnimationFrame(() => ran++);
  assert.equal(ran, 0);

  sepWinEventGate(false);
  assert.equal(globalThis.window.requestAnimationFrame, dom.win.requestAnimationFrame);
  dom.nativeRaf.flush();
  assert.equal(ran, 1, '被泵住的那一帧不该丢失');
});

test('cancelAnimationFrame 能同时取消自发的 id 与闸门前拿到的原生 id', (t) => {
  const dom = makeDom();
  dom.setHidden(true);
  sepWinEventGate(true);
  t.after(() => sepWinEventGate(false));

  let ran = 0;
  const id = globalThis.window.requestAnimationFrame(() => ran++);
  globalThis.window.cancelAnimationFrame(id);
  dom.pipRaf.flush();
  assert.equal(ran, 0);

  // 闸门装上之前拿到的原生 id 也要能取消
  const legacy = dom.nativeRaf.request(() => ran++);
  globalThis.window.cancelAnimationFrame(legacy);
  dom.nativeRaf.flush();
  assert.equal(ran, 0);
});

test('注入两次只切开关，不会叠加监听器', async (t) => {
  const dom = makeDom();
  dom.setHidden(true);
  assert.equal(sepWinEventGate(true), 'installed');
  t.after(() => sepWinEventGate(false));
  const before = dom.win.count('visibilitychange');

  assert.equal(sepWinEventGate(true), 'toggled:on');
  assert.equal(dom.win.count('visibilitychange'), before);

  sepWinEventGate(false);
  assert.equal(dom.win.count('visibilitychange'), 0);
  await sleep(10);
});
