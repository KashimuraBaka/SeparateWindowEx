# Separate Window (Chrome/Edge extension, Manifest V3)

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
