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
	// 读当前区域已保存的尺寸（排障/自动化断言用）
	savedSize: () => {
		const panel: any = use('__AppPanel');
		return panel._sizes[panel.selector] || null;
	},
	// 保存当前区域尺寸（等价于点 PiP 工具栏里的"保存尺寸"按钮）。
	// 自动化里没法点 PiP 窗口内的按钮（它没有 CDP target），用这个钩子代替。
	saveAreaSize: () => {
		const panel: any = use('__AppPanel');
		const win: any = panel._pipWin;
		if (!win || win.closed) return null;
		const key = panel.selector || (panel._pip && panel._pip.selector);
		// _pipToggleSave 是"存/清"开关；自动化里要的是"确保已保存"
		if (!panel._sizes[key]) {
			try { panel._pipToggleSave(); } catch (e) { }
		}
		return panel._sizes[key] || null;
	},	// 按整页（BODY）方式弹出：排障时用来复现"整页"那条路径。
	applyBody: () => {
		// 整页已经弹出时 document.body 是 null：直接忽略，别抛错
		const body = document.body;
		if (body) use('__AppPanel').apply(body);
		return !!body;
	},
	// 整页缩放：手动重算一次 + 读取当前状态（排障用）
	fitWhole: () => use('__AppPanel')._fitWholePage(),
	wholeState: () => {
		try {
			const panel: any = use('__AppPanel');
			const target: any = panel._pip && panel._pip.target;
			return {
				hasPip: !!panel._pipWin,
				targetTag: target ? target.tagName : null,
				scale: panel._wholeScale | 0,
				zoom: target && target.style ? (target.style.zoom || '') : null
			};
		} catch (e) {
			return null;
		}
	},
	// 镜像状态：画面是"取帧绘制"实现，frames 递增即证明绘制循环还在出帧。
	// 长跑测试靠它判断画面有没有冻住（画布可能被跨域视频污染，不能读像素）。
	pipStats: () => {
		try {
			const panel: any = use('__AppPanel');
			const view: any = panel._pipView;
			const src: any = panel._pipVideo;
			return {
				open: !!panel._pipWin,
				mirrorOn: !!panel._mirrorRunning(),
				kind: panel._mirrorKind,
				frames: panel._mirrorFrameCount(),
				fps: panel._mirror ? panel._mirror.fps : 0,
				rafAge: panel._mirror ? panel._mirror.rafAge : -1,
				idleMs: panel._mirrorIdleMs(),
				mp: panel._mirror ? { calls: panel._mirror.frames, err: panel._mirror.errors, restarts: panel._mirror.restarts } : null,
				heals: panel._heals | 0,
				mirrored: !!(view && src),
				// 打开时请求的窗口尺寸（区域大小或上次保存的尺寸），排障用
				requested: panel._pipRequested || null,
				source: src ? {
					t: Math.round(src.currentTime * 100) / 100,
					paused: !!src.paused,
					width: src.videoWidth,
					height: src.videoHeight
				} : null,
				mirror: view ? {
					tag: view.tagName,
					width: view.width,
					height: view.height,
					rectW: Math.round(view.getBoundingClientRect().width),
					rectH: Math.round(view.getBoundingClientRect().height)
				} : null
			};
		} catch (e) {
			return null;
		}
	},
};
