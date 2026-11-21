// @ts-nocheck -- 遗留文件体：模块边界已就位，类型迁移留到后续步骤。
import { register, use } from './runtime';


/**
 * 作者：Kashimura
 */
var __AppPanel = {
	lastEv: 0,
	run: false,
	scroll: 0,
	target: {},
	selector: '',
	// 站点常拿一层"透明拦截层"盖住播放器（B 站是 geetest 验证码浮层）：
	// 它没有可见内容、却总在最上面，点哪儿选中的都是它 —— 弹出后自然拿不到
	// 播放器和弹幕层，保存下来的区域也成了这条垃圾记录。选区域时必须穿透它。
	_isGhostLayer: function (el) {
		if (!el || el.nodeType !== 1) return false;
		if (el === document.body || el === document.documentElement) return false;
		var cs;
		try { cs = window.getComputedStyle(el); } catch (e) { return false; }
		if (!cs) return false;
		if (cs.display === 'none' || cs.visibility === 'hidden') return true;
		if (parseFloat(cs.opacity) === 0) return true;
		var r = el.getBoundingClientRect();
		return r.width < 2 || r.height < 2;
	},
	// 光标下面有 <video>、但命中的元素并不是它（而是盖在上面的浮层，比如
	// 验证码层 geetest_bg）时，用户想点的显然是播放器 —— 取视频外面那层容器，
	// 这样弹出来的窗口里才有弹幕层和播放控件。
	_videoHostFor: function (stack, target) {
		if (!stack || !stack.length) return null;
		for (var i = 0; i < stack.length; i++) {
			var v = stack[i];
			if (!v || v.tagName !== 'VIDEO') continue;
			if (v === target || v.contains(target)) return null;	// 就点在视频里：维持"只镜像视频"
			var n = v;
			for (var j = 0; j < 4 && n; j++) {
				n = n.parentElement;
				if (!n || n === document.body || n === document.documentElement) break;
				var r = n.getBoundingClientRect();
				if (r.width >= 200 && r.height >= 120) return n;
			}
			return null;
		}
		return null;
	},
	// 统一入口：把"光标下的元素"解析成用户真正想选的那个。
	_resolveTarget: function (x, y, hovered) {
		var stack = document.elementsFromPoint ? (document.elementsFromPoint(x, y) || []) : null;
		if (!hovered || this._isGhostLayer(hovered)) return this._getFromPoint(x, y);
		var host = this._videoHostFor(stack, hovered);
		return host || hovered;
	},
	_getFromPoint: function (x, y) {
		use('__Element').hideWrapper();
		var target = document.elementFromPoint(x, y);
		var stack = document.elementsFromPoint ? (document.elementsFromPoint(x, y) || []) : null;
		// 命中的是不可见拦截层：从下往上取第一个真实元素（跳过扩展自己的覆盖层）
		if (this._isGhostLayer(target) && stack) {
			for (var i = stack.length - 1; i >= 0; i--) {
				var el = stack[i];
				if (!el) continue;
				if (el.id && el.id.indexOf('__') === 0) continue;
				if (this._isGhostLayer(el)) continue;
				target = el;
				break;
			}
		}
		// 点在被浮层盖住的播放器上：换成视频外面那层容器
		var host = this._videoHostFor(stack, target);
		if (host) target = host;
		use('__Element').showWrapper();
		return target;
	},
	_prepare: function (target) {
		use('Selector').href = document.location.href;
		this.selector = use('Selector').getSelector(target);
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
		var isBody = (target == document.body);
		var width = isBody ? Math.min(window.innerWidth, 1280)
			: Math.max(160, Math.round(use('__Element').size.width));
		var height = isBody ? Math.min(window.innerHeight, 800)
			: Math.max(160, Math.round(use('__Element').size.height));
		// 如果这个选择器存过尺寸，就复用。
		var saved = this._sizes[this.selector];
		if (saved && saved.width > 80 && saved.height > 80) {
			width = Math.round(saved.width);
			height = Math.round(saved.height);
		}
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
	_createMirror: function (video, className, cssText) {
		var doc = this._pipWin.document;
		var view = doc.createElement('canvas');
		view.id = '__sepWinPipVideo';
		if (className) view.className = className;
		view.style.cssText = (cssText ? cssText.replace(/\s*;?\s*$/, ';') : '') +
			'pointer-events:none;background:#000;display:block;';
		return view;
	},
	// 每帧把源元素画到镜像画布上。
	// 帧时钟用"PiP 窗口的 rAF + 定时器兜底"：rAF 一旦被系统节流（窗口被遮挡、
	// 合成器停摆），定时器还能把循环续上，画面不至于就这么定格。约 32 帧/秒，
	// 够顺滑，也不至于白烧 CPU。
	_startMirror: function (video, view) {
		var self = this;
		this._stopMirror();
		var win = this._pipWin;
		if (!win || !view) return;
		var ctx = null;
		try { ctx = view.getContext('2d', { alpha: false }); } catch (e) { }
		if (!ctx) return;
		this._mirrorOn = true;
		this._mirrorFrames = 0;
		var MIN_GAP = 1000 / 32;
		var last = 0;
		var scheduled = false;

		var paint = function () {
			if (!video || !video.videoWidth) return;
			if (view.width !== video.videoWidth || view.height !== video.videoHeight) {
				view.width = video.videoWidth;
				view.height = video.videoHeight;
			}
			ctx.drawImage(video, 0, 0);
			self._mirrorFrames++;
		};
		var finish = function () {
			if (!scheduled) return;   // 这一帧已经被另一种时钟跑掉了
			scheduled = false;
			if (self._mirrorTimer) { clearTimeout(self._mirrorTimer); self._mirrorTimer = 0; }
			if (self._mirrorFrame) {
				try { win.cancelAnimationFrame(self._mirrorFrame); } catch (e) { }
				self._mirrorFrame = 0;
			}
			if (!self._mirrorOn) return;
			var now = 0;
			try { now = win.performance.now(); } catch (e) { now = Date.now(); }
			if (now - last >= MIN_GAP) {
				last = now;
				try { paint(); } catch (e) { self._mirrorOn = false; return; }
			}
			schedule();
		};
		var schedule = function () {
			if (!self._mirrorOn || scheduled) return;
			scheduled = true;
			try {
				self._mirrorFrame = win.requestAnimationFrame(finish);
			} catch (e) { self._mirrorFrame = 0; }
			/* rAF 不来的时候（遮挡/合成器停摆）由定时器兜底，保证循环不断。 */
			self._mirrorTimer = setTimeout(finish, 100);
		};
		schedule();
	},
	_stopMirror: function () {
		this._mirrorOn = false;
		var win = this._pipWin;
		if (this._mirrorFrame && win && win.cancelAnimationFrame) {
			try { win.cancelAnimationFrame(this._mirrorFrame); } catch (e) { }
		}
		if (this._mirrorTimer) { clearTimeout(this._mirrorTimer); }
		this._mirrorFrame = 0;
		this._mirrorTimer = 0;
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
		var lastFrames = -1, lastResume = 0;
		var lastSrcFrames = -1, lastSrcMove = Date.now(), lastNudge = 0, sawSrcFrames = false;
		self._heals = 0;

		this._watchdog = setInterval(function () {
			var win = self._pipWin;
			if (!win || win.closed) { self._stopWatchdog(); return; }
			var video = self._pipVideo, view = self._pipView;
			if (!video || !view) return;
			var now = Date.now();
			self._suppressForeignVideos();
			// a) 保持源视频解码（Chrome 可能暂停隐藏标签页的媒体）
			try {
				if (video.paused && !video.ended && now - lastResume > 10000) {
					lastResume = now;
					var p = video.play();
					if (p && p.catch) p.catch(function () { });
				}
			} catch (e) { }
			// a2) 站点把源元素换掉了（断流重连、切换播放器）：我们的引用已经脱离文档，
			//     画面会一直停在最后一帧，而新元素照旧发声。接管页面上还在播的那个。
			if (!video.isConnected) {
				var fresh = self._findPlayableVideo(video);
				if (fresh) {
					try {
						/* 挪到 PiP 窗口可视区之外但仍在渲染树里：继续解码，不会露出来 */
						fresh.style.display = '';
						fresh.style.position = 'fixed';
						fresh.style.left = '-10000px';
						fresh.style.top = '0';
						fresh.style.width = '1px';
						fresh.style.height = '1px';
					} catch (e) { }
					self._pipVideo = fresh;
					self._startMirror(fresh, view);
					video = fresh;
					lastSrcFrames = -1;
					sawSrcFrames = false;
				}
			}
			// b) 绘制循环必须还在出帧；断了就重起。
			var frames = self._mirrorFrames | 0;
			if (!self._mirrorOn || frames === lastFrames) {
				self._startMirror(video, view);
			}
			lastFrames = self._mirrorFrames | 0;
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
		// 用户拖动改变 PiP 窗口大小时，保持区域跟随。
		pipWin.addEventListener('resize', function () {
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
				// 区域本身就是 video：只镜像，绝不搬动（搬动直播 MSE
				// 播放器正是黑屏的原因）。
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
	_fitWholePage: function () {
		var st = this._pip;
		var win = this._pipWin;
		if (!st || !win || !st.target || st.target.tagName !== 'BODY') return;
		var body = st.target;
		if (!body.style) return;
		body.style.zoom = '';				// 先按 100% 量一次自然宽度
		var vw = win.innerWidth | 0;
		if (!vw) return;
		var natW = Math.max(body.scrollWidth | 0, body.offsetWidth | 0, 1);
		var scale = Math.min(vw / natW, 1);
		// 只有放不下才缩；纵向交给滚动条，按高度缩放会把整页压到看不清。
		body.style.zoom = scale < 0.999 ? String(scale) : '';
		this._wholeScale = scale;
	},
	// 把区域的 DOM 移进 PiP 文档，真实 <video> 留在页面里
	// （停在屏幕外，继续播放），由镜像副本占位。
	// 这样 MSE 流不会断，上一级/下一级也能照常切换区域。
	_showHostMirror: function (host, video) {
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
		// 区域进入 PiP 文档后失去了页面的布局上下文，
		// 于是给它 PiP 窗口的盒子，让站点 CSS 在此重新排版。
		wrap.appendChild(host);
		this._fitPipHost();
		this._pipVideo = video;
		this._pipView = view;
		this._startMirror(video, view);
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
	_fitPipHost: function () {
		var host = this._pipHost, win = this._pipWin;
		if (!host || !win) return;
		var vw = win.innerWidth || 0, vh = win.innerHeight || 0;
		if (!vw || !vh) return;
		host.style.position = 'absolute';
		host.style.left = '0';
		host.style.top = '0';
		host.style.margin = '0';
		host.style.width = vw + 'px';
		host.style.height = vh + 'px';
		host.style.boxSizing = 'border-box';
	},
	// 搬走的区域如果不带样式表，会丢掉页面全部样式。
	_copyPageStyles: function () {
		if (this._pipStylesCopied) return;
		this._pipStylesCopied = true;
		var doc = this._pipWin.document;
		var nodes = document.querySelectorAll('link[rel~="stylesheet"], style');
		for (var i = 0; i < nodes.length; i++) {
			var n = nodes[i];
			if (n.tagName === 'LINK') {
				if (!n.href) continue;
				var l = doc.createElement('link');
				l.rel = 'stylesheet';
				l.href = n.href;
				doc.head.appendChild(l);
			} else {
				var s = doc.createElement('style');
				s.textContent = n.textContent;
				doc.head.appendChild(s);
			}
		}
	},
	// 在 PiP 窗口里构建与经典窗口相同的七个按钮的控制面板。
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

		var saved = !!this._sizes[st.selector];
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
	// 上一级/下一级换了区域：只把"当前区域"同步给面板，浏览层级本身不写存储。
	//
	// 以前在这里改名/搬几何，用户的区域会被换成父级甚至整页 ——
	// 之后点站点图标弹出来的就不是原来那块了。现在保存只在用户按尺子时发生，
	// 而且只写"当前这一层"自己的记录。
	_followArea: function (previous) {
		var current = this._pip && this._pip.selector;
		if (!current || !previous || current === previous || current === 'BODY') return;
		this.selector = current;
		this._updatePipState();
	},
	// 显示父元素（经典窗口的"上一级"）。
	_pipNavUp: function () {
		var st = this._pip;
		if (!st) return;
		var parent = st.parent;
		if (!parent || parent === document.body || parent === document.documentElement) return;
		var previous = st.selector;
		this._pipStack.push(st.target);
		this._showNode(parent);
		this._followArea(previous);
	},
	// 回到之前显示的子元素（经典窗口的"下一级"）。
	_pipNavDown: function () {
		if (!this._pipStack || !this._pipStack.length) return;
		var previous = this._pip ? this._pip.selector : '';
		this._showNode(this._pipStack.pop());
		this._followArea(previous);
	},
	// 把当前挂载的节点放回原处。
	_restorePipNode: function () {
		var st = this._pip;
		try {
			// 1. 把真实 <video> 放回原来的位置
			var parked = this._pipParked;
			if (parked) {
				this._pipParked = null;
				try {
					if (parked.parent) {
						if (parked.next && parked.next.parentNode === parked.parent) {
							parked.parent.insertBefore(parked.video, parked.next);
						} else {
							parked.parent.appendChild(parked.video);
						}
					}
				} catch (e) {
					console.error('[SepWin] failed to restore the video element:', e);
				}
			}
			// 2. 把显示的区域搬回去
			if (st) {
				this._pip = null;
				// 整页模式改过 body 的内联样式（缩放/尺寸），搬回去前先清掉
				if (st.target && st.target.tagName === 'BODY') {
					/* 整页模式改过 body 的 zoom，搬回页面之前清掉 */
					st.target.style.zoom = '';
					this._wholeScale = 1;
				}
				if (st.parent && st.target.parentNode !== st.parent) {
					var ref = (st.next && st.next.parentNode === st.parent) ? st.next : null;
					st.parent.insertBefore(st.target, ref);
				}
			}
			// 3. 删掉跟着区域一起搬回来的镜像
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
		this._pipStack = [];
		this._pipPanel = null;
		this._pipWin = null;
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
