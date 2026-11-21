/**
 * 内容脚本入口。
 *
 * import 顺序沿用原来 manifest 里的加载顺序：有几个模块在加载时就要注册监听，
 * 而 `mainApp` 末尾还有顶层语句（`Bookmarks.getHash()`、`__AppPanel._initCfg()`、
 * DOMContentLoaded 注册），所以它必须最后求值。
 *
 * `player.ts` 故意不在这个图里：它同时会被注入到播放器 iframe，和 `iframe.ts` 一起
 * 在 frame 世界里运行，那里存在同名但不同实现的助手。构建时会把它追加进内容脚本。
 */
import './runtime';
import './elements';
import './common';
import './communication';
import './icon';
import './newWindow';
import './mainApp';

// 最小诊断钩子（不是旧版那种逐模块全局桥）：让自动化测试能驱动真实入口，
// 同时不必把每个模块都挂回 window。
import { use } from './runtime';
(window as any).__sepWin = {
	start: () => use('__AppPanel').start(),
	stop: () => use('__AppPanel').stop(),
	selector: () => use('__AppPanel').selector,
	setMode: (pip: boolean) => { use('__AppPanel').cfg.useDocPip = !!pip; },
};
