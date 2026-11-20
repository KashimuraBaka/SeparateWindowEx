<div align="right">

**[中文](#separate-window-chromeedge-扩展manifest-v3) · [English](#separate-window-chromeedge-extension-manifest-v3)**

</div>

---

# Separate Window（Chrome/Edge 扩展，Manifest V3）

"Separate Window" 可将网页中的任意区域——或整个 `<video>` / `<iframe>`——弹出为一个独立的置顶窗口，并自带自定义视频播放器（画中画、旋转/缩放/滤镜、倍速、全屏）。

本仓库是基于原扩展（Belousov Alexandr 开发的 v0.9.5）的 Web Store 解包版本**逆向重建**的项目，并已**迁移到 Manifest V3**，可在当前的 Chrome 和 Edge 上加载运行。

> 原始的 MV2 解包版本曾作为迁移参照，在与重建后的源码逐一核对等价后才删除。**`src/` 是真正可编辑的源码**；`dist/` 是生成的可直接加载的产物（请勿手动修改）。

---

## 目录结构

```
src/                 可编辑源码  →  构建到 dist/
  manifest.json      MV3 清单
  popup.html         工具栏弹窗页面
  js/
    background.js    后台 SERVICE WORKER（状态、消息、窗口管理、书签、
                     右键菜单、程序化注入）。MV3 中原来的三个后台文件
                     （storage.js + bg_panel.js + background.js）合并为此文件。
    popup.js         弹窗逻辑（通过消息从 worker 读取配置/历史）
    common.js        内容脚本公共辅助（CSS 注入、MutationObserver、选择器、
                     书签、复制）
    mainApp.js       内容脚本入口：区域选择 UI + 命令分发
    elements.js      选中高亮/预览元素
    icon.js          已保存选择器上的逐元素“弹出”图标
    communication.js 内容脚本<->后台 / 框架<->框架 消息
    newWindow.js     弹出窗口的界面（按钮面板、缩放、滚动、链接）
    player.js        自定义视频播放器（画中画、滤镜、倍速、全屏）
    iframe.js        注入到子框架，用于定位/修改内嵌视频/iframe
  css/  img/         样式与图片（动态或静态注入）
  _locales/en|ru     UI 文案（chrome.i18n）
tools/
  build.js           复制 src/ → dist/（未打包，可直接加载）
  validate.js        MV3 合规 + 完整性检查（见下）
  package.js         将 dist/ 打包为 zip 用于商店上传
  crx.js             将 dist/ 签名为 CRX3 包
package.json         npm 脚本
```

## 构建 / 校验 / 加载

```bash
npm run build      # src/ -> dist/（未打包扩展）
npm run validate   # 检查 dist/ 是否符合 MV3 且内部一致
npm run package    # dist/ -> Separate_Window_v<version>.zip（商店上传）
npm run crx        # dist/ -> Separate_Window_v<version>.crx（签名，用于侧载/企业部署）
npm run release    # 构建 + 校验 + zip + crx（两种产物都生成）
npm run verify     # 构建 + 校验
```

由同一份 `dist/` 产出两种分发格式：
- **`.zip`** —— 普通打包目录，用于上传到 Chrome Web Store / Edge 加载项。
- **`.crx`** —— 签名后的 CRX3 包，用于侧载或企业部署（见下）。

### CRX 签名密钥
`npm run crx` 使用 `keys/extension_key.pem` 中的私钥对 CRX 签名：
- 该密钥在首次运行时**自动生成**（RSA-2048，PKCS#8 PEM）并在之后复用，因此派生出的扩展 ID 在多次构建间保持**稳定**。打包器使用 Chrome 或 Edge 本身（自动检测；可用 `CHROME_PATH` 环境变量覆盖），由其生成当前 CRX3 格式。
- **请妥善保密并备份该密钥。** 任何持有它的人都能以同一扩展 ID 发布更新。默认已被 git 忽略。
- 若要固定某个特定扩展 ID，可用你自己的 PKCS#8 RSA 密钥替换 `keys/extension_key.pem`。

`npm run validate` 会检查（部分）：
- `manifest_version === 3`，且不含 MV2 专有清单键（`browser_action`、`background.persistent`、`key`、`update_url` 等）
- 存在 `background.service_worker`，且清单引用的所有文件（图标、action 弹窗、内容脚本、`web_accessible_resources`、`chrome.scripting` 目标）均存在
- 发行 JS 中不再残留 MV2 专有 API（`chrome.extension.*`、`chrome.tabs.executeScript`、`chrome.browserAction`、`getBackgroundPage`）—— 不计注释
- `web_accessible_resources` 使用 MV3 的 `{ resources, matches }` 对象形式
- 通过 `getMessage()` / `__MSG_` 引用的每个 i18n 键都存在于默认语言中

### 在 Chrome/Edge 中加载
- **未打包（开发）：** `npm run build`，然后打开 `chrome://extensions`（或 `edge://extensions`），开启**开发者模式**，点击**加载已解压的扩展程序** → 选择 `dist/` 目录。
- **打包（`.crx`）：** `npm run crx`，然后将生成的 `.crx` 拖入 `chrome://extensions`（或通过企业扩展安装策略部署）。

---

## 扩展功能（架构）

- **工具栏弹窗**（`popup.html`/`popup.js`）可启动区域选择、弹出整个标签页、编辑设置（保留标签页、恢复模式、焦点、隐藏图标、窗口位置/大小），并按站点显示上次使用过的区域（“历史”）。
- **内容脚本**在 `http`/`https` 页面的 `document_start` 阶段运行，绘制选择 UI。当你选中某个元素时，它会为该元素计算一个 CSS 选择器，并请求后台打开一个只显示该区域的弹窗（通过重新排版，使页面仅可见所选子树）。
- **后台 service worker** 负责所有 `chrome.*` 编排：创建/移动/恢复窗口、跟踪哪些标签页被弹出、按站点保存选择器和窗口尺寸、书签、右键菜单、截图，以及将 `player.js`/`iframe.js` 注入正确的框架。
- **视频**页面会获得自定义播放器覆盖层（`player.js`），支持画中画、旋转/缩放/亮度/对比度/饱和度/模糊滤镜、倍速和全屏。`<iframe>` 内的嵌入式播放器通过向这些框架注入 `iframe.js` 并转发消息来处理。

---

## MV2 → MV3 迁移说明

原扩展是 Manifest V2，Chrome/Edge 已不再接受。以下是必须进行的改动（均在 `src/` 中完成）：

| 方面 | MV2（原版） | MV3（本项目） |
|---|---|---|
| 清单 | `manifest_version: 2` | `manifest_version: 3` |
| 后台 | 持久化**后台页**，3 个脚本（`storage.js`、`bg_panel.js`、`background.js`） | 单一 **service worker**（`js/background.js`），已合并 |
| 工具栏 | `browser_action` / `chrome.browserAction.*` | `action` / `chrome.action.*` |
| 弹窗 ↔ 后台 | `chrome.extension.getBackgroundPage()` 直接读取 `Panel.cfg` / `Storage` | 消息（`chrome.runtime.sendMessage({req})` → `popupCmd`）+ `chrome.storage` |
| 注入 | `chrome.tabs.executeScript({file})` | `chrome.scripting.executeScript({target:{frameIds},files})` + `scripting` 权限 |
| 资源 URL | `chrome.extension.getURL()` | `chrome.runtime.getURL()` |
| 可访问资源 | 字符串数组 | `{ resources, matches }` 对象 |
| 主机访问 | `<all_urls>` 权限 | `host_permissions: ["http://*/*","https://*/*"]` |
| 商店产物 | `key`、`update_url`、`_metadata/` | 移除（商店上传时自动重新添加） |

### Service worker 的状态
service worker **没有持久的全局变量**——它可能在事件之间被挂起。MV2 后台页把活跃状态保存在全局变量里（`newTabs` = 哪些标签页被弹出，`Panel.cfg` = 设置）。现在这些状态改为：
- `newTabs` → 镜像到 `chrome.storage.session`（浏览器关闭时清除，与原来内存中的生命周期一致），并在每条命令前重新读取。
- `Panel.cfg` → 通过 `chrome.storage.local` 持久化，按需重新加载。
- 弹窗通过消息读取/更新配置，而不是直接访问后台页。

### 重建过程中修复的问题
- 补充了缺失的 `PanelSaveSize` i18n 键（英文 + 俄文）。弹出按钮面板调用了 `getMessage('PanelSaveSize')`，但原版只有 `PanelSaveSizeOff`/`PanelSaveSizeOn`，导致该按钮的提示为空。

## 说明与注意事项
- 代码尽可能贴近原版（纯 ES5、相同的文件/变量结构），以便迁移易于审阅；只做了上述 MV3 必需的改动。
- `minimum_chrome_version` 设为 `102`（MV3 + `chrome.storage.session`）。

---

## 许可证

基于 [MIT 许可证](LICENSE) 发布。

本项目是社区对 **Belousov Alexandr** 开发的原版 "Separate Window"（v0.9.5）的 Manifest V3 重建，基于其原始作品——在此致谢。MV3 迁移及配套构建工具同样以 MIT 许可贡献。

---

---

# Separate Window (Chrome/Edge extension, Manifest V3)

<a id="separate-window-chromeedge-extension-manifest-v3"></a>

"Separate Window" pops an arbitrary area of a web page — or a whole `<video>` / `<iframe>` —
out into its own always-on-top popup window, with a custom video player (picture-in-picture,
rotate/zoom/filters, playback speed, fullscreen).

This repository is a **reverse-engineered, rebuilt project** reconstructed from an unpacked Web
Store build of the original extension (v0.9.5 by Belousov Alexandr) and **migrated to Manifest
V3** so it loads and runs on current Chrome and Edge.

> The original MV2 extraction was used as the migration reference and was verified against the
> rebuilt source before being removed. **`src/` is the real, editable source**; `dist/` is the
> generated, load-ready output (do not edit by hand).

---

## Layout

```
src/                 Editable source  →  builds to dist/
  manifest.json      MV3 manifest
  popup.html         Toolbar popup page
  js/
    background.js    Background SERVICE WORKER (state, messaging, window mgmt, bookmarks,
                     context menus, programmatic injection). In MV3 the old three background
                     files (storage.js + bg_panel.js + background.js) collapse into this one.
    popup.js         Popup logic (reads config/history from the worker via messages)
    common.js        Content-script shared helpers (CSS injection, MutationObserver, selector,
                     bookmarks, duplicate)
    mainApp.js       Content-script entry: region selection UI + command dispatch
    elements.js      Selection highlight/preview element
    icon.js          Per-element "pop out" icons on previously saved selectors
    communication.js Content<->background / frame<->frame messaging
    newWindow.js     Pop-out window chrome (button panel, resize, scroll, link)
    player.js        Custom video player (PiP, filters, speed, fullscreen)
    iframe.js        Injected into sub-frames to locate/modify embedded video/iframes
  css/  img/         Styles and images (injected dynamically or statically)
  _locales/en|ru     UI strings (chrome.i18n)
tools/
  build.js           Copy src/ → dist/ (unpacked, load-ready)
  validate.js        MV3 compliance + integrity checks (see below)
  package.js         Zip dist/ for store upload
  crx.js             Sign dist/ into a CRX3 package
package.json         npm scripts
```

## Build / validate / load

```bash
npm run build      # src/ -> dist/ (unpacked extension)
npm run validate   # check dist/ is MV3-compliant & internally consistent
npm run package    # dist/ -> Separate_Window_v<version>.zip   (Web Store upload)
npm run crx        # dist/ -> Separate_Window_v<version>.crx   (signed, sideload/enterprise)
npm run release    # build + validate + zip + crx (both artifacts)
npm run verify     # build + validate
```

Two distributable formats are produced from the same `dist/`:
- **`.zip`** — the plain packaged folder, what you upload to the Chrome Web Store / Edge Add-ons.
- **`.crx`** — a signed CRX3 package for sideloading or enterprise deployment (see below).

### CRX signing key
`npm run crx` signs the CRX with a private key at `keys/extension_key.pem`:
- The key is **auto-generated** (RSA-2048, PKCS#8 PEM) on first run and reused afterwards, so the
  derived extension ID stays **stable** across builds. The packager is Chrome or Edge itself
  (auto-detected; override with the `CHROME_PATH` env var), which emits the current CRX3 format.
- **Keep the key secret and back it up.** Anyone holding it can publish updates under the same
  extension ID. It is git-ignored by default.
- To pin a specific extension ID, replace `keys/extension_key.pem` with your own PKCS#8 RSA key.

`npm run validate` verifies, among other things:
- `manifest_version === 3` and no MV2-only manifest keys (`browser_action`, `background.persistent`,
  `key`, `update_url`, …)
- a `background.service_worker` exists and all manifest-referenced files (icons, action popup,
  content scripts, `web_accessible_resources`, `chrome.scripting` targets) are present
- no MV2-only APIs remain in shipped JS (`chrome.extension.*`, `chrome.tabs.executeScript`,
  `chrome.browserAction`, `getBackgroundPage`) — comments excluded
- `web_accessible_resources` uses the MV3 `{ resources, matches }` object form
- every i18n key referenced via `getMessage()` / `__MSG_` exists in the default locale

### Load it in Chrome/Edge
- **Unpacked (development):** `npm run build`, then open `chrome://extensions` (or
  `edge://extensions`), enable **Developer mode**, and **Load unpacked** → select the `dist/` folder.
- **Packed (`.crx`):** `npm run crx`, then drag the generated `.crx` onto `chrome://extensions`
  (or deploy it via enterprise extension-install policy).

---

## What the extension does (architecture)

- **Toolbar popup** (`popup.html`/`popup.js`) lets you start region selection, pop out the
  entire tab, and edit settings (keep tab open, restore mode, focus, hide icons, window
  position/size) and shows the last used areas ("history") per site.
- **Content scripts** run on `http`/`https` pages at `document_start` and draw the selection UI.
  When you pick an element, they compute a CSS selector for it and ask the background to open a
  popup window showing just that region (the page is restyled so only the chosen subtree is
  visible).
- **Background service worker** owns all `chrome.*` orchestration: creating/moving/restoring
  windows, tracking which tabs are popped out, saving per-site selectors and window sizes,
  bookmarks, context menu, screenshots, and injecting `player.js`/`iframe.js` into the right
  frames.
- **Video** pages get a custom player overlay (`player.js`) with PiP, rotate/zoom/brightness/
  contrast/saturate/blur filters, speed, and fullscreen. Embedded players inside `<iframe>`s are
  handled by injecting `iframe.js` into those frames and relaying messages.

---

## MV2 → MV3 migration notes

The original was Manifest V2, which Chrome/Edge no longer accept. The following changes were
required (all applied in `src/`):

| Area | MV2 (original) | MV3 (this project) |
|---|---|---|
| Manifest | `manifest_version: 2` | `manifest_version: 3` |
| Background | persistent **background page**, 3 scripts (`storage.js`, `bg_panel.js`, `background.js`) | single **service worker** (`js/background.js`), merged |
| Toolbar | `browser_action` / `chrome.browserAction.*` | `action` / `chrome.action.*` |
| Popup ↔ background | `chrome.extension.getBackgroundPage()` to read `Panel.cfg` / `Storage` directly | messages (`chrome.runtime.sendMessage({req})` → `popupCmd`) + `chrome.storage` |
| Injection | `chrome.tabs.executeScript({file})` | `chrome.scripting.executeScript({target:{frameIds},files})` + `scripting` permission |
| Resource URLs | `chrome.extension.getURL()` | `chrome.runtime.getURL()` |
| Web-accessible resources | string array | `{ resources, matches }` objects |
| Host access | `<all_urls>` permission | `host_permissions: ["http://*/*","https://*/*"]` |
| Store artifacts | `key`, `update_url`, `_metadata/` | removed (re-added automatically on store upload) |

### Service-worker state
A service worker has **no persistent globals** — it can be suspended between events. The MV2
background page kept live state in globals (`newTabs` = which tabs are popped out, `Panel.cfg` =
settings). Those are now:
- `newTabs` → mirrored into `chrome.storage.session` (cleared on browser close, matching the old
  in-memory lifetime) and re-hydrated before each command.
- `Panel.cfg` → persisted via `chrome.storage.local` and reloaded on demand.
- The popup reads/updates config through messages instead of a live background page.

### Fixed during the rebuild
- Added the missing `PanelSaveSize` i18n key (en + ru). The pop-out button panel called
  `getMessage('PanelSaveSize')`, but only `PanelSaveSizeOff`/`PanelSaveSizeOn` existed, so that
  button's tooltip rendered empty.

## Notes & caveats
- The code is preserved as close to the original as possible (plain ES5, same file/variable
  structure) to keep the migration reviewable; only the MV3-required changes above were made.
- `minimum_chrome_version` is set to `102` (MV3 + `chrome.storage.session`).

---

## License

Released under the [MIT License](LICENSE).

This is a community Manifest V3 rebuild of the original "Separate Window" extension (v0.9.5) by
**Belousov Alexandr**, whose original work this project is based on — credit and thanks to him.
The MV3 migration and surrounding build tooling are contributed under the same MIT license.
