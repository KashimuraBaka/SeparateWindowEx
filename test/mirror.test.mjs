/**
 * VideoMirror 的单元测试（`node --test`）。
 *
 * 这个类的职责只有一个：按宿主窗口的帧时钟把 `<video>` 的当前帧画到画布上。
 * 所以测试也只关心这几件事 —— 每个 rAF 画一次、没有画面时不画、后备尺寸按窗口
 * 收敛、停了就不再画、rAF 停摆时兜底定时器要补帧、绘制抛错时要停下并计数。
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

// 可控时钟：VideoMirror 用 Date.now 判断"窗口尺寸稳定多久了"，拖动窗口的防抖
// 就是靠它。测试里把时钟拨快，才能验证"稳定 120ms 后才重算后备尺寸"。
let fakeNow = 0;
Date.now = () => fakeNow;

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

const { VideoMirror } = bundle('src/entrypoints/content/mirror.ts', 'mirror');

/** 可手动驱动的帧宿主：raf/interval 都由测试自己泵。 */
function fakeHost({ innerWidth = 1080, innerHeight = 1000, dpr = 1 } = {}) {
  const rafs = new Map();
  const intervals = new Map();
  const timers = new Map();
  let nextId = 1;
  return {
    innerWidth,
    innerHeight,
    devicePixelRatio: dpr,
    requestAnimationFrame(cb) {
      const id = nextId++;
      rafs.set(id, cb);
      return id;
    },
    cancelAnimationFrame(id) {
      rafs.delete(id);
    },
    setInterval(cb, ms) {
      const id = nextId++;
      intervals.set(id, { cb, ms });
      return id;
    },
    clearInterval(id) {
      intervals.delete(id);
    },
    setTimeout(cb, ms) {
      const id = nextId++;
      timers.set(id, { cb, ms });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    /** 触发所有待执行的 setTimeout（用于验证防抖后的重算）。 */
    tickTimers() {
      const pending = [...timers.entries()];
      timers.clear();
      for (const [, t] of pending) t.cb();
    },
    /** 推进假时钟：防抖按 Date.now 判断"尺寸稳定多久了"。 */
    advanceClock(ms) {
      fakeNow += ms;
    },
    /** 泵一帧 */
    frame() {
      fakeNow += 7; // 模拟一帧的时间，让依赖 Date.now 的逻辑（防抖/帧龄）有推进
      const pending = [...rafs.entries()];
      rafs.clear();
      for (const [, cb] of pending) cb(16);
      return pending.length;
    },
    frames(n = 1) {
      for (let i = 0; i < n; i++) this.frame();
    },
    /** 泵兜底定时器一次 */
    tickIntervals() {
      fakeNow += 130; // 兜底定时器 60ms 一跳；拨过 120ms 才会真正补帧
      for (const [, it] of intervals) it.cb();
    },
    get rafCount() {
      return rafs.size;
    },
    get intervalCount() {
      return intervals.size;
    },
  };
}

function fakeCanvas() {
  const cv = {
    width: 300,
    height: 150,
    draws: 0,
    ctx: null,
    getContext() {
      if (!cv.ctx) {
        cv.ctx = {
          drawImage() {
            cv.draws += 1;
            if (cv.throwOnDraw) throw new Error('draw failed');
          },
        };
      }
      return cv.ctx;
    },
  };
  return cv;
}

function fakeVideo(width = 1280, height = 720) {
  return { videoWidth: width, videoHeight: height, currentTime: 0, paused: false };
}

test('每个动画帧画一次', () => {
  const host = fakeHost();
  const view = fakeCanvas();
  const mirror = new VideoMirror(host, fakeVideo(), view);
  mirror.start();
  host.frames(10);
  assert.equal(view.draws, 10);
  assert.equal(mirror.frames, 10);
  mirror.stop();
});

test('没有画面尺寸时不画', () => {
  const host = fakeHost();
  const view = fakeCanvas();
  const mirror = new VideoMirror(host, fakeVideo(0, 0), view);
  mirror.start();
  host.frames(5);
  assert.equal(view.draws, 0);
  mirror.stop();
});

test('后备尺寸按窗口宽 × 像素比收敛', () => {
  const host = fakeHost({ innerWidth: 600, dpr: 1 });
  const view = fakeCanvas();
  const mirror = new VideoMirror(host, fakeVideo(1920, 1080), view);
  mirror.start();
  host.frames(1);
  assert.equal(view.width, 600);
  assert.equal(view.height, 338); // 600 / 1920 * 1080 ≈ 337.5 → 338
  mirror.stop();
});

test('源比窗口窄时按窗口等比放大（一次重采样，不做二次拉伸）', () => {
  const host = fakeHost({ innerWidth: 1920, innerHeight: 1000, dpr: 1 });
  const view = fakeCanvas();
  const mirror = new VideoMirror(host, fakeVideo(1280, 720), view);
  mirror.start();
  host.frames(1);
  // fit = min(1920/1280, 1000/720) = 1.389 → 1778×1000
  assert.equal(view.width, 1778);
  assert.equal(view.height, 1000);
  mirror.stop();
});

test('stop 之后不再画、也不再挂新的帧', () => {
  const host = fakeHost();
  const view = fakeCanvas();
  const mirror = new VideoMirror(host, fakeVideo(), view);
  mirror.start();
  host.frames(2);
  mirror.stop();
  const before = view.draws;
  host.frames(5);
  assert.equal(view.draws, before);
  assert.equal(mirror.running, false);
  assert.equal(host.rafCount, 0);
  assert.equal(host.intervalCount, 0);
});

test('rAF 停摆时兜底定时器补帧', () => {
  const host = fakeHost();
  const view = fakeCanvas();
  const mirror = new VideoMirror(host, fakeVideo(), view);
  mirror.start();
  assert.equal(view.draws, 0);
  host.tickIntervals(); // 从没跑过 rAF：时间差足够大，应当补一帧
  assert.equal(view.draws, 1);
  mirror.stop();
});

test('绘制抛错时停下并计数', () => {
  const host = fakeHost();
  const view = fakeCanvas();
  view.throwOnDraw = true;
  const mirror = new VideoMirror(host, fakeVideo(), view);
  mirror.start();
  host.frame();
  assert.equal(mirror.errors, 1);
  assert.equal(mirror.running, false);
  const before = mirror.frames;
  host.frames(3);
  assert.equal(mirror.frames, before);
});

test('重启会累加计数，换源后按新分辨率重算尺寸', () => {
  const host = fakeHost({ innerWidth: 1920, innerHeight: 1000, dpr: 1 });
  const view = fakeCanvas();
  const mirror = new VideoMirror(host, fakeVideo(1280, 720), view);
  mirror.start();
  host.frames(1);
  // 1280×720 的源在 1920×1000 宿主里等比放大到 1778×1000
  assert.equal(view.width, 1778);

  mirror.bindVideo(fakeVideo(640, 360));
  mirror.restart();
  assert.equal(mirror.restarts, 1);
  host.frames(1);
  // 640×360 的源在 1920×1000 宿主里等比放大到 1778×1000
  assert.equal(view.width, 1778);
  assert.equal(view.height, 1000);
  mirror.stop();
});

test('帧率统计随绘制次数走', () => {
  const host = fakeHost();
  const view = fakeCanvas();
  const mirror = new VideoMirror(host, fakeVideo(), view);
  mirror.start();
  host.frames(3);
  assert.equal(mirror.frames, 3);
  assert.ok(mirror.rafAge >= 0);
  mirror.stop();
});

test('宿主窗口变大后，后备尺寸跟着重算（否则画面会被拉伸成马赛克）', () => {
  const host = fakeHost({ innerWidth: 600, dpr: 1 });
  const view = fakeCanvas();
  const mirror = new VideoMirror(host, fakeVideo(1920, 1080), view);
  mirror.start();
  host.frames(1);
  assert.equal(view.width, 600);
  assert.equal(view.height, 338);

  // 用户把 PiP 窗口拖大：拖动期间不重建画布（否则每帧重建缓冲会卡），
  // 尺寸稳定 120ms 后才重算一次。
  host.innerWidth = 1200;
  host.frames(1);
  assert.equal(view.width, 600, '拖动过程中不应重建后备缓冲');
  host.advanceClock(150);
  host.frames(1);
  assert.equal(view.width, 1200);
  assert.equal(view.height, 675);

  // 窗口再大也是等比铺满（高度受限）：fit = min(4000/1920, 1000/1080) = 0.926
  host.innerWidth = 4000;
  host.frames(1);
  host.advanceClock(150);
  host.frames(1);
  assert.equal(view.width, 1778);
  assert.equal(view.height, 1000);
  mirror.stop();
});