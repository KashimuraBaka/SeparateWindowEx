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
	/** 被拦下的“非用户”暂停次数（诊断用）。 */
	blockedPauses?: number;
	/** 是否已经把站点的输入监听器镜像到 PiP 文档（诊断用）。 */
	mirroring?: boolean;
	/** 是否已设置镜像目标窗口（诊断用）。 */
	mirrorWin?: boolean;
	/** 已记录的输入监听器条数（诊断用）。 */
	regs?: number;
	/** 从 document_start 记录器读到的条数（诊断用）。 */
	recorded?: number;
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
	/* 内容脚本在"用户刚在 PiP 里操作过"时派发这个事件，用来放行用户自己的暂停。 */
	const ALLOW_PAUSE_EVENT = '__sepwin-allow-pause';

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
		/* 被拦下的暂停次数（诊断用） */
		blockedPauses: 0,
		/* 用户主动暂停的放行窗口：内容脚本在 PiP 内有点击/按键时把它往后推 3 秒 */
		allowPauseUntil: 0,
		origPause: null as any,
		pauseWrapped: false,
		/* 从记录器读到的监听器条数（诊断用） */
		recorded: 0,
		/* ---- 输入镜像 ---- */
		/* document/window 上注册过的输入类监听器（用于在 PiP 文档里再挂一份） */
		regs: [] as any[],
		/* 已镜像到 PiP 文档的条目 */
		mirrored: [] as any[],
		/* 当前镜像目标（PiP 窗口），null = 未开启 */
		mirrorWin: null as any,
		origDocAdd: null as any,
		origDocRemove: null as any,
		origWinAdd: null as any,
		origWinRemove: null as any,
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
		/* 4) 拦截"非用户发起"的暂停（页面主世界）。
		   PiP 期间站点/浏览器会以"页面不可见"为由调用 <video>.pause()，
		   表现就是"在 PiP 里暂停后又被拉回播放"或"暂停不生效"。
		   这里把 pause() 拦掉：只有用户刚在 PiP 里操作过（内容脚本派发放行事件）
		   的那 3 秒内才真正放行 —— 那才是用户自己的暂停。 */
		try {
			const mediaProto: any = (host as any).HTMLMediaElement && (host as any).HTMLMediaElement.prototype;
			if (mediaProto && !st.pauseWrapped) {
				st.origPause = mediaProto.pause;
				mediaProto.pause = function (this: any) {
					try {
						if (st.on && Date.now() >= st.allowPauseUntil) {
							st.blockedPauses += 1;
							return;
						}
					} catch (e) { }
					return st.origPause.apply(this, arguments as any);
				};
				st.pauseWrapped = true;
			}
			host.addEventListener(ALLOW_PAUSE_EVENT, function () {
				st.allowPauseUntil = Date.now() + 3000;
			}, true);
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
		/* 还原 pause()：闸门关掉之后站点要能正常暂停。 */
		try {
			const mediaProto: any = (host as any).HTMLMediaElement && (host as any).HTMLMediaElement.prototype;
			if (mediaProto && st.pauseWrapped && st.origPause) {
				mediaProto.pause = st.origPause;
				st.pauseWrapped = false;
				st.origPause = null;
			}
		} catch (e) { }
		for (let i = 0; i < st.descs.length; i++) {
			try { Object.defineProperty(docProto, st.descs[i][0], st.descs[i][1]); } catch (e) { }
		}
		st.descs = [];
		/* 收起输入镜像：PiP 文档里那批替身监听器要一并摘掉。 */
		unmirrorInput();
	}

	/* 需要镜像到 PiP 文档的输入类事件（可见性那几类由闸门自己处理，不在此列）。 */
	const INPUT_TYPES = ['keydown', 'keyup', 'keypress', 'mousedown', 'mousemove', 'mouseup',
		'click', 'dblclick', 'wheel', 'pointerdown', 'pointermove', 'pointerup', 'pointercancel',
		'contextmenu', 'touchstart', 'touchmove', 'touchend'];

	function isInputType(type: string): boolean {
		for (let i = 0; i < INPUT_TYPES.length; i++) if (INPUT_TYPES[i] === type) return true;
		return false;
	}

	function mirrorOwner(reg: any): any {
		const win = st.mirrorWin;
		if (!win || !win.document) return null;
		return reg.target === 'window' ? win : win.document;
	}

	/* 把一条注册照搬到 PiP 文档/窗口上，事件仍是原生派发（target/offsetX 都对）。 */
	function attachMirror(reg: any): void {
		if (!st.mirrorWin) return;
		for (let i = 0; i < st.mirrored.length; i++) {
			if (st.mirrored[i].reg === reg) return;
		}
		const target = mirrorOwner(reg);
		if (!target) return;
		const wrapped = function (e: any) {
			try {
				const fn = reg.listener;
				if (typeof fn === 'function') fn.call(target, e);
				else if (fn && typeof fn.handleEvent === 'function') fn.handleEvent(e);
			} catch (err) { }
		};
		try {
			target.addEventListener(reg.type, wrapped, reg.options);
			st.mirrored.push({ reg: reg, target: target, wrapped: wrapped });
		} catch (err) { }
	}

	function unmirrorInput(): void {
		for (let i = 0; i < st.mirrored.length; i++) {
			const m = st.mirrored[i];
			try { m.target.removeEventListener(m.reg.type, m.wrapped, m.reg.options); } catch (e) { }
		}
		st.mirrored = [];
		st.mirrorWin = null;
	}

	/* 拦一层 add/removeEventListener，把输入类监听器登记下来。 */
	function installRegHook(): void {
		if (st.origDocAdd) return;
		try {
			const docP: any = (host as any).Document && (host as any).Document.prototype;
			const winP: any = (host as any).Window && (host as any).Window.prototype;
			if (docP) {
				st.origDocAdd = docP.addEventListener;
				st.origDocRemove = docP.removeEventListener;
				docP.addEventListener = function (type: any, listener: any, options: any) {
					try {
						const t = String(type);
						if (isInputType(t) && listener) {
							const reg = { target: 'document', type: t, listener: listener, options: options };
							st.regs.push(reg);
							if (st.mirrorWin) attachMirror(reg);
						}
					} catch (e) { }
					return st.origDocAdd.call(this, type, listener, options);
				};
				docP.removeEventListener = function (type: any, listener: any, options: any) {
					try {
						const t = String(type);
						for (let i = st.regs.length - 1; i >= 0; i--) {
							if (st.regs[i].target === 'document' && st.regs[i].type === t && st.regs[i].listener === listener) st.regs.splice(i, 1);
						}
					} catch (e) { }
					return st.origDocRemove.call(this, type, listener, options);
				};
			}
			if (winP) {
				st.origWinAdd = winP.addEventListener;
				st.origWinRemove = winP.removeEventListener;
				winP.addEventListener = function (type: any, listener: any, options: any) {
					try {
						const t = String(type);
						if (isInputType(t) && listener) {
							const reg = { target: 'window', type: t, listener: listener, options: options };
							st.regs.push(reg);
							if (st.mirrorWin) attachMirror(reg);
						}
					} catch (e) { }
					return st.origWinAdd.call(this, type, listener, options);
				};
				winP.removeEventListener = function (type: any, listener: any, options: any) {
					try {
						const t = String(type);
						for (let i = st.regs.length - 1; i >= 0; i--) {
							if (st.regs[i].target === 'window' && st.regs[i].type === t && st.regs[i].listener === listener) st.regs.splice(i, 1);
						}
					} catch (e) { }
					return st.origWinRemove.call(this, type, listener, options);
				};
			}
		} catch (e) { }
	}

	const api: any = {
		set: function (value: boolean): void {
			if (value) enable();
			else disable();
		},
		/* 把"挂在页面 document/window 上的输入类监听器"同时挂到 PiP 文档上。
		 *
		 * 站点把播放器节点搬走后，节点自身的事件照常工作，但它的键盘快捷键、
		 * 进度条拖动的 mousemove/mouseup 都注册在页面 document 上 ——
		 * 那些监听器在页面文档里，永远收不到 PiP 文档里发生的事件。
		 * 之前试过"把事件复制一份派发到页面 document"，但站点是用
		 * offsetX（相对事件目标）算位置的，复制品的 target 变成 document，
		 * 只能算出 0，拖动看起来毫无反应。
		 *
		 * 这里换成让同一个监听器**也在 PiP 文档里跑**：事件是原生派发的，
		 * target/offsetX 全都正确。传入 PiP 窗口即开启，传 null 关闭。 */
		mirrorInput: function (pipWin: any): void {
			unmirrorInput();
			if (!pipWin || !pipWin.document) return;
			st.mirrorWin = pipWin;
			installRegHook();
			/* 先用 document_start 就装在主世界的记录器（injected/recorder.ts）
			   补上页面加载时注册的那批监听器 —— 闸门是弹出时才注入的，
			   站点真正的播放器监听器全都比它早。 */
			try {
				const rec = (host as any).__sepWinInputRegs && (host as any).__sepWinInputRegs.regs;
				st.recorded = rec ? rec.length : 0;
				if (rec) for (let i = 0; i < rec.length; i++) attachMirror(rec[i]);
			} catch (e) { }
			for (let i = 0; i < st.regs.length; i++) attachMirror(st.regs[i]);
		},
		/* 把同一批监听器再挂到 PiP 文档上。 */
		_mirrorAll: function (): void { /* 内部使用，保留占位 */ },
		/* 给自动化验证用的只读快照。 */
		stats: function (): GateStats {
			return { on: st.on, pumping: st.pumping, pending: st.queue.size, hidden: trueHidden(), blockedPauses: st.blockedPauses | 0, mirroring: !!(st.mirrorWin && st.mirrored.length), mirrorWin: !!st.mirrorWin, regs: st.regs.length, recorded: st.recorded | 0 };
		},
	};
	host[KEY] = api;
	/* 内容脚本用 DOM 事件通知开关（postMessage 的 data 不能跨世界传递，
	   而 DOM 事件在隔离世界/主世界之间是同一套派发）。 */
	try {
		const onMirror = function () {
			try {
				const dpp = (host as any).documentPictureInPicture;
				api.mirrorInput(dpp && dpp.window);
			} catch (err) { }
		};
		const offMirror = function () { try { api.mirrorInput(null); } catch (err) { } };
		host.addEventListener('__sepwin-mirror-input-on', onMirror, false);
		host.addEventListener('__sepwin-mirror-input-off', offMirror, false);
	} catch (e) { }
	enable();
	return 'installed';
}
