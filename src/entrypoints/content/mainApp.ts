// @ts-nocheck -- 遗留文件体：模块边界已就位，类型迁移留到后续步骤。
import { register, use } from './runtime';
import { VideoMirror } from './mirror';
import { TargetResolver } from './selection';
import { WholePageFitter } from './wholePage';


/**
 * 作者：Kashimura
 */
var __AppPanel = {
	lastEv: 0,
	run: false,
	scroll: 0,
	target: {},
	selector: '',
	// 镜像后端（canvas 逐帧绘制；stream 接力实测不如它，已移除）
	_mirrorKind: 'canvas',
	_mirrorOn: false,
	// 选中解析（透明拦截层穿透、浮层下取播放器容器）见 selection.ts，
	// 这里只保留给老调用点的同名入口。
	_resolver: function () {
		if (!this._targetResolver) {
			this._targetResolver = new TargetResolver(document, {
				hideOverlay: function () { use('__Element').hideWrapper(); },
				showOverlay: function () { use('__Element').showWrapper(); }
			});
		}
		return this._targetResolver;
	},
	_isGhostLayer: function (el) { return this._resolver().isGhostLayer(el); },
	_videoHostFor: function (stack, target) { return this._resolver().videoHostFor(stack, target); },
	_getFromPoint: function (x, y) { return this._resolver().fromPoint(x, y); },
	_resolveTarget: function (x, y, hovered) { return this._resolver().resolve(x, y, hovered); },
	_prepare: function (target) {
		use('Selector').href = document.location.href;
		this.selector = use('Selector').getSelector(target);
		// 这次弹出是为哪块区域开的。上一级/下一级只改变**显示**的节点，
		// 保存尺寸始终落回这块区域（“当前区域”），不会因为浏览层级而跑到
		// 父级/子级的选择器上、把尺寸存到一个看不见的槽位里。
		this._areaSelector = this.selector;
		// 记下"选这块区域之前视频是不是在播"。
		// 选区域的那次点击会落到站点播放器上（B 站点击视频 = 暂停），
		// 弹出后画面就停住了；这里记下来，弹出后只在"本来是播着的"情况下补一次
		// play()，之后用户自己暂停就不会再被碰（暂停源头由 gate.ts 拦截）。
		this._wasPlaying = false;
		try {
			var vids = document.querySelectorAll('video');
			for (var i = 0; i < vids.length; i++) {
				if (!vids[i].paused && vids[i].readyState > 2) { this._wasPlaying = true; break; }
			}
		} catch (e) { }
		this.stop();
		this.dellIcon();
		use('__Element').switchOff();
		use('SepWinEvents').addEvents();
	},
	updateTab: function () {
		this._prepare(document.body);
		this._visibilityShim(true);
		use('Modification').do(document.body, this.selector);
		use('ButtonPanel').add();
	},
	applyEntire:function(){
		this.selector = "BODY";
		if (this._useDocPip()) {
			this._prepare(document.body);
			this._openDocPip(document.body);
			return;
		}
		this._visibilityShim(true);
		use('__BgCmd').sendCmd('apply', {
			selector: "BODY",
			size: {
				width: 		window.innerWidth,
				height: 	window.innerHeight,
				avLeft: 	window.screen.availLeft,
				avTop: 		window.screen.availTop,
				avWidth: 	window.screen.availWidth,
				avHeight: 	window.screen.availHeight,
				entireTab: 	true
			}
		});
	},
	/* --- 模式选择 ---
	 * Document PiP 的 requestWindow() 必须由页面内的用户手势触发，
	 * 因此配置在这里同步缓存（见 _initCfg），而不是在点击处理过程中
	 * 再走一次异步消息往返去查询。
	 */
	cfg: { useDocPip: true },
	// 按选择器保存的窗口尺寸：{ selector: {width, height} }
	_sizes: {},
	_initCfg: function () {
		var self = this;
		// 以后台返回的值为准（这同时会触发旧版本设置项的迁移）。
		// 内容脚本访问不到 Panel.cfg，
		// 所以这是真实默认值的唯一来源。
		try {
			chrome.runtime.sendMessage({ cmd: 'getCfg', arg: {} }, function (response) {
				void chrome.runtime.lastError;
				if (response && response.cfg) {
					self.cfg.useDocPip = !!response.cfg.useDocPip;
				}
			});
		} catch (e) { /* ignore */ }
		// 与弹窗写入的值保持同步。
		if (chrome.storage && chrome.storage.local) {
			chrome.storage.local.get('settings', function (d) {
				self._readCfg(d && d.settings);
			});
			chrome.storage.onChanged.addListener(function (changes, area) {
				if (area === 'local' && changes.settings) {
					self._readCfg(changes.settings.newValue);
				}
			});
			this._initSizes();
		}
	},
	// 载入本页按选择器保存的窗口尺寸，让 PiP 窗口能按
	// 用户保存的尺寸重新打开（与经典窗口行为一致）。
	_initSizes: function () {
		var self = this;
		var reg = /^(https?:\/\/)?([\da-z|0-9\.-]+)\.([a-z|0-9\.]{2,6})/ig;
		var key = (document.location.href.match(reg) || [document.location.href])[0];
		chrome.storage.local.get(key, function (d) {
			var items = d && d[key];
			if (!items || !items.css || !items.size) return;
			for (var i = 0; i < items.css.length; i++) {
				var raw = items.size[i];
				if (raw && raw !== '{}') {
					try { self._sizes[items.css[i]] = JSON.parse(raw); } catch (e) { }
				}
			}
		});
	},
	_readCfg: function (settings) {
		// 只有确实存过值时才覆盖；否则保留
		// 默认值（置顶窗口），避免全新配置默默回退。
		if (settings && settings.cfg && typeof settings.cfg.useDocPip !== 'undefined') {
			this.cfg.useDocPip = !!settings.cfg.useDocPip;
		}
	},
	_useDocPip: function () {
		return !!this.cfg.useDocPip && !!window.documentPictureInPicture;
	},
	_hasActivation: function () {
		try {
			return !!(window.navigator.userActivation && window.navigator.userActivation.isActive);
		} catch (e) {
			return false;
		}
	},
	apply: function (target) {
		/* 整页弹出之后页面里的 document.body 已经是 null（被搬进置顶窗口了），
		   此时再触发一次"整页弹出"没有意义，直接忽略，别让 null 一路穿到 getSelector。 */
		if (!target || !target.tagName) return;
		if (target.tagName == 'IFRAME') {
			use('__BgCmd').sendCmd('loadToFrame', {});
			setTimeout(function () {
				use('CmdToFrame').searchInFrame(target);
			}, 500);
		}
		this._prepare(target);
		// 在这里记录一次选区，让经典窗口与 PiP 窗口共用
		// 同一份站点区域列表（不再按模式分开记）。
		if (this.selector && this.selector !== 'BODY') {
			try {
				use('__BgCmd').sendCmd('recordArea', { selector: this.selector });
				this.responseSelectors();
			} catch (e) { }
		}
		if (this._useDocPip()) {
			this._openDocPip(target);
			return;
		}
		this._applyClassic(target);
	},
	// 经典独立窗口路径（原有行为）。
	_applyClassic: function (target) {
		let width = 150, height = 150, entireTab = false;
		if (target == document.body) {
			width = window.innerWidth;
			height = window.innerHeight;
			entireTab = true;
		} else {
			width = Math.round(use('__Element').size.width);
			height = Math.round(use('__Element').size.height);
		}
		// 经典窗口同样会切标签页/最小化，弹幕一样会停：
		// 这里也装上可见性闸门（此时没有 PiP 窗口，帧时钟退回原生）。
		this._visibilityShim(true);
		use('__BgCmd').sendCmd('apply', {
			selector: this.selector,
			size: {
				width: width,
				height: height,
				avLeft: window.screen.availLeft,
				avTop: window.screen.availTop,
				avWidth: window.screen.availWidth,
				avHeight: window.screen.availHeight,
				entireTab: entireTab
			}
		});
		use('Modification').do(target, this.selector);
		use('ButtonPanel').add();
	},
	// 打开一个 Document Picture-in-Picture 窗口（始终置顶），把选中的
	// 区域移进去。PiP 窗口关闭时其 document 会销毁，
	// 因此在 pagehide 里把移走的节点放回原处。
	_openDocPip: function (target) {
		var self = this;
		if (!window.documentPictureInPicture) {
			this._applyClassic(target);
			return;
		}
		// 弹窗/右键菜单触发时页面内没有用户手势，
		// 浏览器会拒绝 requestWindow()，所以提示用户点一下。
		if (!this._hasActivation()) {
			this._promptActivate(target);
			return;
		}
		// 整页模式：趁 body 还在页面里、布局正常，先记下它的自然宽度。
		// 搬进 PiP 之后（还可能带着上一轮的 zoom）再量就不准了，
		// 实测会量到几百像素宽、几万像素高的失真值。
		this._wholeNaturalW = 0;
		if (target && target.tagName === 'BODY') {
			this._wholeNaturalW = Math.max(document.body.scrollWidth | 0, document.body.offsetWidth | 0, 0);
		}
		var isBody = (target == document.body);
		// 尺寸只取"区域自己多大 / 上次存了多少"，**不做最大最小裁剪**：
		// 以前整页模式被压在 1280×800、普通区域被抬到至少 160，
		// 用户存了更大的尺寸也用不上（开出来和存的完全不一样）。
		var width = isBody ? Math.round(window.innerWidth)
			: Math.round(use('__Element').size.width);
		var height = isBody ? Math.round(window.innerHeight)
			: Math.round(use('__Element').size.height);
		// 这个区域之前存过尺寸就用它（saveAreaState 存的就是保存时窗口的尺寸）。
		var saved = this._sizes[this.selector];
		if (saved && saved.width >= 1 && saved.height >= 1) {
			width = Math.round(saved.width);
			height = Math.round(saved.height);
		}
		width = Math.max(1, width || 0);
		height = Math.max(1, height || 0);
		// 记住请求时的尺寸：requestWindow() 刚返回时 PiP 窗口还没有布局，
		// innerWidth/innerHeight 会是 0。
		this._pipRequested = { w: width, h: height };
		window.documentPictureInPicture.requestWindow({ width: width, height: height })
			.then(function (pipWin) { self._mountPip(pipWin, target); })
			.catch(function (e) {
				console.error('[SepWin] Document PiP failed:', e);
				self._applyClassic(target);
			});
	},
	// 选中区域内第一个可播放的 <video>（或区域自身）。
	_findVideo: function (node) {
		if (!node || node.nodeType !== 1) return null;
		if (node.tagName === 'VIDEO') return node;
		return node.querySelector ? node.querySelector('video') : null;
	},
	// 播放器通常把弹幕层、控制条叠在 <video> 之上，所以点到的节点
	// 往往自己不含 video。向上找几层，定位真正持有 video 的容器。
	// 绝不能返回 <body>/<html>：把它们移动进
	// PiP 文档会毁掉整个页面。
	_findVideoContext: function (node) {
		var n = node, depth = 0;
		while (n && n.nodeType === 1 && n !== document.body && n !== document.documentElement && depth < 6) {
			var v = this._findVideo(n);
			if (v) return { host: n, video: v };
			n = n.parentNode;
			depth++;
		}
		return null;
	},
	// 在页面 + PiP 文档里找一个"确实在播"的 video（源元素被站点换掉时接管用）。
	// 只认已经有尺寸、没暂停、且不是当前源的元素。
	_findPlayableVideo: function (exclude) {
		var found = null, bestArea = 0;
		var docs = [document];
		if (this._pipWin && !this._pipWin.closed) docs.push(this._pipWin.document);
		for (var d = 0; d < docs.length; d++) {
			var vids = docs[d].querySelectorAll('video');
			for (var i = 0; i < vids.length; i++) {
				var v = vids[i];
				if (v === exclude) continue;
				if (v.paused || !v.videoWidth) continue;
				var area = v.videoWidth * v.videoHeight;
				if (area > bestArea) { bestArea = area; found = v; }
			}
		}
		return found;
	},
	// 兜底：点击的覆盖层不在 video 子树内时，取页面上最大的 video
	// （直播页常有预览/广告等多个 video，
	// 所以"只有一个 video"不能作为条件）。
	_pickPageVideo: function () {
		var best = null, bestArea = 0;
		var vids = document.querySelectorAll('video');
		for (var i = 0; i < vids.length; i++) {
			var r = vids[i].getBoundingClientRect();
			var area = r.width * r.height;
			if (area > bestArea) { bestArea = area; best = vids[i]; }
		}
		return bestArea > 5000 ? best : null;
	},
	/* --- 画面镜像 -------------------------------------------------------
	 * 不再用 video.captureStream()。它的帧来自源元素自己的 frame sink：
	 * 页面一隐藏（源 <video> 还被挪到了屏幕外），Chromium 就不再给它送帧，
	 * 镜像会冻在最后一帧上 —— 而声音仍由源元素播放，表现就是"画面冻住、声音还在"。
	 *
	 * 改成把源元素的当前帧 drawImage 进 PiP 文档里的 <canvas>：这是直接从解码器
	 * 取帧，与元素有没有被合成无关；绘制循环跑在 PiP 窗口自己的 requestAnimationFrame
	 * 上（那个窗口始终可见、帧时钟不会停），所以标签页隐藏多久画面都还在走。
	 */
	_mirrorCss: function (video) {
		var css = video.getAttribute('style') || '';
		/* 站点常用标签选择器给 video 定尺寸，canvas 命中不了，补一份兜底。 */
		if (!/\bwidth\s*:/i.test(css)) css += ';width:100%;height:100%';
		if (!/object-fit/i.test(css)) css += ';object-fit:contain';
		return css;
	},
	// 画面节点：canvas 逐帧 drawImage（实测这张就是最稳的一条：
	// 60 帧源 → 不同画面 60.5/s、p50=15ms、p90=21ms，与页面原生播放 58~60/s、
	// p50=14ms、p90=21ms 基本一致）。
	// 曾试过 captureStream → MediaStreamTrackProcessor → MediaStreamTrackGenerator
	// → PiP 里的 <video>（交给浏览器视频管线合成），但在背压下会丢帧：
	// 58.3/s、p99=35ms、max=42ms，反而不如 canvas，故不采用。
	_createMirror: function (video, className, cssText) {
		var view = this._createCanvasMirror(video, className, cssText);
		this._mirrorKind = 'canvas';
		return view;
	},
	// 画面镜像交给 VideoMirror（class 实现见 mirror.ts）。
	_startMirror: function (video, view) {
		this._stopMirror();
		var win = this._pipWin;
		if (!win || !view) return;
		var mirror = new VideoMirror(win, video, view);
		mirror.start();
		this._mirror = mirror;
		this._mirrorKind = 'canvas';
		this._mirrorOn = mirror.running;
	},	// 看门狗与诊断用的统一读数。
	_mirrorFrameCount: function () {
		return this._mirror ? this._mirror.frames : 0;
	},
	_mirrorRunning: function () {
		return this._mirror ? this._mirror.running : false;
	},
	_mirrorIdleMs: function () {
		return -1;
	},
	// 画布镜像节点。
	_createCanvasMirror: function (video, className, cssText) {
		var doc = this._pipWin.document;
		var view = doc.createElement('canvas');
		view.id = '__sepWinPipVideo';
		if (className) view.className = className;
		view.style.cssText = (cssText ? cssText.replace(/\s*;?\s*$/, ';') : '') +
			'pointer-events:none;background:#000;display:block;';
		return view;
	},
	_stopMirror: function () {
		if (this._mirror) this._mirror.stop();
		this._mirror = null;
		this._mirrorOn = false;
	},
	// 只显示视频镜像，不移动任何 DOM。
	_showMirrorOnly: function (video) {
		var doc = this._pipWin.document;
		var wrap = doc.getElementById('__sepWinPipWrap');
		var view = this._createMirror(video, '__pipFill', null);
		wrap.appendChild(view);
		this._pip = {
			target: video, parent: video.parentNode, next: video.nextSibling,
			selector: use('Selector').getSelector(video), mirrored: true
		};
		this._pipVideo = video;
		this._pipView = view;
		this._startMirror(video, view);
		this._startWatchdog();
		this._updatePipState();
	},
	// 把播放器容器移出页面后，站点会发现自己的 <video> 不在了，
	// 于是在被移走的容器里重建一个。这个新播放器有自己
	// （不可用的）MediaSource，并把占位画面糊满整个区域。
	// 因此只保留我们的镜像可见。
	_suppressForeignVideos: function () {
		var win = this._pipWin;
		if (!win || win.closed) return;
		var doc = win.document;
		var vids = doc.querySelectorAll('video');
		for (var i = 0; i < vids.length; i++) {
			var v = vids[i];
			if (v.id === '__sepWinPipVideo') continue;
			/* 接管中的源元素（被站点换掉的那个）不要再藏，否则它不再解码。 */
			if (v === this._pipVideo) continue;
			if (v.style.display !== 'none') v.style.display = 'none';
		}
	},
	/* --- 后台标签页下的存活能力 --------------------------------
	 * 如果源页面在标签页隐藏或窗口最小化时停止解码，PiP 窗口就废了：
	 * 镜像会僵住。所以要保持屏幕唤醒、让标签页不被丢弃，
	 * 并运行一个看门狗：画面停了就恢复播放，
	 * playback / rebuilds the stream when frames stop arriving.
	 */
	_keepAwake: function (on) {
		try {
			use('__BgCmd').sendCmd(on ? 'pipKeepAwake' : 'pipReleaseAwake', {});
		} catch (e) { }
	},
	// PiP 期间告诉页面"你仍可见"，否则站点在标签页隐藏后会
	// 立刻暂停弹幕/覆盖层渲染（详见 core/gate.ts：事件、状态、帧时钟三条路径）。
	// 经典窗口没有 PiP 窗口可借用，但事件与状态两层照样生效。
	_visibilityShim: function (on) {
		try {
			use('__BgCmd').sendCmd('pipVisibilityShim', { on: !!on });
		} catch (e) { }
	},
	// 播放器页面按页面视口计算覆盖层尺寸（含弹幕字号）。
	// PiP 打开期间把 PiP 窗口当作页面视口，
	// 让这些尺寸与经典窗口一样跟随窗口变化。
	_viewportShim: function (on, w, h) {
		try {
			use('__BgCmd').sendCmd('pipViewportShim', { on: !!on, w: w | 0, h: h | 0 });
		} catch (e) { }
	},
	_requestWakeLock: function (pipWin) {
		var self = this;
		try {
			if (!pipWin.navigator || !pipWin.navigator.wakeLock) return;
			pipWin.navigator.wakeLock.request('screen').then(function (lock) {
				self._wakeLock = lock;
			}).catch(function () { });
		} catch (e) { }
	},
	_releaseWakeLock: function () {
		if (this._wakeLock && this._wakeLock.release) {
			try { this._wakeLock.release(); } catch (e) { }
		}
		this._wakeLock = null;
	},
	// 轻量、保守的健康检查循环。画面改成"取帧绘制"之后，这里只做两件事：
	// 让源元素继续解码、保证绘制循环还活着（PiP 窗口被重置时循环会断），
	// 外加上清掉站点重建的外来 <video>。
	_startWatchdog: function () {
		var self = this;
		this._stopWatchdog();
		var lastFrames = -1;
		var lastSrcFrames = -1, lastSrcMove = Date.now(), lastNudge = 0, sawSrcFrames = false;
		self._heals = 0;

		this._watchdog = setInterval(function () {

			var win = self._pipWin;
			if (!win || win.closed) {
				// PiP 已经关掉，但 pagehide 没来（脚本 close()、浏览器强制结束、
				// 渲染进程崩溃）时，搬过去的节点还在那个文档里 —— 不搬回来页面就
				// 少了整块播放器（实测直播页会变成一个没有 <video> 的空壳）。
				if (self._pip) {
					try { self._restorePip(); } catch (e) { console.error('[SepWin] restore after close failed:', e); }
				}
				self._stopWatchdog();
				return;
			}
			var video = self._pipVideo, view = self._pipView;
			if (!video || !view) return;
			var now = Date.now();
			self._suppressForeignVideos();
			// 站点会持续注入样式（播放器/弹幕），每轮补差
			try { self._copyPageStyles(); } catch (e) { }
			// a) 暂停交给“拦截”处理，这里不再强行 play()。
			//    站点/浏览器以“页面不可见”为由调 pause() 会被主世界的闸门
			//    （core/gate.ts）直接拦掉；用户自己的暂停会放行。
			//    事后强行续播会破坏用户操作（暂停后又被拉回播放），所以删掉。
			// a2) 站点把源元素换掉了（断流重连、切换播放器）：我们的引用已经脱离文档，
			//     画面会一直停在最后一帧，而新元素照旧发声。接管页面上还在播的那个。
			if (!video.isConnected) {
				var fresh = self._findPlayableVideo(video);
				if (fresh) {
					try {
						/* 记住它原来的内联样式：关掉 PiP 时要原样还回去，
						   否则它一直停在 1×1、屏幕外，页面播放器是黑的
						   （实测关窗后 <video> 仍留在 inline 的停放样式上）。 */
						self._rememberStyle(fresh);
						/* 挪到 PiP 窗口可视区之外但仍在渲染树里：继续解码，不会露出来 */
						fresh.style.display = '';
						fresh.style.position = 'fixed';
						fresh.style.left = '-10000px';
						fresh.style.top = '0';
						fresh.style.width = '1px';
						fresh.style.height = '1px';
					} catch (e) { }
					self._pipVideo = fresh;
					if (self._mirror) self._mirror.bindVideo(fresh);
					self._startMirror(fresh, view);
					video = fresh;
					lastSrcFrames = -1;
					sawSrcFrames = false;
				}
			}
			// b) 绘制循环必须还在出帧；断了就重起。
			//    源本身暂停时本来就没新帧可画，这种情况不算断线。
			var frames = self._mirrorFrameCount();
			var stalled = !self._mirrorRunning() || (!video.paused && frames === lastFrames);
			if (stalled) self._startMirror(video, view);
			lastFrames = self._mirrorFrameCount();
			// c) 源元素自己不出帧时（解码器停摆，画面上就成了"冻住的最后一帧"），
			//    往直播边缘轻推 50ms，让媒体管线重新出帧。只在确认它曾经出过帧、
			//    且已经停摆 15s 以上时做，30s 内最多一次，避免干扰正常播放。
			try {
				var vq = video.getVideoPlaybackQuality ? video.getVideoPlaybackQuality() : null;
				if (vq && !video.paused) {
					if (vq.totalVideoFrames > lastSrcFrames) {
						lastSrcFrames = vq.totalVideoFrames;
						lastSrcMove = now;
						sawSrcFrames = true;
					} else if (sawSrcFrames && now - lastSrcMove > 15000 && now - lastNudge > 30000) {
						lastNudge = now;
						lastSrcMove = now;
						self._heals = (self._heals | 0) + 1;
						try { video.currentTime = video.currentTime + 0.05; } catch (e) { }
					}
				}
			} catch (e) { }
		}, 3000);
	},
	_stopWatchdog: function () {
		if (this._watchdog) { clearInterval(this._watchdog); this._watchdog = null; }
	},
	// 先把 PiP 文档准备好（样式 + 控制面板），再显示节点。
	_mountPip: function (pipWin, target) {
		var self = this;
		var doc = pipWin.document;
		var style = doc.createElement('style');
		style.textContent =
			'html,body{margin:0;padding:0;height:100%;background:#000;overflow:hidden}' +
			'#__sepWinPipWrap{position:fixed;inset:0;overflow:hidden;background:#000}' +
			'#__sepWinPipWrap>.__pipFill{position:absolute;inset:0;width:100%;height:100%;' +
			'object-fit:contain;background:#000}' +
			'#__sepWinPipWrap>.__pipPlain{position:absolute;inset:0;display:flex;' +
			'align-items:center;justify-content:center;overflow:auto;background:#000}' +
			'#__sepWinPipWrap>.__pipPlain>*{max-width:100%;max-height:100%}' +
			/* 页面侧注入的选区图标/事件面板/提示条跟着区域一起搬进来是没意义的：
			   它们只是页面上的入口，尺寸又是按页面算的（图标是 background-size:contain），
			   一旦被站点 CSS 拉大就会在窗口里糊成一大片白色图块。这里直接隐藏。 */
			'.__iconSepWin,#__evt_panel,#__panelWrapper,#__sepWinPipPrompt{display:none!important}';
		doc.head.appendChild(style);
		// 使用与经典窗口相同的控制面板样式表，
		// 让工具栏在 PiP 里外观一致。
		var css = doc.createElement('link');
		css.rel = 'stylesheet';
		css.href = chrome.runtime.getURL('css/panel.css');
		doc.head.appendChild(css);

		this._pipWin = pipWin;
		this._pipStack = [];

		var wrap = doc.createElement('div');
		wrap.id = '__sepWinPipWrap';
		doc.body.appendChild(wrap);

		this._showNode(target);
		this._addPipPanel(pipWin);
		// 用户在 PiP 里点击/按键时，通知页面主世界的闸门：
		// 接下来 3 秒内的 pause() 是用户自己的，不要拦
		// （其余暂停一律拦掉，见 core/gate.ts）。
		try {
			var markInput = function () {
				try {
					window.dispatchEvent(new CustomEvent('__sepwin-allow-pause'));
				} catch (e) { }
			};
			pipWin.addEventListener('pointerdown', markInput, true);
			pipWin.addEventListener('keydown', markInput, true);
		} catch (e) { }


		// PiP 窗口存在期间保持屏幕唤醒、源标签页存活。
		this._keepAwake(true);
		this._visibilityShim(true);
		// 让页面按 PiP 窗口而不是原页面视口计算覆盖层尺寸
		// （这正是弹幕字号能跟随窗口的原因）。
		// 新开的 PiP 窗口报 0x0，因此用请求时的尺寸兜底，
		// 等它有真实布局后再补一次。
		var reqW = (this._pipRequested && this._pipRequested.w) || 0;
		var reqH = (this._pipRequested && this._pipRequested.h) || 0;
		this._viewportShim(true, pipWin.innerWidth || reqW, pipWin.innerHeight || reqH);
		setTimeout(function () {
			self._viewportShim(true, pipWin.innerWidth || reqW, pipWin.innerHeight || reqH);
		}, 300);
		setTimeout(function () {
			self._viewportShim(true, pipWin.innerWidth || reqW, pipWin.innerHeight || reqH);
		}, 1200);
		this._requestWakeLock(pipWin);
		try {
			pipWin.document.addEventListener('visibilitychange', function () {
				if (pipWin.document.visibilityState === 'visible' && !self._wakeLock) {
					self._requestWakeLock(pipWin);
				}
			});
		} catch (e) { }

		pipWin.addEventListener('pagehide', function () {
			self._stopMirror();
			self._restorePip();
		});
		// 说明：PiP 窗口的**实际**尺寸由浏览器决定，我们只能"请求"。
		//  - requestWindow({width,height}) 的尺寸提示会被忽略（实测开出来是主窗口视口大小）；
		//  - PiP 文档里 resizeTo() 需要用户激活（"resizeTo() requires user activation
		//    in document picture-in-picture"），强行在首次交互时调用还会得到一个
		//    谁都没要求的尺寸（实测 1484×830 变成 962×538）。
		// 所以这里不再主动改窗口大小：区域内容始终按当前窗口尺寸自适应（见 _fitPipHost），
		// 窗口想多大由用户拖、或由浏览器决定；"跟随上次保存的大小"只体现在请求值上。
		// 用户拖动改变 PiP 窗口大小时，保持区域跟随。
		pipWin.addEventListener('resize', function () {
			if (self._pipWin !== pipWin || pipWin.closed) return;
			// 宿主的尺寸由注入样式里的 `#__sepWinPipWrap > :first-child{...100%!important}`
			// 无条件保证，这里不再每次 resize 都写内联样式（那会每帧触发重排、拖动变卡）。
			// 剩下的整页缩放和视口同步略重，节流到 50ms 一次。
			// 注意不用 rAF 做节流：拖动窗口时 rAF 可能被暂停，会一直不执行。
			var now = Date.now();
			if (now - (self._pipFitAt || 0) < 50) {
				if (!self._pipFitTimer) {
					self._pipFitTimer = setTimeout(function () {
						self._pipFitTimer = 0;
						if (self._pipWin !== pipWin || pipWin.closed) return;
						self._pipFitAt = Date.now();
						self._fitPipHost();
						self._fitWholePage();
						self._viewportShim(true, pipWin.innerWidth, pipWin.innerHeight);
					}, 50);
				}
				return;
			}
			self._pipFitAt = now;
			self._fitPipHost();
			self._fitWholePage();
			self._viewportShim(true, pipWin.innerWidth, pipWin.innerHeight);
		});
	},
	// 在 PiP 窗口里显示 `node`。含 <video> 的节点走"镜像"：
	// 原节点留在页面里，直播的 MSE 播放不中断；其它节点
	// 直接搬进 PiP 文档。上一级/下一级复用这个函数遍历 DOM。
	_showNode: function (node) {
		var doc = this._pipWin.document;
		var wrap = doc.getElementById('__sepWinPipWrap');
		if (!wrap) {
			wrap = doc.createElement('div');
			wrap.id = '__sepWinPipWrap';
			doc.body.appendChild(wrap);
		}
		// 先清掉当前显示的内容，再从空容器开始。
		this._restorePipNode();
		this._stopWatchdog();
		this._stopMirror();
		while (wrap.firstChild) wrap.removeChild(wrap.firstChild);
		// 页面样式表也带进 PiP 文档：整页/普通节点被搬进来后，
		// 站点 CSS 全在页面的 <head> 里，不复制过来就会变成一堆无样式的大按钮/图标。
		this._copyPageStyles();

		var ctx = this._findVideoContext(node);
		var ctxVideo = ctx ? ctx.video : null;
		if (ctx) {
			// 忽略不可见/零尺寸的覆盖层（验证码幽灵层、隐藏层），
			// 但保留已找到的 video，仍可镜像。
			var cr = ctx.host.getBoundingClientRect();
			if (cr.width < 20 || cr.height < 20) ctx = null;
		}
		if (ctx) {
			if (ctx.host === ctx.video) {
				// 区域本身就是 video。如果它的播放器容器里还有弹幕层（普通视频页的
				// DOM 弹幕、直播页的弹幕层），就把容器整块搬过去，否则只镜像视频
				// （那样弹幕和控件都会看不到）。搬的是容器、视频仍是镜像，不会打断 MSE。
				var playerHost = this._playerHostFor(ctx.video);
				if (playerHost) {
					this._showHostMirror(playerHost, ctx.video);
					this._updatePipState();
					return;
				}
				this._showMirrorOnly(ctx.video);
				return;
			}
			// 区域包含播放器：显示其真实 DOM，video 用镜像。
			this._showHostMirror(ctx.host, ctx.video);
			this._updatePipState();
			return;
		}
		if (node !== document.body) {
			var pageVideo = ctxVideo || this._pickPageVideo();
			if (pageVideo) {
				// 点击处没有可用区域 —— 只镜像 video。
				this._showMirrorOnly(pageVideo);
				return;
			}
		}
		this._pip = {
			target: node, parent: node.parentNode, next: node.nextSibling,
			selector: use('Selector').getSelector(node)
		};
		var isWholePage = !!(node && node.tagName === 'BODY');
		var holder = doc.createElement('div');
		holder.className = '__pipPlain';
		holder.appendChild(node);
		wrap.appendChild(holder);
		// 整页：按页面自身尺寸布局后整体缩放居中，避免被窗口挤扁/溢出
		if (isWholePage) this._fitWholePage();
		this._updatePipState();
	},
	// 整页模式的自适应。
	//
	// 站点普遍写死最小宽度（B 站是 body{min-width:1080px}），窗口比它窄时页面会
	// 横向溢出、几列被挤在一起 —— 看着就是"布局坏了"。
	// 处理办法：只按宽度收敛，把 body 的 zoom 设成 vw/最小宽度。
	// 用 zoom 而不是 transform，是因为 zoom 会一起缩放布局（宽度/高度/滚动都跟着变），
	// 而 transform 只改画面、布局还留在原尺寸，会出现大量空白或裁切。
	// 整页模式的自适应交给 WholePageFitter（class 实现见 wholePage.ts）。
	_fitWholePage: function () {
		var st = this._pip;
		var win = this._pipWin;
		if (!st || !win || !st.target || st.target.tagName !== 'BODY') return;
		if (!this._wholePage || this._wholeHost !== win) {
			this._wholePage = new WholePageFitter(win);
			this._wholeHost = win;
		}
		this._wholeScale = this._wholePage.fit(st.target, this._wholeNaturalW);
	},
	// 找"视频外面那层播放器容器"（里面有弹幕层才值得整块搬）：实现见 selection.ts。
	_playerHostFor: function (video) {
		return this._resolver().playerHostFor(video);
	},
	// 把区域的 DOM 移进 PiP 文档，真实 <video> 留在页面里
	// （停在屏幕外，继续播放），由镜像副本占位。
	// 这样 MSE 流不会断，上一级/下一级也能照常切换区域。
	_showHostMirror: function (host, video) {
		// 下面几处 setTimeout 里用 self.xxx()；没有这一行的话 self 会落到全局
		// window，延迟回调就会抛 "self._suppressForeignVideos is not a function"。
		var self = this;
		var doc = this._pipWin.document;
		var wrap = doc.getElementById('__sepWinPipWrap');
		this._copyPageStyles();

		// 镜像在 DOM 中占住 <video> 的位置，并继承它的 class 与
		// 内联样式，因此站点自己的响应式 CSS 会像对待真实
		// 元素一样，按 PiP 窗口尺寸调整它。
		this._pipHost = host;
		// 快照内联样式，关闭时把页面精确还原。
		this._pipHostCss = host.getAttribute('style');
		if (!host.style.position || host.style.position === 'static') {
			host.style.position = 'relative';
		}
		var view = this._createMirror(video, video.className, this._mirrorCss(video));

		// 记住 video 原来的位置，再把真实元素停到屏幕外。
		this._rememberStyle(video);
		this._pipParked = { video: video, parent: video.parentNode, next: video.nextSibling };
		if (video.parentNode) video.parentNode.insertBefore(view, video);
		var park = document.getElementById('__sepWinPark');
		if (!park) {
			park = document.createElement('div');
			park.id = '__sepWinPark';
			park.style.cssText = 'position:fixed;left:-20000px;top:0;width:1px;height:1px;' +
				'overflow:hidden;opacity:0;pointer-events:none;';
			document.body.appendChild(park);
		}
		park.appendChild(video);

		this._pip = {
			target: host, parent: host.parentNode, next: host.nextSibling,
			selector: use('Selector').getSelector(host), mirrored: true
		};
		// 在页面里留一块**同尺寸占位**。
		// 直接把宿主搬走，页面就塌出一个空洞（站点还可能在那里重建一个黑色播放器），
		// 表现为"弹出后原本元素占位没了/变成一个黑框、下面内容整体上移"。
		// 占位块保持原有尺寸，布局不跳；点它可以把区域收回来。
		// 区域进入 PiP 文档后失去了页面的布局上下文，
		// 于是给它 PiP 窗口的盒子，让站点 CSS 在此重新排版。
		wrap.appendChild(host);
		this._fitPipHost();
		this._pipVideo = video;
		this._pipView = view;
		this._startMirror(video, view);
		// 选区域的那次点击会把正在播的视频点成暂停（B 站的行为）。
		// 只在"选之前本来在播"的情况下补一次 play()；之后用户自己暂停不再被碰。
		if (this._wasPlaying && video.paused) {
			try {
				var pr = video.play();
				if (pr && pr.catch) pr.catch(function () { });
			} catch (e) { }
		}
		// 站点会在 <video> 离开页面后重建播放器；
		// 这些替代品一出现就隐藏。
		this._suppressForeignVideos();
		setTimeout(function () { self._suppressForeignVideos(); }, 400);
		setTimeout(function () { self._suppressForeignVideos(); }, 1500);
		this._startWatchdog();
	},
	// 把抓取区域的宽高设为 PiP 窗口的宽高（不做缩放），
	// 让页面的响应式布局在窗口中重排，
	// 与经典窗口一致。打开时和每次窗口尺寸变化时调用。
	// 让搬进来的区域**随 PiP 窗口自适应**：宿主铺满窗口，播放器内部那几层
	// （视频区/弹幕层）也强制 100%，由站点自己的 CSS 重新排布 ——
	// 这样窗口多大，画面和弹幕就多大，而不是把一份固定尺寸的快照整体缩放。
	// 弹幕层跟着变高，条目才会在整块画面上分行飞，而不是全挤在顶上。
	_fitPipHost: function () {
		var host = this._pipHost, win = this._pipWin;
		if (!host || !win) return;
		var vw = win.innerWidth || 0, vh = win.innerHeight || 0;
		if (!vw || !vh) return;
		host.style.position = 'absolute';
		host.style.left = '0';
		host.style.top = '0';
		host.style.margin = '0';
		host.style.width = '100%';
		host.style.height = '100%';
		host.style.boxSizing = 'border-box';
		host.style.transform = '';
		this._fitPipInner();
	},
	// 播放器内部各层跟着宿主铺满；弹幕层再对齐到**画面实际占据的区域**。
	//
	// 窗口比例（如 1.51:1）和视频比例（16:9）通常不一致，画面按 contain 居中、
	// 上下会留黑边。如果弹幕层铺满整个窗口，弹幕就会飞到黑边上；所以这里按
	// 视频尺寸算出画面矩形（居中、保持比例），把弹幕层钉在这个矩形上。
	// 每次窗口尺寸变化都重算，内容始终随容器自适应。
	// 播放器内部各层铺满宿主。
	//
	// 只注入一次、**不随窗口尺寸重写**：这条样式表覆盖播放器内部结构，
	// 每改一次就是一次全量样式重算 + 重排；拖动 PiP 窗口时 resize 事件
	// 每帧都来，重写它会把画面拖卡（实测拖动过程明显掉帧）。
	// 规则里全是 100%，本身就跟尺寸无关，注入一次即可。
	_fitPipInner: function () {
		var win = this._pipWin;
		var doc = win && win.document;
		if (!doc || !doc.head) return;
		if (doc.getElementById('__sepWinPipFit')) return;
		var st = doc.createElement('style');
		st.id = '__sepWinPipFit';
		st.textContent = [
			// 宿主（搬进来的那块区域）无条件跟随容器。
			// 站点在窗口尺寸变化时会自己给播放器写**像素**尺寸（内联 style），
			// 只靠 resize 事件里重写 100% 会被它抢回去（事件合并/延迟时就抢不过），
			// 表现就是"窗口变大了，里面的元素没跟着变"。用 !important 的 CSS 兜住。
			'#__sepWinPipWrap > :first-child{position:absolute!important;left:0!important;top:0!important;margin:0!important;width:100%!important;height:100%!important;box-sizing:border-box!important;transform:none!important}',
			// 镜像画布按容器**重新布局**成 100%，而不是沿用源视频元素自己的尺寸
			// 再被拉伸（源 600×600、窗口 1200×1200 时那样就是糊/马赛克）。
			'#__sepWinPipWrap #__sepWinPipVideo{position:absolute!important;left:0!important;top:0!important;width:100%!important;height:100%!important;object-fit:contain!important;image-rendering:auto!important}',
			// 结构层铺满窗口（站点自己的 CSS 会按新尺寸重排）
			'#__sepWinPipWrap .bpx-player-video-area,#__sepWinPipWrap .bpx-player-video-perch,#__sepWinPipWrap .bpx-player-video-wrap{width:100%!important;height:100%!important}',
			'#__sepWinPipWrap .bpx-player-primary-area,#__sepWinPipWrap .bpx-player-container{width:100%!important;height:100%!important}',
			// 弹幕层必须显式给尺寸：它们是绝对定位且没有内联宽高，父级变 100% 后
			// 会塌成 0×0（实测 55 个弹幕元素全都没有尺寸，画面上一片空）。
			// 用 100% 而不是按画面矩形写像素，这样规则与窗口尺寸无关，
			// 注入一次就够，拖动窗口时不必重写样式表（重写会明显卡顿）。
			'#__sepWinPipWrap .bpx-player-row-dm-wrap,#__sepWinPipWrap .bpx-player-adv-dm-wrap,#__sepWinPipWrap .bpx-player-cmd-dm-wrap,#__sepWinPipWrap .bpx-player-bas-dm-wrap{position:absolute!important;left:0!important;top:0!important;width:100%!important;height:100%!important}'
		].join('\n');
		doc.head.appendChild(st);
	},	// 搬走的区域如果不带样式表，会丢掉页面全部样式。
	// 把页面的样式表补进 PiP 文档。**必须是增量的**：
	// 播放器/弹幕的 CSS 是站点在播放开始后动态注入的（实测页面最终有 49 个
	// <style>，而首次打开时只有两三个），只在打开时复制一次的话，
	// 后面注入的弹幕样式全缺 —— 弹幕条目会丢掉定位/动画规则，
	// 变成一条条铺满宽度的方块。看门狗每轮都会调这里补差。
	_copyPageStyles: function () {
		var win = this._pipWin;
		if (!win || win.closed) return;
		var doc = win.document;
		if (!doc || !doc.head) return;
		if (!this._pipStyleKeys) this._pipStyleKeys = {};
		var keys = this._pipStyleKeys;
		var nodes = document.querySelectorAll('link[rel~="stylesheet"], style');
		for (var i = 0; i < nodes.length; i++) {
			var n = nodes[i];
			if (n.tagName === 'LINK') {
				if (!n.href) continue;
				var lk = 'L|' + n.href;
				if (keys[lk]) continue;
				keys[lk] = 1;
				var l = doc.createElement('link');
				l.rel = 'stylesheet';
				l.href = n.href;
				doc.head.appendChild(l);
				continue;
			}
			var text = n.textContent || '';
			if (!text) continue;
			// 用长度 + 头尾片段做指纹，够区分内容，也避免每轮全量比较
			var sk = 'S|' + text.length + '|' + text.slice(0, 60) + '|' + text.slice(-40);
			if (keys[sk]) continue;
			keys[sk] = 1;
			var s = doc.createElement('style');
			s.textContent = text;
			doc.head.appendChild(s);
		}
	},	// 在 PiP 窗口里构建与经典窗口相同的七个按钮的控制面板。
	// ButtonPanel 存在于页面文档中，
	// 因此 PiP 文档需要自己的副本（否则窗口里没有菜单）。
	_addPipPanel: function (pipWin) {
		var self = this;
		var doc = pipWin.document;
		var panel = doc.createElement('div');
		panel.id = '__btn_panel';
		panel.className = '__sepWin __sepWinBtn';
		panel.innerHTML =
			'<button id="__btn_back" class="__sepWinBtn" title="' +
				chrome.i18n.getMessage('PanelBack') + '"></button>' +
			'<button id="__btn_save" class="__sepWinBtn btn_save_off" title="' +
				chrome.i18n.getMessage('PanelSaveSizeOff') + '"></button>' +
			'<button id="__btn_up" class="__sepWinBtn" title="' +
				chrome.i18n.getMessage('PanelScrollUp') + '"></button>' +
			'<button id="__btn_dwn" class="__sepWinBtn" title="' +
				chrome.i18n.getMessage('PanelScrollDown') + '"></button>' +
			'<button id="__btn_prsc" class="__sepWinBtn" title="' +
				chrome.i18n.getMessage('PanelPrintScreen') + '"></button>' +
			'<button id="__btn_bkm" class="__sepWinBtn btn_bkm_off" title="' +
				chrome.i18n.getMessage('PanelBookMarks') + '"></button>' +
			'<button id="__btn_link" class="__sepWinBtn" title="' +
				chrome.i18n.getMessage('PanelGetLink') + '"></button>';
		doc.body.appendChild(panel);
		this._pipPanel = panel;

		// 让书签状态回包指向这些按钮，而不是
		// 页面上（并不存在的）面板。
		use('ButtonPanel').btn_bkm = panel.querySelector('#__btn_bkm');

		doc.addEventListener('click', function (e) {
			var t = e.target;
			if (!t || !t.id) return;
			if (String(t.className || '').indexOf('__sepWin') === -1) return;
			e.preventDefault();
			e.stopPropagation();
			switch (t.id) {
				case '__btn_back':
					self.cancelPip();
					break;
				case '__btn_save':
					self._pipToggleSave();
					break;
				case '__btn_up':
					self._pipNavUp();
					break;
				case '__btn_dwn':
					self._pipNavDown();
					break;
				case '__btn_prsc':
					use('__BgCmd').sendCmd('printScr', { name: window.location.hostname });
					break;
				case '__btn_bkm':
					if (self._pip) use('Bookmarks').addBookmark(self._pip.target);
					break;
				case '__btn_link':
					if (self._pip) self._showPipLink(doc, self._pip.target);
					break;
			}
		}, true);

		this._updatePipState();
	},
	// 在 PiP 工具栏上反映当前节点/尺寸保存状态。
	_updatePipState: function () {
		var p = this._pipPanel, st = this._pip;
		if (!p || !st) return;
		var isBody = (st.target === document.body);
		var up = p.querySelector('#__btn_up'),
			dwn = p.querySelector('#__btn_dwn'),
			save = p.querySelector('#__btn_save');
		var parent = st.parent;
		var canUp = !isBody && !!parent && parent !== document.body &&
			parent !== document.documentElement;
		var canDown = this._pipStack && this._pipStack.length > 0;

		// 整页显示时，经典窗口会隐藏这三个按钮。
		up.style.display = isBody ? 'none' : '';
		dwn.style.display = isBody ? 'none' : '';
		save.style.display = isBody ? 'none' : '';

		if (canUp) { up.classList.remove('disable'); } else { up.classList.add('disable'); }
		if (canDown) { dwn.classList.remove('disable'); } else { dwn.classList.add('disable'); }

		var saved = !!this._sizes[this._areaSelector || this.selector || st.selector];
		save.classList.remove(saved ? 'btn_save_off' : 'btn_save_on');
		save.classList.add(saved ? 'btn_save_on' : 'btn_save_off');
		save.setAttribute('title',
			chrome.i18n.getMessage(saved ? 'PanelSaveSizeOn' : 'PanelSaveSizeOff'));
	},
	// 保存/清除当前区域的"尺寸 + 位置"。
	// 保存时连同当前区域（选择器）一起交给后台：区域还没进站点记录的话，
	// 后台会先登记，否则尺寸会落到一个不存在的槽位上、静默丢失。
	_pipToggleSave: function () {
		var st = this._pip;
		if (!st || !this._pipWin) return;
		var sel = st.selector;
		// 键必须和 _openDocPip 查的是同一个。用 _areaSelector（这次弹出对应的区域）：
		// 上一级/下一级之后 this.selector 会变成父级/子级的选择器，若拿它当键，
		// 保存就会存到另一个槽位上 —— 表现正是"上下级切换后保存，当前区域没变"。
		sel = this._areaSelector || this.selector || sel;
		var win = this._pipWin;
		if (this._sizes[sel]) {
			delete this._sizes[sel];
			use('__BgCmd').sendCmd('saveAreaState', { selector: sel, size: '{}' });
		} else {
			var size = {
				width: Math.round(win.innerWidth),
				height: Math.round(win.innerHeight)
			};
			/* PiP 窗口本身是独立原生窗口，screenX/Y 就是它在屏幕上的位置。
			   浏览器不允许脚本摆放 PiP 窗口，所以位置只是记下来：
			   同一区域以后用经典窗口打开时会沿用它。 */
			try {
				if (typeof win.screenX === 'number') {
					size.left = Math.round(win.screenX);
					size.top = Math.round(win.screenY);
				}
			} catch (e) { }
			var prev = this._sizes[sel];
			if (prev && size.left === undefined && prev.left !== undefined) {
				size.left = prev.left;
				size.top = prev.top;
			}
			this._sizes[sel] = size;
			use('__BgCmd').sendCmd('saveAreaState', { selector: sel, size: JSON.stringify(size) });
		}
		this._updatePipState();
	},
	// 上一级/下一级换了区域：这一层就是"当前区域"。
	//
	// 之前这里刻意不写存储，结果用户翻到上一层/下一层后，下次点图标打开的
	// 还是原来那一层 —— 明明面板上显示的就是新层级。现在和经典窗口的
	// saveSelector 保持一致：把站点记录里的这条区域改名成新选择器。
	_followArea: function (previous) {
		var current = this._pip && this._pip.selector;
		if (!current || !previous || current === previous || current === 'BODY') return;
		this.selector = current;
		// 区域身份跟着走：之后保存尺寸、面板"已保存"状态都按新层级算
		this._areaSelector = current;
		if (this._sizes[previous]) {
			this._sizes[current] = this._sizes[previous];
			delete this._sizes[previous];
		}
		// 站点记录改名：下次打开就是这一层
		use('__BgCmd').sendCmd('renameArea', { from: previous, to: current });
		this._updatePipState();
	},
	// 显示父元素（经典窗口的"上一级"）。
	_pipNavUp: function () {
		var st = this._pip;
		if (!st) return;
		var parent = st.parent;
		if (!parent || parent === document.body || parent === document.documentElement) return;
		// 用"区域"的选择器而不是 st.selector：点视频时 st.selector 是播放器容器
		// （DIV.bpx-player-video-area），而站点记录里登记的是点击的那块（VIDEO）。
		// 拿容器去改名会找不到槽位，存储看起来毫无变化。
		var previous = this._areaSelector || st.selector;
		this._pipStack.push(st.target);
		this._showNode(parent);
		this._followArea(previous);
	},
	// 回到之前显示的子元素（经典窗口的"下一级"）。
	_pipNavDown: function () {
		if (!this._pipStack || !this._pipStack.length) return;
		var previous = this._areaSelector || (this._pip ? this._pip.selector : '');
		this._showNode(this._pipStack.pop());
		this._followArea(previous);
	},
	// 把当前挂载的节点放回原处。
	_restorePipNode: function () {
		var st = this._pip;
		try {
			// 顺序很重要：**先**把宿主搬回页面，再把视频放回宿主内部。
			// 反过来的话，视频会被插进一个还留在（可能已销毁的）PiP 文档里的父节点，
			// 结果是页面连 <video> 都没了 —— 实测直播页就是这样被掏空的。
			// 1. 把显示的区域搬回去
			if (st) {
				this._pip = null;
				// 整页模式改过 body 的内联样式（缩放/尺寸），搬回去前先清掉
				if (st.target && st.target.tagName === 'BODY') {
					/* 整页模式改过 body 的 zoom，搬回页面之前清掉 */
					if (this._wholePage) this._wholePage.reset(st.target);
					this._wholeScale = 1;
				}
				if (st.parent && st.target.parentNode !== st.parent) {
					var ref = (st.next && st.next.parentNode === st.parent) ? st.next : null;
					st.parent.insertBefore(st.target, ref);
				}
			}
			// 2. 把真实 <video> 放回宿主里原来的位置（此时宿主已经回到页面）
			var parked = this._pipParked;
			if (parked) {
				this._pipParked = null;
				try {
					var home = parked.parent;
					// 宿主可能已经被销毁/换掉：那就退回页面里可见的容器
					if (!home || (home.isConnected === false)) {
						home = (st && st.target && st.target.isConnected !== false) ? st.target : document.body;
					}
					if (home) {
						if (parked.next && parked.next.parentNode === home) {
							home.insertBefore(parked.video, parked.next);
						} else {
							home.appendChild(parked.video);
						}
					}
					// 停靠时改过的内联样式要清掉，否则视频还是 1×1 藏在屏幕外
					parked.video.style.position = '';
					parked.video.style.left = '';
					parked.video.style.top = '';
					parked.video.style.width = '';
					parked.video.style.height = '';
				} catch (e) {
					console.error('[SepWin] failed to restore the video element:', e);
				}
			}
			// 3. 清掉临时的停靠区（视频已经放回去了）
			var park = document.getElementById('__sepWinPark');
			if (park && park.parentNode) park.parentNode.removeChild(park);
			// 4. 删掉跟着区域一起搬回来的镜像
			var views = document.querySelectorAll('#__sepWinPipVideo');
			for (var i = 0; i < views.length; i++) {
				if (views[i].parentNode) views[i].parentNode.removeChild(views[i]);
			}
			// 4. 还原我们改过的内联样式（缩放/位置/尺寸）
			if (this._pipHost) {
				if (this._pipHostCss === null || this._pipHostCss === undefined) {
					this._pipHost.removeAttribute('style');
				} else {
					this._pipHost.setAttribute('style', this._pipHostCss);
				}
				this._pipHost = null;
				this._pipHostCss = null;
				this._pipHostSize = null;
			}
		} catch (e) {
			console.error('[SepWin] failed to restore node from PiP:', e);
		}
	},
	// 关闭 PiP 窗口（节点由 pagehide 里的 _restorePip 放回）。
	cancelPip: function () {
		if (this._pipWin && !this._pipWin.closed) {
			this._pipWin.close();
		} else {
			this._restorePip();
		}
	},
	// 在 PiP 文档里渲染"获取链接"浮层。
	_showPipLink: function (doc, target) {
		var old = doc.getElementById('__pip_link_overlay');
		if (old) { old.parentNode.removeChild(old); return; }
		var ov = doc.createElement('div');
		ov.id = '__pip_link_overlay';
		ov.style.cssText = 'position:fixed;inset:0;z-index:2147483647;' +
			'background:rgba(15,23,42,.72);display:flex;align-items:center;justify-content:center;';
		var box = doc.createElement('div');
		box.style.cssText = 'width:92%;max-width:420px;background:#fff;border-radius:12px;' +
			'padding:12px;display:flex;flex-direction:column;gap:10px;' +
			'font:600 13px/1.4 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;';
		var ta = doc.createElement('textarea');
		ta.value = use('Selector').getLink(target);
		ta.style.cssText = 'width:100%;height:110px;border:1px solid #d7dce6;border-radius:8px;' +
			'padding:8px;font:12px/1.5 ui-monospace,Consolas,monospace;resize:none;';
		var ok = doc.createElement('button');
		ok.textContent = 'OK';
		ok.style.cssText = 'align-self:center;width:72px;height:28px;border:none;border-radius:7px;' +
			'color:#fff;background:linear-gradient(135deg,#3b82f6,#2563eb);cursor:pointer;' +
			'font-weight:600;';
		ok.addEventListener('click', function () {
			if (ov.parentNode) ov.parentNode.removeChild(ov);
		});
		box.appendChild(ta);
		box.appendChild(ok);
		ov.appendChild(box);
		doc.body.appendChild(ov);
		ta.focus();
		ta.select();
	},
	// 记住/还原被我们改过内联样式的元素。
	// 为什么需要：PiP 期间为了"留在渲染树里继续解码"，会把真实的 <video>
	// 停到屏幕外（1×1、left:-10000px），站点还可能中途换掉源元素、我们再接管
	// 新的那个。关窗时如果只还原"当初记录的那个"，被接管的新元素就会一直停在
	// 停放样式上 —— 页面播放器一片黑，就是"主窗口没恢复"。
	_rememberStyle: function (el) {
		if (!el || !el.style) return;
		if (!this._styledEls) this._styledEls = [];
		for (var i = 0; i < this._styledEls.length; i++) {
			if (this._styledEls[i].el === el) return;
		}
		this._styledEls.push({ el: el, css: el.getAttribute('style') || '' });
	},
	_restoreStyles: function () {
		var list = this._styledEls || [];
		this._styledEls = [];
		for (var i = 0; i < list.length; i++) {
			try {
				var it = list[i];
				if (!it || !it.el) continue;
				if (it.css) it.el.setAttribute('style', it.css);
				else it.el.removeAttribute('style');
			} catch (e) { }
		}
	},
	// PiP 窗口关闭后，把搬走的节点放回原处。
	_restorePip: function () {
		this._stopWatchdog();
		this._stopMirror();
		this._releaseWakeLock();
		this._visibilityShim(false);
		this._viewportShim(false);
		this._keepAwake(false);
		this._pipVideo = null;
		this._pipView = null;
		this._lastFrames = null;
		this._restorePipNode();
		// 接管过程中被我们改过样式的元素（含站点中途换掉的源视频）全部还原，
		// 否则页面里的 <video> 还停在 1×1、屏幕外的停放样式上，播放器是黑的。
		this._restoreStyles();
		this._pipStack = [];
		this._pipPanel = null;
		this._hostScale = 1;
		// 新的 PiP 文档需要重新补样式
		this._pipStyleKeys = null;
		this._pipWin = null;
		// 回到主窗口：置顶窗口一关，浏览器不会自动把焦点还给原来的窗口，
		// 用户就停在别的应用上，看起来"主窗口没恢复"。这里让后台把标签页
		// 所在的窗口拉到前台（只要焦点，不改窗口状态）。立刻发一次，
		// 500ms 后再补一次：关窗瞬间 Windows 正在切换前台窗口，一次不一定生效。
		try {
			use('__BgCmd').sendCmd('restoreWin', 'focus');
			setTimeout(function () {
				try { use('__BgCmd').sendCmd('restoreWin', 'focus'); } catch (e) { }
			}, 500);
		} catch (e) { }
		// 丢掉 PiP 工具栏按钮的引用，避免后续书签状态
		// 更新碰到已经脱离文档的节点。
		use('ButtonPanel').btn_bkm = {};
	},
	// 在页面内没有手势时（弹窗/右键菜单触发）显示：
	// 点一下这个横幅即可提供 API 所需的用户激活。
	_promptActivate: function (target) {
		var self = this;
		if (this._promptEl && this._promptEl.parentNode) {
			this._promptEl.parentNode.removeChild(this._promptEl);
		}
		var box = document.createElement('div');
		box.id = '__sepWinPipPrompt';
		box.textContent = chrome.i18n.getMessage('docPipActivate') ||
			'Click here to open in a top-most window';
		box.style.cssText =
			'position:fixed;left:50%;top:24px;transform:translateX(-50%);z-index:2147483647;' +
			'padding:12px 20px;border-radius:10px;background:rgba(17,24,39,.94);color:#fff;' +
			'font:600 14px/1.4 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;' +
			'box-shadow:0 10px 30px rgba(0,0,0,.4);cursor:pointer;user-select:none;';
		box.addEventListener('click', function (e) {
			e.preventDefault();
			e.stopImmediatePropagation();
			if (box.parentNode) box.parentNode.removeChild(box);
			self._openDocPip(target);
		}, true);
		document.body.appendChild(box);
		this._promptEl = box;
		setTimeout(function () {
			if (box.parentNode) box.parentNode.removeChild(box);
		}, 20000);
	},
	blockEvent: function (e) {
		e.preventDefault();
		e.stopPropagation();
		e.stopImmediatePropagation();
	},
	cancel: function () {
		use('Selector').restoreURL();
		this._visibilityShim(false);
		use('__BgCmd').sendCmd('cancel', {});
		use('CmdToFrame').remove();
		use('Modification').cancel();
		use('ButtonPanel').remove();
		use('EventPanel').remove();
		use('SepWinEvents').removeEvents();
	},
	dellIcon: function () {
		use('Observer').disconnectDomChange();
		use('__Icons').delAllIcon();
	},
	responseSelectors: function () {
		use('__BgCmd').sendCmd('getItems', {});
	},
	saveSelector: function (newSelector) {
		use('__BgCmd').sendCmd('saveSelector', { prop: { name: 'css', value: newSelector } });
	},
	// 经典窗口的尺子按钮：把"当前区域 + 尺寸/位置"一起存下来。
	// 区域还没登记时后台会先登记（以前这种情况会静默存不上）。
	saveAreaState: function (newSize) {
		use('__BgCmd').sendCmd('saveAreaState', {
			selector: this.selector,
			size: newSize
		});
	},
	start: function () {
		if (use('Modification').isSeparate) return;
		if (!this.run) {
			this.run = !this.run;
			this.dellIcon();
			use('__Element').addWrapper();
			window.addEventListener('mousedown', __AppPanel.blockEvent, true);
			window.addEventListener('mouseup', __AppPanel.blockEvent, true);
			window.addEventListener('mousemove', __AppPanel.mouseMove, true);
			window.addEventListener('mouseover', __AppPanel.mouseOver, true);
			window.addEventListener('wheel', __AppPanel.mouseScroll, true);
			window.addEventListener('click', __AppPanel.mouseClick, true);
			window.addEventListener('keydown', __AppPanel.keyPress, true);
		} else {
			this.stop();
		}
	},
	stop: function () {
		if (this.run) {
			this.run = !this.run;
			this.responseSelectors();
			use('__Element').delWrapper();
			use('__Element').reset();
			window.removeEventListener('mousedown', __AppPanel.blockEvent, true);
			window.removeEventListener('mouseup', __AppPanel.blockEvent, true);
			window.removeEventListener('mousemove', __AppPanel.mouseMove, true);
			window.removeEventListener('mouseover', __AppPanel.mouseOver, true);
			window.removeEventListener('wheel', __AppPanel.mouseScroll, true);
			window.removeEventListener('click', __AppPanel.mouseClick, true);
			window.removeEventListener('keydown', __AppPanel.keyPress, true);
		}
	},
	mouseOver: function (e) {
		this.blockEvent(e);
		if (e.target && e.target !== document) {
			var tagName = e.target.tagName.toUpperCase() || undefined;
			switch (tagName) {
				case 'VIDEO':
				case 'EMBED':
				case 'OBJECT':
				case 'IFRAME':
				case 'SVG':
					use('__Element').set(e.target);
					this.scroll = 0;
					break;
				case 'G':
				case 'PATH':
				case 'RECT':
					use('__Element').set(e.target.parentNode);
					this.scroll = 0;
					break;
			}
		}
	},
	mouseClick: function (e) {
		this.blockEvent(e);
		// 兜底：真点到拦截层/浮层上时，换成它下面那个真实元素（或播放器容器）
		var proto = use('__Element').prototype;
		var real = this._resolveTarget(e.clientX, e.clientY, proto);
		if (real && real !== proto && !this._isGhostLayer(real)) use('__Element').set(real);
		if (use('__Element').prototype) {
			this.apply(use('__Element').prototype);
		} else {
			this.stop();
		}
	},
	mouseScroll: function (e) {
		this.blockEvent(e);
		e.wheelDelta > 0 ? this.scroll++ : this.scroll--;
		var i = 0, target = this.target;
		while (this.scroll != i) {
			if (this.scroll > 0 && target.parentNode.tagName !== 'BODY') {
				target = target.parentNode;
				i++;
			} else {
				target = this._getFromPoint(e.clientX, e.clientY);
				i = this.scroll = 0;
			}
		}
		use('__Element').set(target);
	},
	mouseMove: function (e) {
		this.blockEvent(e);
		if ((e.timeStamp - this.lastEv) < 30) { return true; }

		this.lastEv = e.timeStamp;
		// 悬停在"透明拦截层"或"盖住播放器的浮层"上时，解析成下面真正的元素/容器，
		// 否则整块播放器鼠标怎么划都选不中。
		var target = this._resolveTarget(e.clientX, e.clientY, e.target);
		if (target.id == '__panelWrapper') {
			use('__Element').hideWrapper();
			target = document.elementFromPoint(e.clientX, e.clientY);
			if ('elementsFromPoint' in document) {
			// Chrome 43
				document.elementsFromPoint(e.clientX, e.clientY).forEach(function (element) {
					switch (element.tagName.toUpperCase()) {
						case 'VIDEO':
						case 'EMBED':
						case 'OBJECT':
						case 'SVG':
							target = element;
							break;
					}
				}, this);
			}
			use('__Element').showWrapper();
		}

		if (target === this.target || target == document) { return true; }

		this.target = target;

		if (this.target && this.target.tagName !== 'BODY') {
			use('__Element').set(this.target);
			this.scroll = 0;
		}
	},
	keyPress: function (e) {
		switch (e.keyCode) {
			case 27:
				__AppPanel.stop();
				break;
		}
	}
};
__AppPanel.blockEvent = __AppPanel.blockEvent.bind(__AppPanel);
__AppPanel.mouseOver = __AppPanel.mouseOver.bind(__AppPanel);
__AppPanel.mouseMove = __AppPanel.mouseMove.bind(__AppPanel);
__AppPanel.mouseClick = __AppPanel.mouseClick.bind(__AppPanel);
__AppPanel.mouseScroll = __AppPanel.mouseScroll.bind(__AppPanel);

var __onLoad = function () {
	if(use('Bookmarks').isEntireTab){
		use('Bookmarks').isEntireTab = false;
		__AppPanel.updateTab();
	}else{
		__AppPanel.responseSelectors();
		use('Bookmarks').domChange();
		use('__BgCmd').sendCmd('isDuplicate', {});	
	}
};
use('Bookmarks').getHash();
__AppPanel._initCfg();
window.addEventListener('DOMContentLoaded', __onLoad);

// ---- 注册表 ----
register('__AppPanel', __AppPanel);
register('__onLoad', __onLoad);
