/**
 * 选中解析与整页缩放的单元测试。
 *
 * 这两块都是纯 DOM 逻辑，用最小假 DOM 就能覆盖：
 *   - 透明拦截层（验证码浮层）不该被选中，命中测试要穿透到下面的真实元素；
 *   - 光标下有 <video> 但命中的是它上面的浮层时，取视频外面那层播放器容器；
 *     点视频本体时保持原行为（只镜像视频）；
 *   - 整页模式只按宽度缩放，放得下时不缩。
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

const { TargetResolver } = bundle('src/entrypoints/content/selection.ts', 'selection');
const { WholePageFitter } = bundle('src/entrypoints/content/wholePage.ts', 'wholepage');

/** 造一个元素；styles 决定它是不是"幽灵层"。 */
function el(tagName, { style = {}, rect = { width: 100, height: 100 }, id = '', parent = null, children = [] } = {}) {
  const node = {
    nodeType: 1,
    tagName: tagName.toUpperCase(),
    id,
    parentElement: parent,
    children,
    style: {},
    contains(other) {
      let cur = other;
      while (cur) {
        if (cur === node) return true;
        cur = cur.parentElement;
      }
      return false;
    },
    getBoundingClientRect() {
      return { left: 0, top: 0, width: rect.width, height: rect.height, right: rect.width, bottom: rect.height };
    },
    // 只按测试里塞进来的 __query 列表判断"有没有弹幕层"
    querySelector(sel) {
      const list = node.__query || [];
      const parts = sel.split(',').map((x) => x.trim());
      for (const cand of list) {
        const cls = String(cand.className || '');
        for (const part of parts) {
          if (part.startsWith('[class*=')) {
            const want = part.replace(/^\[class\*="?/, '').replace(/"?\]$/, '');
            if (cls.includes(want)) return cand;
            continue;
          }
          if (cls.split(' ').includes(part.replace(/^\./, ''))) return cand;
        }
      }
      return null;
    },
    __style: style,
  };
  return node;
}

/** 假文档：只实现解析逻辑用到的那几个 API。 */
function fakeDoc({ body, docEl, stack }) {
  const view = {
    getComputedStyle(node) {
      const s = node.__style || {};
      return {
        display: s.display || 'block',
        visibility: s.visibility || 'visible',
        opacity: s.opacity === undefined ? '1' : String(s.opacity),
      };
    },
  };
  return {
    body,
    documentElement: docEl,
    defaultView: view,
    elementFromPoint: () => stack[0],
    elementsFromPoint: () => stack.slice(),
  };
}

function scene() {
  const body = el('body');
  const docEl = el('html');
  const player = el('div', { rect: { width: 672, height: 378 } });
  const video = el('video', { rect: { width: 672, height: 378 }, parent: player });
  player.children = [video];
  const ghost = el('div', { style: { opacity: 0 }, rect: { width: 672, height: 378 }, parent: body });
  const overlay = el('div', { rect: { width: 672, height: 378 }, parent: player });
  return { body, docEl, player, video, ghost, overlay };
}

test('不可见浮层不算目标，命中测试穿透到下面的真实元素', () => {
  const s = scene();
  const doc = fakeDoc({ body: s.body, docEl: s.docEl, stack: [s.ghost, s.player, s.body, s.docEl] });
  const resolver = new TargetResolver(doc);
  assert.equal(resolver.isGhostLayer(s.ghost), true);
  assert.equal(resolver.isGhostLayer(s.player), false);
  assert.equal(resolver.fromPoint(10, 10), s.player);
});

test('零尺寸元素也算幽灵层', () => {
  const s = scene();
  const doc = fakeDoc({ body: s.body, docEl: s.docEl, stack: [s.ghost] });
  const resolver = new TargetResolver(doc);
  const tiny = el('div', { rect: { width: 0, height: 0 } });
  assert.equal(resolver.isGhostLayer(tiny), true);
});

test('点在被浮层盖住的播放器上时，选中视频外面那层容器', () => {
  const s = scene();
  const doc = fakeDoc({ body: s.body, docEl: s.docEl, stack: [s.overlay, s.video, s.player, s.body] });
  const resolver = new TargetResolver(doc);
  assert.equal(resolver.resolve(10, 10, s.overlay), s.player);
});

test('点在视频本体上时保持原行为（只镜像视频）', () => {
  const s = scene();
  const doc = fakeDoc({ body: s.body, docEl: s.docEl, stack: [s.video, s.player, s.body] });
  const resolver = new TargetResolver(doc);
  assert.equal(resolver.resolve(10, 10, s.video), s.video);
});

test('普通元素原样返回', () => {
  const s = scene();
  const plain = el('div', { parent: s.body });
  const doc = fakeDoc({ body: s.body, docEl: s.docEl, stack: [plain, s.body, s.docEl] });
  const resolver = new TargetResolver(doc);
  assert.equal(resolver.resolve(10, 10, plain), plain);
});

test('命中测试期间会收起并恢复扩展自己的覆盖层', () => {
  const s = scene();
  const doc = fakeDoc({ body: s.body, docEl: s.docEl, stack: [s.player, s.body] });
  const calls = [];
  const resolver = new TargetResolver(doc, {
    hideOverlay: () => calls.push('hide'),
    showOverlay: () => calls.push('show'),
  });
  resolver.fromPoint(1, 1);
  assert.deepEqual(calls, ['hide', 'show']);
});

test('整页模式只按宽度缩放：放不下才缩，放得下不缩', () => {
  const body = { style: {}, scrollWidth: 1080, offsetWidth: 1080 };
  const wide = new WholePageFitter({ innerWidth: 540 });
  assert.equal(wide.fit(body), 0.5);
  assert.equal(body.style.zoom, '0.5');

  body.style.zoom = '';
  const roomy = new WholePageFitter({ innerWidth: 1600 });
  assert.equal(roomy.fit(body), 1);
  assert.equal(body.style.zoom, '');

  roomy.reset(body);
  assert.equal(body.style.zoom, '');
  assert.equal(roomy.currentScale, 1);
});

test('给了搬动前量到的宽度时，以它为准（搬进 PiP 之后量到的值不可信）', () => {
  // 搬进 PiP 后量到的失真值：480 宽、三万多高
  const body = { style: {}, scrollWidth: 480, offsetWidth: 480 };
  const fitter = new WholePageFitter({ innerWidth: 984 });
  // 页面原本是 1080 宽：窗口 984 放不下 → 缩到 984/1080 ≈ 0.911
  const scale = fitter.fit(body, 1080);
  assert.equal(scale, 984 / 1080);
  assert.equal(parseFloat(body.style.zoom).toFixed(4), (984 / 1080).toFixed(4));

  // 自然宽度比窗口窄时不该缩
  const roomy = new WholePageFitter({ innerWidth: 1600 });
  assert.equal(roomy.fit(body, 1080), 1);
  assert.equal(body.style.zoom, '');
});

test('点视频时优先选"除了视频还装着别的图层"的容器，这样弹幕/控件能跟着弹出', () => {
  const s = scene();
  // 容器里除了 <video> 还有一个图层（弹幕/控件/浮层都算）——
  // 判定只看结构，不认任何站点类名。
  const dm = el('div', { rect: { width: 672, height: 378 }, parent: s.player });
  s.player.children = [s.video, dm];
  const doc = fakeDoc({ body: s.body, docEl: s.docEl, stack: [s.video, s.player, s.body] });
  const resolver = new TargetResolver(doc);
  assert.equal(resolver.playerHostFor(s.video), s.player);
});

test('容器只有一个孩子（纯壳）时返回 null，退回"只镜像视频"', () => {
  const s = scene();
  const doc = fakeDoc({ body: s.body, docEl: s.docEl, stack: [s.video, s.player, s.body] });
  const resolver = new TargetResolver(doc);
  assert.equal(resolver.playerHostFor(s.video), null);
});

test('容器里没有弹幕层时返回 null（退回"只镜像视频"）', () => {
  const s = scene();
  const doc = fakeDoc({ body: s.body, docEl: s.docEl, stack: [s.video, s.player, s.body] });
  const resolver = new TargetResolver(doc);
  assert.equal(resolver.playerHostFor(s.video), null);
  assert.equal(resolver.playerHostFor(null), null);
});