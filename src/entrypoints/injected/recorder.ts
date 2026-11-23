/**
 * 页面主世界的“输入监听器记录器”。
 *
 * 为什么要它：播放器节点被搬进 Document PiP 之后，节点自身的事件监听器照常
 * 工作，但站点的键盘快捷键、进度条拖动的 mousemove/mouseup 都注册在**页面**
 * document 上 —— 那些监听器在页面文档里，永远收不到 PiP 文档里发生的事件，
 * 表现就是“PiP 里按空格/方向键没反应”“拖进度条毫无动静”。
 *
 * 修法是让同一批监听器**也在 PiP 文档里挂一份**（事件仍是原生派发，
 * target / offsetX / layerX 全都正确）。但监听器是页面加载时就注册完的，
 * 等弹出 PiP 再注入就一条都记不到了，所以这个脚本必须在 document_start
 * 以主世界（world: MAIN）跑，只做“记录”，不改变任何行为。
 *
 * 记录结果挂在 window.__sepWinInputRegs 上，闸门（core/gate.ts）在镜像时取用。
 */

interface InputReg {
	target: 'document' | 'window';
	type: string;
	listener: any;
	options: any;
	/** 已经在哪些文档里挂过替身（避免重复挂） */
	mirrored?: boolean;
}

const KEY = '__sepWinInputRegs';

/** 需要镜像的输入类事件。可见性那几类由闸门自己处理，不在此列。 */
const INPUT_TYPES = [
	'keydown', 'keyup', 'keypress',
	'mousedown', 'mousemove', 'mouseup', 'click', 'dblclick', 'wheel',
	'pointerdown', 'pointermove', 'pointerup', 'pointercancel',
	'contextmenu', 'touchstart', 'touchmove', 'touchend',
];

function isInputType(type: string): boolean {
	for (let i = 0; i < INPUT_TYPES.length; i++) {
		if (INPUT_TYPES[i] === type) return true;
	}
	return false;
}

(function install(): void {
	const host: any = window as any;
	if (host[KEY]) return;

	const regs: InputReg[] = [];
	host[KEY] = { regs };

	function record(target: 'document' | 'window', proto: any, name: 'addEventListener' | 'removeEventListener'): void {
		const orig = proto && proto[name];
		if (typeof orig !== 'function') return;
		if (name === 'addEventListener') {
			proto[name] = function (type: any, listener: any, options: any) {
				try {
					const t = String(type);
					if (isInputType(t) && listener) {
						regs.push({ target: target, type: t, listener: listener, options: options });
					}
				} catch (e) { /* 记录失败不能影响站点 */ }
				return orig.call(this, type, listener, options);
			};
		} else {
			proto[name] = function (type: any, listener: any, options: any) {
				try {
					const t = String(type);
					for (let i = regs.length - 1; i >= 0; i--) {
						if (regs[i].target === target && regs[i].type === t && regs[i].listener === listener) {
							regs.splice(i, 1);
						}
					}
				} catch (e) { }
				return orig.call(this, type, listener, options);
			};
		}
	}

	try {
		const docP: any = host.Document && host.Document.prototype;
		const winP: any = host.Window && host.Window.prototype;
		record('document', docP, 'addEventListener');
		record('document', docP, 'removeEventListener');
		record('window', winP, 'addEventListener');
		record('window', winP, 'removeEventListener');
	} catch (e) { }
})();
