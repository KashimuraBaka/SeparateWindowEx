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
function fakeHost({ innerWidth = 1080, dpr = 1 } = {}) {
  const rafs = new Map();
  const intervals = new Map();
  let nextId = 1;
  return {
    innerWidth,
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
    /** 泵一帧 */
    frame() {
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

test('源比窗口窄时保持原始尺寸', () => {
  const host = fakeHost({ innerWidth: 1920, dpr: 1 });
  const view = fakeCanvas();
  const mirror = new VideoMirror(host, fakeVideo(1280, 720), view);
  mirror.start();
  host.frames(1);
  assert.equal(view.width, 1280);
  assert.equal(view.height, 720);
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
  const host = fakeHost({ innerWidth: 1920, dpr: 1 });
  const view = fakeCanvas();
  const mirror = new VideoMirror(host, fakeVideo(1280, 720), view);
  mirror.start();
  host.frames(1);
  assert.equal(view.width, 1280);

  mirror.bindVideo(fakeVideo(640, 360));
  mirror.restart();
  assert.equal(mirror.restarts, 1);
  host.frames(1);
  assert.equal(view.width, 640);
  assert.equal(view.height, 360);
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
