/**
 * Core store + message dispatch tests (`node --test`).
 *
 * The storage module is a straight port of the extension's legacy `Storage` object, so the
 * checks below compare it against a verbatim copy of that legacy implementation running on
 * an identical fake chrome.storage area.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
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

const { createSiteStore } = bundle('src/core/storage.ts', 'storage');
const { dispatch } = bundle('src/core/messages.ts', 'messages');

function fakeArea() {
  const data = {};
  return {
    data,
    get(keys, cb) {
      const out = {};
      const list = keys == null ? Object.keys(data) : Array.isArray(keys) ? keys : [keys];
      for (const k of list) if (Object.prototype.hasOwnProperty.call(data, k)) out[k] = data[k];
      setTimeout(() => cb(out), 0);
    },
    set(items, cb) {
      Object.assign(data, JSON.parse(JSON.stringify(items)));
      setTimeout(cb || (() => {}), 0);
    },
    remove(keys, cb) {
      for (const k of Array.isArray(keys) ? keys : [keys]) delete data[k];
      setTimeout(cb || (() => {}), 0);
    },
  };
}

// Verbatim copy of the legacy Storage object (only `_local` injected).
function legacyStore(local) {
  const Storage = {
    prop: ['css', 'name', 'icon', 'size'],
    _local: local,
    _setItems(url, items) {
      if (items.css.length == 0) this._local.remove(url);
      else { const o = {}; o[url] = items; this._local.set(o); }
    },
    saveSetting(settings) { this._local.set({ settings }); },
    getItems(url, callback) {
      const URL = this.normUrl(url);
      this._local.get(URL, (itemsObj) => {
        if (itemsObj && itemsObj.hasOwnProperty(URL)) callback(Storage.checkItems(URL, itemsObj));
        else callback(undefined);
      });
    },
    checkItems(URL, itemsObj) {
      const items = itemsObj[URL];
      if (!items.hasOwnProperty('icon')) {
        items['icon'] = [];
        for (let i = 0; i < items.css.length; i++) items.icon.push(true);
        Storage._setItems(URL, items);
      }
      return items;
    },
    addItem(url, selector, name) {
      if (selector == 'BODY') return;
      const URL = this.normUrl(url);
      this._local.get(URL, (itemObj) => {
        const items = { css: [], name: [], icon: [], size: [] };
        if (itemObj && itemObj.hasOwnProperty(URL)) {
          const existing = itemObj[URL];
          if (existing.css.indexOf(selector) !== -1) return;
          if (existing.css.length < 3) {
            existing.css.push(selector); existing.name.push(name); existing.icon.push(true); existing.size.push('{}');
          } else {
            existing.css.splice(0, 1); existing.name.splice(0, 1); existing.icon.splice(0, 1); existing.size.splice(0, 1);
            existing.css.push(selector); existing.name.push(name); existing.icon.push(true); existing.size.push('{}');
          }
          Storage._setItems(URL, existing);
          return;
        }
        items.css.push(selector); items.name.push(name); items.icon.push(true); items.size.push('{}');
        Storage._setItems(URL, items);
      });
    },
    normUrl(url) {
      const reg = /^(https?:\/\/)?([\da-z|0-9\.-]+)\.([a-z|0-9\.]{2,6})/ig;
      const m = url.match(new RegExp(reg));
      return m ? String(m) : String(url);
    },
  };
  return Storage;
}

const tick = () => new Promise((r) => setTimeout(r, 5));
const URLs = [
  'https://live.bilibili.com/5050',
  'https://live.bilibili.com/123?x=1',
  'https://example.com/a',
  'https://example.com/b',
];
const OPS = [
  [0, 'DIV#1'], [0, 'DIV#2'], [0, 'DIV#1'], [1, 'DIV#3'],
  [2, 'BODY'], [2, 'DIV#9'], [2, 'DIV#10'], [2, 'DIV#11'], [3, 'DIV#20'],
];

async function runWith(store) {
  for (const [idx, selector] of OPS) {
    store.addItem(URLs[idx], selector, '');
    await tick();
  }
}

test('site store matches the legacy Storage record for record', async () => {
  const legacyArea = fakeArea();
  const nextArea = fakeArea();
  await runWith(legacyStore(legacyArea));
  await runWith(createSiteStore(nextArea));
  assert.deepEqual(nextArea.data, legacyArea.data);
});

test('keeps at most three areas, newest last, duplicates ignored, BODY skipped', async () => {
  const area = fakeArea();
  const store = createSiteStore(area);
  await runWith(store);
  const record = area.data[store.normUrl(URLs[2])];
  assert.equal(record.css.length, 3);
  assert.equal(record.css[record.css.length - 1], 'DIV#20');
  assert.ok(!JSON.stringify(area.data).includes('BODY'));

  const fresh = createSiteStore(fakeArea());
  const dedupeArea = fakeArea();
  const dedupe = createSiteStore(dedupeArea);
  dedupe.addItem('https://probe.test/x', 'DIV#1', '');
  await tick();
  dedupe.addItem('https://probe.test/x', 'DIV#1', '');
  await tick();
  assert.equal(dedupeArea.data[dedupe.normUrl('https://probe.test/x')].css.length, 1);
  assert.ok(fresh);
});

test('saved size round-trips and an empty slot reads as undefined', async () => {
  const store = createSiteStore(fakeArea());
  store.addItem('https://probe.test/x', 'DIV#1', '');
  await tick();
  await new Promise((r) => store.getSize('https://probe.test/x', 'DIV#1', (v) => {
    assert.equal(v, undefined);
    r();
  }));
  store.saveProp('https://probe.test/x', 0, { name: 'size', value: '{"width":640,"height":360}' });
  await tick();
  await new Promise((r) => store.getSize('https://probe.test/x', 'DIV#1', (v) => {
    assert.equal(v, '{"width":640,"height":360}');
    r();
  }));
});

test('message dispatch honours cmd/arg and ignores unknown or malformed requests', () => {
  const table = { ping: () => 'pong', echo: (arg) => arg, arity: (arg) => typeof arg };
  assert.equal(dispatch(table, { cmd: 'ping' }), 'pong');
  assert.equal(dispatch(table, { cmd: 'echo', arg: 42 }), 42);
  assert.equal(dispatch(table, { cmd: 'nope' }), undefined);
  assert.equal(dispatch(table, null), undefined);
  assert.equal(dispatch(table, {}), undefined);
  assert.equal(dispatch(table, { cmd: 'arity' }), 'undefined');
});
