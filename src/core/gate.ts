/**
 * 页面主世界里的"可见性闸门"。
 *
 * 注入方式：后台把 js/gateOn.js / js/gateOff.js 注入到页面主世界
 * （`chrome.scripting.executeScript({ world: 'MAIN', files: [...] })`）。
 * 用文件而不是 `func:` 注入，是因为压缩/混淆后的函数源码序列化进页面时可能引用到
 * 文件作用域里的字符串数组；文件注入下整段代码自洽。
 * 页面主世界里没有 chrome.* 可用，所以下面只用浏览器原生 API。
 *
 * 直播播放器在页面不可见时停掉弹幕，靠的是三条彼此独立的路径，闸门逐条封住：
 *
 *   1) 事件：`document` 上的 visibilitychange / webkitvisibilitychange。
 *      哔哩哔哩直播的 room-player 就注册了三个。闸门在 **window 的捕获阶段**
 *      拦下它们 —— 按 DOM 的事件路径，window 排在 document 前面，所以站点注册得
 *      比我们早也照样收不到；至于之后才注册的监听器，更是永远等不到事件。
 *
 *   2) 轮询：直接读 `document.hidden` / `document.visibilityState`。
 *      开启期间这两个属性固定回答 false / 'visible'，用的是改在 Document.prototype
 *      上的访问器，读完即走，不留痕迹（关闭时按原描述符写回）。
 *
 *   3) 帧时钟：隐藏的标签页不再派发 requestAnimationFrame，循环一停在跑的弹幕就
 *      定格 —— 这一条不是"事件"能解决的，也是只拦事件时最常见的残留失败。
 *      页面真的隐藏时，闸门改用 Document PiP 窗口的动画帧来驱动页面排队的回调：
 *      PiP 窗口自己始终可见、帧时钟不停，于是隐藏期间页面依然逐帧前进。
 *      关掉 PiP 或闸门时，排队的回调原样交回原生帧时钟。
 *
 * 三条都只在"有东西被弹出"的期间生效，关闭时全部还原。
 */

export interface GateStats {
	on: boolean;
	pumping: boolean;
	pending: number;
	hidden: boolean;
}

export function sepWinEventGate(on: boolean): string {
	const host: any = window as any;
	/* 重复注入（换了区域、重新弹出）只会切开关，不会叠加副作用。 */
	const existing: any = host.__sepWinEventGate;
	if (existing) {
		existing.set(!!on);
		return 'toggled:' + (on ? 'on' : 'off');
	}
	if (!on) return 'absent';

	const KEY = '__sepWinEventGate';
	/* 站点判断"页面是否可见"时可能用到的所有事件类型。 */
	const EVENT_TYPES = ['visibilitychange', 'webkitvisibilitychange', 'mozvisibilitychange', 'freeze', 'resume'];
	/* 自己发号的起点：原生 rAF id 是小整数，错开才不会互相取消。 */
	const ID_BASE = 10000000;

	const docProto: any = Document.prototype;
	/* 改动前先留好原件，之后既用来读真实状态，也用来还原。 */
	const origHidden: any = Object.getOwnPropertyDescriptor(docProto, 'hidden');
	const origState: any = Object.getOwnPropertyDescriptor(docProto, 'visibilityState');

	const st: any = {
		on: false,
		events: [] as string[],
		descs: [] as any[],
		queue: new Map<number, any>(),
		seq: ID_BASE,
		nativeRaf: host.requestAnimationFrame,
		nativeCaf: host.cancelAnimationFrame,
		pumping: false,
		scheduled: false,
		frameId: 0,
		timerId: 0,
		pollId: 0,
	};

	/* 真实可见性：始终走改动前保存的 getter，绕开我们自己写的假值。 */
	function trueHidden(): boolean {
		try {
			if (origState && origState.get) return origState.get.call(document) !== 'visible';
			if (origHidden && origHidden.get) return !!origHidden.get.call(document);
		} catch (e) { /* 保持沉默：读不到就当可见，宁可多跑一帧 */ }
		return false;
	}

	/* 隐藏期间的帧来源：Document PiP 窗口。没有它就退化成定时器。 */
	function frameSource(): any {
		try {
			const dpp = host.documentPictureInPicture;
			if (dpp && dpp.window && typeof dpp.window.requestAnimationFrame === 'function') return dpp.window;
		} catch (e) { }
		return null;
	}

	function rethrow(err: any): void {
		/* 回调里的异常不该打断整帧：照原生 rAF 的做法报到全局去。 */
		setTimeout(function () { throw err; }, 0);
	}

	function fire(rec: any): void {
		if (!rec || rec.done || rec.cancelled) return;
		rec.done = true;
		st.queue.delete(rec.id);
		try {
			rec.cb(performance.now());
		} catch (err) {
			rethrow(err);
		}
	}

	function flush(): void {
		if (!st.queue.size) return;
		const list: any[] = [];
		st.queue.forEach(function (rec: any) { list.push(rec); });
		for (let i = 0; i < list.length; i++) fire(list[i]);
	}

	/* 一个帧节拍：优先用 PiP 窗口的 rAF，同时挂一个定时器兜底
	 * （PiP 被关掉、或被系统隐藏时帧可能不再来，循环不能因此断掉）。 */
	function schedule(): void {
		if (!st.pumping || st.scheduled) return;
		st.scheduled = true;
		const win = frameSource();
		const step = function (): void {
			if (!st.scheduled) return;
			st.scheduled = false;
			if (st.timerId) { clearTimeout(st.timerId); st.timerId = 0; }
			if (st.frameId) {
				try { if (win && win.cancelAnimationFrame) win.cancelAnimationFrame(st.frameId); } catch (e) { }
				st.frameId = 0;
			}
			if (!st.pumping) return;
			flush();
			if (st.queue.size) schedule();
		};
		if (win) {
			try { st.frameId = win.requestAnimationFrame(step); } catch (e) { st.frameId = 0; }
			st.timerId = setTimeout(step, 120);
		} else {
			st.timerId = setTimeout(step, 16);
		}
	}

	function startPump(): void {
		if (!st.on || st.pumping) return;
		st.pumping = true;
		/* 已经交给原生帧时钟的回调要收回来，否则它们会卡在隐藏的页面里再也不触发。 */
		st.queue.forEach(function (rec: any) {
			if (!rec.frameId) return;
			try { st.nativeCaf.call(host, rec.frameId); } catch (e) { }
			rec.frameId = 0;
		});
		schedule();
	}

	function stopPump(): void {
		if (!st.pumping) return;
		st.pumping = false;
		st.scheduled = false;
		const win = frameSource();
		if (st.timerId) { clearTimeout(st.timerId); st.timerId = 0; }
		if (st.frameId) {
			try { if (win && win.cancelAnimationFrame) win.cancelAnimationFrame(st.frameId); } catch (e) { }
			st.frameId = 0;
		}
		/* 还排着队的回调原样交回原生帧时钟。 */
		st.queue.forEach(function (rec: any) {
			if (rec.done || rec.cancelled || rec.frameId) return;
			rec.frameId = st.nativeRaf.call(host, function () { fire(rec); });
		});
	}

	function refresh(): void {
		if (trueHidden()) startPump();
		else stopPump();
	}

	function rafWrap(cb: any): number {
		if (typeof cb !== 'function') return st.nativeRaf.apply(host, arguments);
		const id = ++st.seq;
		const rec: any = { id: id, cb: cb, frameId: 0, cancelled: false, done: false };
		st.queue.set(id, rec);
		/* 可见时行为与原生完全一致；隐藏时才走泵。 */
		if (st.pumping || trueHidden()) {
			startPump();
			schedule();
		} else {
			rec.frameId = st.nativeRaf.call(host, function () { fire(rec); });
		}
		return id;
	}

	function cafWrap(id: any): void {
		const rec = st.queue.get(id);
		if (rec) {
			rec.cancelled = true;
			st.queue.delete(id);
			if (rec.frameId) {
				try { st.nativeCaf.call(host, rec.frameId); } catch (e) { }
				rec.frameId = 0;
			}
			return;
		}
		/* 闸门装上之前拿到的原生 id，原样转交。 */
		st.nativeCaf.call(host, id);
	}

	function onEvent(e: any): void {
		refresh();
		/* 关键：站点在 document 上注册的处理器一个都不许跑。 */
		if (e && e.stopImmediatePropagation) e.stopImmediatePropagation();
		if (e && e.stopPropagation) e.stopPropagation();
	}

	function enable(): void {
		if (st.on) return;
		st.on = true;
		/* 1) 可见性状态固定为"可见"。 */
		try {
			if (origHidden) {
				Object.defineProperty(docProto, 'hidden', { configurable: true, get: function () { return false; } });
				st.descs.push(['hidden', origHidden]);
			}
			if (origState) {
				Object.defineProperty(docProto, 'visibilityState', { configurable: true, get: function () { return 'visible'; } });
				st.descs.push(['visibilityState', origState]);
			}
		} catch (e) { /* 属性被冻结时事件那一层多半也还能用，继续往下走 */ }
		/* 2) 事件在 window 捕获阶段截住。 */
		for (let i = 0; i < EVENT_TYPES.length; i++) {
			try {
				host.addEventListener(EVENT_TYPES[i], onEvent, true);
				st.events.push(EVENT_TYPES[i]);
			} catch (e) { }
		}
		/* 3) 帧时钟：页面的 rAF 改由闸门经手。 */
		try {
			host.requestAnimationFrame = rafWrap;
			host.cancelAnimationFrame = cafWrap;
		} catch (e) { }
		/* 不伴随事件的可见性变化（最小化窗口、切走标签页）用轮询兜底。 */
		st.pollId = setInterval(refresh, 250);
		refresh();
	}

	function disable(): void {
		if (!st.on) return;
		st.on = false;
		for (let i = 0; i < st.events.length; i++) {
			try { host.removeEventListener(st.events[i], onEvent, true); } catch (e) { }
		}
		st.events = [];
		/* 先把排队/泵住的回调交回原生，再撤掉 rAF 替身。 */
		stopPump();
		try {
			host.requestAnimationFrame = st.nativeRaf;
			host.cancelAnimationFrame = st.nativeCaf;
		} catch (e) { }
		if (st.pollId) { clearInterval(st.pollId); st.pollId = 0; }
		for (let i = 0; i < st.descs.length; i++) {
			try { Object.defineProperty(docProto, st.descs[i][0], st.descs[i][1]); } catch (e) { }
		}
		st.descs = [];
	}

	const api: any = {
		set: function (value: boolean): void {
			if (value) enable();
			else disable();
		},
		/* 给自动化验证用的只读快照。 */
		stats: function (): GateStats {
			return { on: st.on, pumping: st.pumping, pending: st.queue.size, hidden: trueHidden() };
		},
	};
	host[KEY] = api;
	enable();
	return 'installed';
}
