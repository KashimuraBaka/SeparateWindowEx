/**
 * 扩展构建入口 —— 唯一构建命令就是 `vite build`。
 *
 * 参照当前主流的 Vite 扩展工程形态：
 *   - WXT（github.com/wxt-dev/wxt）：`src/entrypoints/` 下一个入口一个文件，产物名固定；
 *   - vite-plugin-web-extension：以清单为唯一事实源，清单里列出的脚本逐个构建，
 *     `manifest.json` 原样拷贝。
 *
 * 本项目有两处与普通 Vite 应用不同，都在这里处理：
 *   1. 内容脚本、frame 助手和运行时注入的 player 都不能是 ES module，因此打成 IIFE；
 *      其中 frame 助手只做转译（不包裹），保证它的顶层声明仍是全局的，注入的 player
 *      脚本要靠它取 SendCmd 等函数。
 *   2. CSS 在运行时按 URL 引用（`css/panel.css` 等），清单里写的也是固定路径，
 *      所以所有产物都不加 hash。
 *
 * 构建模式：`vite build`（压缩）、`--mode development`（可读）、
 *          `--mode obfuscate`（字符串数组混淆，符合 MV3 的 CSP）。
 */
import { defineConfig } from 'vite';
import { minify as terserMinify } from 'terser';
import * as sass from 'sass';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = __dirname;
const SRC = path.join(ROOT, 'src');
const PUBLIC = path.join(ROOT, 'public');
const DIST = path.join(ROOT, 'dist');
const VIRTUAL_ENTRY = 'virtual:sepwin';

type OutputKind = 'bundle' | 'classic';
type BuildMode = 'dev' | 'min' | 'obf';

/**
 * dist/js/ 下每个产物的来源。`classic` 表示只转译、不包裹：顶层声明保持全局，
 * 因为注入到 frame 的 player 脚本是按名字在 frame 的全局对象上找函数的。
 */
const OUTPUTS: Array<{ name: string; entry: string; kind: OutputKind }> = [
  { name: 'background', entry: 'entrypoints/background/index.ts', kind: 'bundle' },
  { name: 'content', entry: 'entrypoints/content/index.ts', kind: 'bundle' },
  { name: 'player', entry: 'entrypoints/injected/player.ts', kind: 'bundle' },
  { name: 'popup', entry: 'entrypoints/popup/index.ts', kind: 'classic' },
  { name: 'iframe', entry: 'entrypoints/injected/iframe.ts', kind: 'classic' },
  // 页面主世界的可见性闸门：成对注入（装上 / 拆掉），见 entrypoints/injected/gateOn.ts
  { name: 'gateOn', entry: 'entrypoints/injected/gateOn.ts', kind: 'bundle' },
  { name: 'gateOff', entry: 'entrypoints/injected/gateOff.ts', kind: 'bundle' },
];

// 属性改名必须避开的名称：一是跨文件/跨上下文的协议字段（消息封装、chrome.* 参数、
// 配置结构），二是源码里同时以字符串形式出现的标识符 —— 命令派发靠查表
// `cmdFromTab[request.cmd]`，存储键也是字符串，被改名就调不到了。
const EXPLICIT_RESERVED = [
  // 消息封装
  'cmd', 'arg', 'req', 'answer', 'response',
  // 站点记录结构
  'css', 'name', 'size', 'icon', 'icons', 'hideIcons',
  // 配置项（弹窗与后台共享并持久化）
  'cfg', 'settings', 'isDuplicate', 'isCopy', 'isFocus', 'position',
  'showAdvSettings', 'hideAllIcon', 'useDocPip', 'mediaClassic', 'modeVersion',
  'entireTab', 'auto', 'avLeft', 'avTop', 'avWidth', 'avHeight',
  // 命令参数
  'selector', 'prop', 'value', 'index', 'url', 'title', 'parentId',
  'data', 'on', 'w', 'h', 'show',
  // 标签页记账
  'tabId', 'winId', 'dupId', 'newWinId',
  // chrome.* 的参数对象
  'focused', 'state', 'autoDiscardable', 'windowId', 'frameIds', 'allFrames',
  'left', 'top', 'width', 'height', 'type', 'incognito',
  // chrome.tabs.query / windows.getAll 的查询条件（弹窗里用到）
  'active', 'currentWindow', 'lastFocusedWindow', 'highlighted', 'pinned', 'audible', 'selected', 'discarded', 'mutedInfo',
  // 自动化冒烟测试用的诊断钩子
  '__sepWin', 'start', 'stop', 'setMode',
  // 页面主世界里的可见性闸门：后台注入、页面侧实现，名字两边都要认得
  '__sepWinEventGate', 'stats', 'pumping',
  // chrome.scripting.executeScript 的参数名。这几个只在字面量里出现一次，属性改名会
  // 连它们一起改掉 —— 症状极其隐蔽：注入请求里没有 func/world，扩展看起来一切正常，
  // 页面主世界里其实什么都没发生（曾经的"弹幕停住"就是这么来的）。
  'func', 'args', 'world', 'files', 'injectImmediately',
];

/** 扫描源码里所有以字符串出现的合法标识符，加入保留名单。 */
function collectQuotedNames(): string[] {
  const names = new Set<string>();
  const idRe = /^[A-Za-z_$][\w$]*$/;
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(p); continue; }
      if (!p.endsWith('.ts') && !p.endsWith('.json')) continue;
      const text = fs.readFileSync(p, 'utf8');
      const re = /'([^'\\\n]{1,40})'|"([^"\\\n]{1,40})"/g;
      let m;
      while ((m = re.exec(text))) {
        const v = m[1] || m[2];
        if (v && idRe.test(v)) names.add(v);
      }
    }
  };
  walk(SRC);
  return [...names];
}

/** 原样拷贝目录（跳过需要编译的 .ts / .scss）。 */
function copyStatic(from: string, to: string): void {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const f = path.join(from, entry.name);
    const t = path.join(to, entry.name);
    if (entry.isDirectory()) copyStatic(f, t);
    else if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.scss')) fs.copyFileSync(f, t);
  }
}

/** 删掉只为存放源码而存在的空目录（它们的内容是编译产物，不是拷贝过去的）。 */
function pruneEmptyDirs(dir: string): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const p = path.join(dir, entry.name);
    pruneEmptyDirs(p);
    if (fs.readdirSync(p).length === 0) fs.rmdirSync(p);
  }
}

/** 按 kind 生成一个产物文件的内容。 */
async function buildScript({ entry, kind }: { entry: string; kind: OutputKind }): Promise<string> {
  const esbuild = await import('esbuild');
  if (kind === 'classic') {
    // 只转译：保留顶层声明为全局
    const source = fs.readFileSync(path.join(SRC, entry), 'utf8');
    const out = await esbuild.transform(source, { loader: 'ts', target: 'es2020' });
    return out.code.replace(/^"use strict";\r?\n/, '');
  }
  const result = await esbuild.build({
    entryPoints: [path.join(SRC, entry)],
    bundle: true,
    write: false,
    format: 'iife',
    target: 'es2020',
    platform: 'browser',
    logLevel: 'silent',
  });
  return result.outputFiles[0].text.replace(/^"use strict";\r?\n/, '');
}

/** 编译 SCSS：文件名保持不变，运行时按 URL 引用。 */
function buildStyles() {
  const cssDir = path.join(SRC, 'css');
  const outDir = path.join(DIST, 'css');
  fs.mkdirSync(outDir, { recursive: true });
  for (const file of fs.readdirSync(cssDir)) {
    if (!file.endsWith('.scss')) continue;
    const { css } = sass.compile(path.join(cssDir, file), { style: 'expanded' });
    fs.writeFileSync(path.join(outDir, file.replace(/\.scss$/, '.css')), css);
  }
}

/** 压缩 / 混淆：按模式处理单个产物。 */
async function postProcess(file: string, reserved: string[], mode: BuildMode): Promise<{ before: number; after: number }> {
  const p = path.join(DIST, 'js', file);
  const code = fs.readFileSync(p, 'utf8');
  if (mode === 'dev') return { before: code.length, after: code.length };
  let out;
  if (mode === 'obf') {
    const JavaScriptObfuscator = require('javascript-obfuscator');
    out = JavaScriptObfuscator.obfuscate(code, {
      target: 'browser',
      compact: true,
      stringArray: true,
      stringArrayThreshold: 0.75,
      stringArrayRotate: true,
      stringArrayShuffle: true,
      stringArrayWrappersCount: 2,
      stringArrayWrappersType: 'function',
      splitStrings: false,
      // 下面这些会生成 eval / new Function，MV3 的 CSP 直接拒绝，必须保持关闭
      selfDefending: false,
      debugProtection: false,
      controlFlowFlattening: false,
      deadCodeInjection: false,
      identifierNamesGenerator: 'hexadecimal',
      // 跨文件全局名要保留（内容脚本与后台靠这些名字互相调用）
      renameGlobals: false,
      sourceMap: false,
    }).getObfuscatedCode();
  } else {
    const res = await terserMinify(code, {
      ecma: 2020,
      compress: { passes: 2 },
      mangle: { toplevel: false, properties: { reserved } },
      format: { comments: false },
    });
    out = res.code;
  }
  fs.writeFileSync(p, out);
  return { before: Buffer.byteLength(code), after: Buffer.byteLength(out) };
}

/**
 * 压缩后的协议名守卫。
 *
 * `files` / `world` 这类名字只在 chrome.scripting 的调用字面量里出现一次，
 * 属性改名会把它们一起改掉，而 chrome 对认不出的键是"静默忽略"：
 * 注入请求照发、回调照回、扩展一切正常，只是页面主世界里什么都没发生。
 * 这条静默失败曾经让可见性拦截完全不生效（弹幕因此在切走标签页后停住），
 * 所以压缩之后必须回来核对一遍。
 *
 * 两种产物形态都要认：压缩后是 `files:` 这样的键；混淆后字符串进了数组，
 * 变成 `'files'`（数组定义在同一个文件里，运行期仍然正确）。
 */
const MUST_SURVIVE: Record<string, string[]> = {
  'background.js': ['files', 'world'],
};

/** 这些产物是注入用的入口，缺了功能会静默失效，所以构建时核对它们的清单。 */
const REQUIRED_OUTPUTS = ['gateOn.js', 'gateOff.js'];

function assertProtocolNames(): void {
  const problems: string[] = [];
  for (const [file, keys] of Object.entries(MUST_SURVIVE)) {
    const p = path.join(DIST, 'js', file);
    if (!fs.existsSync(p)) { problems.push(`${file} 不存在`); continue; }
    const code = fs.readFileSync(p, 'utf8');
    for (const key of keys) {
      /* 压缩后是 `files:` 这样的键；混淆后字符串进了数组（同一个文件内自洽） */
      const ok = code.indexOf(key + ':') !== -1
        || code.indexOf(`'${key}'`) !== -1
        || code.indexOf(`"${key}"`) !== -1;
      if (!ok) problems.push(`${file} 里 ${key} 不见了（可能被改名）`);
    }
  }
  for (const file of REQUIRED_OUTPUTS) {
    if (!fs.existsSync(path.join(DIST, 'js', file))) problems.push(`${file} 没有产出`);
  }
  if (problems.length) {
    throw new Error('属性改名/产物缺失，跨上下文协议可能已经失效：\n  ' + problems.join('\n  '));
  }
}

/** 完整构建：清理 → 拷贝静态资源 → 各入口产物 → CSS → 压缩/混淆。 */
async function build(mode: BuildMode): Promise<void> {
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });
  // 按 Vite 惯例，public/ 原样拷贝到输出根（图标、popup.html、语言包）；
  // src/ 只贡献 manifest.json，代码与样式都是编译出来的。
  copyStatic(PUBLIC, DIST);
  copyStatic(SRC, DIST);
  pruneEmptyDirs(DIST);
  fs.mkdirSync(path.join(DIST, 'js'), { recursive: true });

  for (const output of OUTPUTS) {
    const code = await buildScript(output);
    fs.writeFileSync(path.join(DIST, 'js', output.name + '.js'), code);
  }

  buildStyles();

  const reserved = [...EXPLICIT_RESERVED, ...collectQuotedNames()];
  const files = fs.readdirSync(path.join(DIST, 'js')).filter((f) => f.endsWith('.js'));
  let before = 0;
  let after = 0;
  for (const file of files) {
    const r = await postProcess(file, reserved, mode);
    before += r.before;
    after += r.after;
    if (mode !== 'dev') console.log(`  ${file}: ${r.before} -> ${r.after}`);
  }
  if (mode !== 'dev') console.log(`  total ${before} -> ${after} bytes`);
  assertProtocolNames();
  console.log(`Built dist/ (${mode}): ${files.length} JS, ${fs.readdirSync(path.join(DIST, 'css')).length} CSS`);
}

export default defineConfig(({ mode }) => {
  const buildMode = mode === 'development' ? 'dev' : mode === 'obfuscate' ? 'obf' : 'min';
  return {
    publicDir: false, // 静态资源由下面的插件按扩展布局拷贝，不需要 Vite 再处理一遍
    build: {
      write: false, // 扩展的目录布局由插件自己写盘
      emptyOutDir: false,
      minify: false,
      target: 'es2020',
      rollupOptions: {
        input: VIRTUAL_ENTRY,
        output: { entryFileNames: 'chunk.js' },
      },
    },
    plugins: [
      {
        // Vite 需要一个入口，但扩展产物完全由下面的构建步骤写出，这里只放一个空模块占位。
        name: 'sepwin-virtual-entry',
        resolveId(id) {
          return id === VIRTUAL_ENTRY ? '\0' + VIRTUAL_ENTRY : null;
        },
        load(id) {
          return id === '\0' + VIRTUAL_ENTRY ? 'export default 1;' : null;
        },
      },
      {
        name: 'sepwin-extension',
        async buildStart() {
          await build(buildMode);
        },
        generateBundle(_options, bundle) {
          // 丢弃 Rollup 的产物，dist/ 已由 build() 写好
          for (const key of Object.keys(bundle)) delete bundle[key];
        },
      },
    ],
  };
});