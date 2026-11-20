/**
 * Author: Kashimura
 */
var __AppPanel = {
	lastEv: 0,
	run: false,
	scroll: 0,
	target: {},
	selector: '',
	_getFromPoint: function (x, y) {
		__Element.hideWrapper();
		var target = document.elementFromPoint(x, y);
		__Element.showWrapper();
		return target;
	},
	_prepare: function (target) {
		Selector.href = document.location.href;
		this.selector = Selector.getSelector(target);
		this.stop();
		this.dellIcon();
		__Element.switchOff();
		SepWinEvents.addEvents();
	},
	updateTab: function () {
		this._prepare(document.body);
		Modification.do(document.body, this.selector);
		ButtonPanel.add();
	},
	applyEntire:function(){
		this.selector = "BODY";
		if (this._useDocPip()) {
			this._prepare(document.body);
			this._openDocPip(document.body);
			return;
		}
		__BgCmd.sendCmd('apply', {
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
	/* --- mode selection ---
	 * Document PiP's requestWindow() REQUIRES transient user activation inside the
	 * page, so the setting is cached synchronously here (see _initCfg) instead of
	 * being queried over an async message round-trip while the click is handled.
	 */
	cfg: { useDocPip: true },
	// Saved window sizes per selector: { selector: {width, height} }
	_sizes: {},
	_initCfg: function () {
		var self = this;
		// Authoritative value from the background (this also triggers the settings
		// migration for profiles saved by older builds). Content scripts have no
		// access to Panel.cfg, so this is the only source of the real default.
		try {
			chrome.runtime.sendMessage({ cmd: 'getCfg', arg: {} }, function (response) {
				void chrome.runtime.lastError;
				if (response && response.cfg) {
					self.cfg.useDocPip = !!response.cfg.useDocPip;
				}
			});
		} catch (e) { /* ignore */ }
		// Keep in sync with writes coming from the popup.
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
	// Load the saved per-selector window sizes for this page so the PiP window can
	// reopen at the size the user saved (mirrors the classic window behaviour).
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
		// Only override when a value was actually stored; otherwise keep the
		// default (top-most window) so a fresh profile never falls back silently.
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
			__BgCmd.sendCmd('loadToFrame', {});
			setTimeout(function () {
				CmdToFrame.searchInFrame(target);
			}, 500);
		}
		this._prepare(target);
		if (this._useDocPip()) {
			this._openDocPip(target);
			return;
		}
		this._applyClassic(target);
	},
	// Classic separate-window path (original behavior).
	_applyClassic: function (target) {
		let width = 150, height = 150, entireTab = false;
		if (target == document.body) {
			width = window.innerWidth;
			height = window.innerHeight;
			entireTab = true;
		} else {
			width = Math.round(__Element.size.width);
			height = Math.round(__Element.size.height);
		}
		__BgCmd.sendCmd('apply', {
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
		Modification.do(target, this.selector);
		ButtonPanel.add();
	},
	// Open a Document Picture-in-Picture window (always on top) and move the
	// selected region into it. The PiP window's own document is destroyed on
	// close, so the moved node is put back where it came from in pagehide.
	_openDocPip: function (target) {
		var self = this;
		if (!window.documentPictureInPicture) {
			this._applyClassic(target);
			return;
		}
		// Popup / context-menu triggers carry no gesture inside the page, and the
		// browser rejects requestWindow() without one. Ask for a single click.
		if (!this._hasActivation()) {
			this._promptActivate(target);
			return;
		}
		var isBody = (target == document.body);
		var width = isBody ? Math.min(window.innerWidth, 1280)
			: Math.max(160, Math.round(__Element.size.width));
		var height = isBody ? Math.min(window.innerHeight, 800)
			: Math.max(160, Math.round(__Element.size.height));
		// Reuse the size saved for this selector, if any.
		var saved = this._sizes[this.selector];
		if (saved && saved.width > 80 && saved.height > 80) {
			width = Math.round(saved.width);
			height = Math.round(saved.height);
		}
		window.documentPictureInPicture.requestWindow({ width: width, height: height })
			.then(function (pipWin) { self._mountPip(pipWin, target); })
			.catch(function (e) {
				console.error('[SepWin] Document PiP failed:', e);
				self._applyClassic(target);
			});
	},
	// First playable <video> inside the chosen region (or the region itself).
	_findVideo: function (node) {
		if (!node || node.nodeType !== 1) return null;
		if (node.tagName === 'VIDEO') return node;
		return node.querySelector ? node.querySelector('video') : null;
	},
	// Players usually put overlays (danmaku layer, controls) above the <video>, so the
	// clicked node often has no video of its own. Walk up a few levels to find the
	// container that owns the video. Never return <body>/<html>: moving those into the
	// PiP document would destroy the page.
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
	// Fallback for player pages where the clicked overlay is not inside the video's
	// subtree: pick the biggest video on the page (live pages often carry more than
	// one <video> — previews/ads — so "exactly one" is not a usable condition).
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
	// Show only the live video mirror (no DOM is moved).
	_showMirrorOnly: function (video) {
		var doc = this._pipWin.document;
		var wrap = doc.getElementById('__sepWinPipWrap');
		var view = doc.createElement('video');
		view.id = '__sepWinPipVideo';
		view.className = '__pipFill';
		view.autoplay = true;
		view.muted = true; // page keeps the audio; avoids a doubled track
		view.setAttribute('playsinline', '');
		try {
			var stream = video.captureStream ? video.captureStream()
				: (video.mozCaptureStream ? video.mozCaptureStream() : null);
			if (stream) {
				view.srcObject = stream;
				this._pipStream = stream;
			} else {
				console.warn('[SepWin] captureStream unavailable — video frame will be blank');
			}
		} catch (e) {
			console.error('[SepWin] captureStream failed:', e);
		}
		wrap.appendChild(view);
		if (view.srcObject && view.play) {
			var pr = view.play();
			if (pr && pr.catch) pr.catch(function () { });
		}
		this._pip = {
			target: video, parent: video.parentNode, next: video.nextSibling,
			selector: Selector.getSelector(video), mirrored: true
		};
		this._pipVideo = video;
		this._pipView = view;
		this._startWatchdog();
		this._updatePipState();
	},
	_stopPipStream: function () {
		if (!this._pipStream) return;
		try {
			this._pipStream.getTracks().forEach(function (t) { t.stop(); });
		} catch (e) { }
		this._pipStream = null;
	},
	/* --- background-tab resilience ------------------------------------
	 * A PiP window is pointless if the source page stops decoding when its tab is
	 * hidden or the browser window is minimised: the mirror freezes. Keep the display
	 * awake, keep the tab out of the discard list, and run a watchdog that resumes
	 * playback / rebuilds the stream when frames stop arriving.
	 */
	_keepAwake: function (on) {
		try {
			__BgCmd.sendCmd(on ? 'pipKeepAwake' : 'pipReleaseAwake', {});
		} catch (e) { }
	},
	// Tell the page it is still visible while a PiP window exists, otherwise sites
	// pause their danmaku/overlay renderers as soon as the tab is hidden.
	_visibilityShim: function (on) {
		try {
			__BgCmd.sendCmd('pipVisibilityShim', { on: !!on });
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
	// Cheap, conservative health loop. It must never fight the normal pipeline: a
	// captureStream re-creation resets playback and shows up as dropped frames, so a
	// restart is the last resort after cheaper fixes failed, and it is capped.
	_startWatchdog: function () {
		var self = this;
		this._stopWatchdog();
		this._restarts = 0;
		this._restartCap = 3;
		var lastVu = -1, strikes = 0, lastResume = 0;
		this._watchdog = setInterval(function () {
			var win = self._pipWin;
			if (!win || win.closed) { self._stopWatchdog(); return; }
			var video = self._pipVideo, view = self._pipView;
			if (!video || !view) return;
			var now = Date.now();
			// a) keep the source decoding (Chrome may pause media in a hidden tab)
			try {
				if (video.paused && !video.ended && now - lastResume > 10000) {
					lastResume = now;
					var p = video.play();
					if (p && p.catch) p.catch(function () { });
				}
			} catch (e) { }
			// b) keep the mirror playing — a paused mirror is the most common freeze
			try {
				if (view.paused && view.srcObject) {
					var pv = view.play();
					if (pv && pv.catch) pv.catch(function () { });
				}
			} catch (e) { }

			// c) liveness on the mirror itself
			var vu = view.currentTime;
			var stalled = view.videoWidth > 0 && vu === lastVu;
			lastVu = vu;

			if (!stalled) { strikes = 0; return; }
			strikes++;
			// First strike: a paused mirror; second: wait one more cycle.
			if (strikes >= 2 && strikes < 4) {
				try {
					var pr = view.play();
					if (pr && pr.catch) pr.catch(function () { });
				} catch (e) { }
			}
			// Only rebuild once the picture has been frozen for ~9s, and never more
			// than _restartCap times per PiP session.
			if (strikes >= 3 && self._restarts < self._restartCap) {
				self._restarts++;
				strikes = 0;
				self._restartStream();
			}
		}, 3000);
	},
	_stopWatchdog: function () {
		if (this._watchdog) { clearInterval(this._watchdog); this._watchdog = null; }
	},
	_restartStream: function () {
		var video = this._pipVideo, view = this._pipView;
		if (!video || !view) return;
		try {
			this._stopPipStream();
			var s = video.captureStream ? video.captureStream()
				: (video.mozCaptureStream ? video.mozCaptureStream() : null);
			if (!s) return;
			view.srcObject = s;
			this._pipStream = s;
			var p = view.play();
			if (p && p.catch) p.catch(function () { });
		} catch (e) {
			console.error('[SepWin] failed to rebuild the PiP stream:', e);
		}
	},
	// Prepare the PiP document once (styles + control panel), then show the node.
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
			'#__sepWinPipWrap>.__pipPlain>*{max-width:100%;max-height:100%}';
		doc.head.appendChild(style);
		// Same control panel stylesheet as the classic window, so the toolbar looks
		// identical inside the PiP window.
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

		// Keep the machine awake and the source tab alive while the PiP window exists.
		this._keepAwake(true);
		this._visibilityShim(true);
		this._requestWakeLock(pipWin);
		try {
			pipWin.document.addEventListener('visibilitychange', function () {
				if (pipWin.document.visibilityState === 'visible' && !self._wakeLock) {
					self._requestWakeLock(pipWin);
				}
			});
		} catch (e) { }

		pipWin.addEventListener('pagehide', function () {
			self._stopPipStream();
			self._restorePip();
		});
		// Keep the region fitted while the user resizes the PiP window.
		pipWin.addEventListener('resize', function () { self._fitPipHost(); });
	},
	// Show `node` in the PiP window. A node containing a <video> is MIRRORED (the
	// original stays in the page, so live MSE playback keeps running); anything else
	// is moved into the PiP document. Up/down reuse this to walk the DOM.
	_showNode: function (node) {
		var doc = this._pipWin.document;
		var wrap = doc.getElementById('__sepWinPipWrap');
		if (!wrap) {
			wrap = doc.createElement('div');
			wrap.id = '__sepWinPipWrap';
			doc.body.appendChild(wrap);
		}
		// Drop whatever is currently shown, then start from an empty wrapper.
		this._restorePipNode();
		this._stopWatchdog();
		this._stopPipStream();
		while (wrap.firstChild) wrap.removeChild(wrap.firstChild);

		var ctx = this._findVideoContext(node);
		var ctxVideo = ctx ? ctx.video : null;
		if (ctx) {
			// Ignore invisible/zero-size overlays (captcha ghosts, hidden layers), but
			// keep the video we found so it can still be mirrored.
			var cr = ctx.host.getBoundingClientRect();
			if (cr.width < 20 || cr.height < 20) ctx = null;
		}
		if (ctx) {
			if (ctx.host === ctx.video) {
				// The region IS the video element: mirror it, never move it (moving a
				// live MSE player is what breaks playback).
				this._showMirrorOnly(ctx.video);
				return;
			}
			// Region containing the player: show its real DOM with the video mirrored.
			this._showHostMirror(ctx.host, ctx.video);
			this._updatePipState();
			return;
		}
		if (node !== document.body) {
			var pageVideo = ctxVideo || this._pickPageVideo();
			if (pageVideo) {
				// No usable region around the click — just mirror the video.
				this._showMirrorOnly(pageVideo);
				return;
			}
		}
		this._pip = {
			target: node, parent: node.parentNode, next: node.nextSibling,
			selector: Selector.getSelector(node)
		};
		var holder = doc.createElement('div');
		holder.className = '__pipPlain';
		holder.appendChild(node);
		wrap.appendChild(holder);
		this._updatePipState();
	},
	// Move the region's DOM into the PiP document while the real <video> stays in the
	// page (parked off-screen, still playing) and a mirrored copy takes its place.
	// This keeps MSE streams alive AND lets up/down show the parent/child region.
	_showHostMirror: function (host, video) {
		var doc = this._pipWin.document;
		var wrap = doc.getElementById('__sepWinPipWrap');
		this._copyPageStyles();

		var view = doc.createElement('video');
		view.id = '__sepWinPipVideo';
		view.autoplay = true;
		view.muted = true; // page keeps the audio; avoids a doubled track
		view.setAttribute('playsinline', '');
		try {
			var stream = video.captureStream ? video.captureStream()
				: (video.mozCaptureStream ? video.mozCaptureStream() : null);
			if (stream) {
				view.srcObject = stream;
				this._pipStream = stream;
			} else {
				console.warn('[SepWin] captureStream unavailable — video frame will be blank');
			}
		} catch (e) {
			console.error('[SepWin] captureStream failed:', e);
		}

		// Place the mirror exactly where the original sits inside the region.
		var hr = host.getBoundingClientRect(), vr = video.getBoundingClientRect();
		this._pipHost = host;
		// Snapshot the inline styles so closing restores the page exactly.
		this._pipHostCss = host.getAttribute('style');
		this._pipHostSize = { w: Math.round(hr.width), h: Math.round(hr.height) };
		// Fit to the video's box (not the whole container): the container usually
		// carries empty space and page-fixed chrome, which produced big black bands.
		this._pipHostFit = {
			x: vr.left - hr.left, y: vr.top - hr.top,
			w: Math.max(1, vr.width), h: Math.max(1, vr.height)
		};
		if (!host.style.position || host.style.position === 'static') {
			host.style.position = 'relative';
		}
		view.style.cssText = 'position:absolute;pointer-events:none;background:#000;' +
			'object-fit:contain;' +
			'left:' + Math.round(vr.left - hr.left + host.scrollLeft) + 'px;' +
			'top:' + Math.round(vr.top - hr.top + host.scrollTop) + 'px;' +
			'width:' + Math.round(vr.width) + 'px;' +
			'height:' + Math.round(vr.height) + 'px;';

		// Remember the video's slot, then park the real element off-screen.
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
			selector: Selector.getSelector(host), mirrored: true
		};
		// The region loses its page layout context inside the PiP document, so give it
		// an explicit box, then scale it to fit the PiP window (and keep fitting on resize).
		host.style.width = Math.round(hr.width) + 'px';
		host.style.height = Math.round(hr.height) + 'px';
		host.style.boxSizing = 'border-box';
		wrap.appendChild(host);
		this._fitPipHost();
		// Live MediaStream sources need an explicit play() in some cases.
		if (view.srcObject && view.play) {
			var pr = view.play();
			if (pr && pr.catch) pr.catch(function () { });
		}
		this._pipVideo = video;
		this._pipView = view;
		this._startWatchdog();
	},
	// Scale the shown region so it always fits the PiP window, keeping the aspect
	// ratio and centring it. Called on open and on every window resize.
	_fitPipHost: function () {
		var host = this._pipHost, win = this._pipWin, size = this._pipHostSize;
		if (!host || !win || !size || !size.w || !size.h) return;
		var vw = win.innerWidth || 0, vh = win.innerHeight || 0;
		if (!vw || !vh) return;
		// Fit the video's box when there is one, so the picture fills the window and
		// surrounding page chrome is cropped away instead of leaving black bands.
		var fit = this._pipHostFit;
		if (!fit || !fit.w || !fit.h) fit = { x: 0, y: 0, w: size.w, h: size.h };
		// Fill the window with the video box instead of letterboxing it: with "contain"
		// a taller/shorter window left black bands and pushed the danmaku layer into the
		// middle, which looked misaligned. Cropping the overflow keeps the picture and
		// its overlay pinned to the top-left of the window.
		var scale = Math.max(vw / fit.w, vh / fit.h);
		if (!isFinite(scale) || scale <= 0) scale = 1;
		var left = Math.round((vw - fit.w * scale) / 2 - fit.x * scale);
		var top = Math.round((vh - fit.h * scale) / 2 - fit.y * scale);
		host.style.transformOrigin = 'top left';
		host.style.transform = 'scale(' + scale + ')';
		// Promote the scaled region to its own layer: re-rasterising a scaled <video>
		// every frame is what makes big regions look choppy on weak GPUs.
		host.style.willChange = 'transform';
		host.style.backfaceVisibility = 'hidden';
		host.style.position = 'absolute';
		host.style.left = left + 'px';
		host.style.top = top + 'px';
		host.style.margin = '0';
	},
	// A moved region loses all page styling unless the stylesheets come along.
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
	// Build the right-hand control panel inside the PiP window with the SAME seven
	// buttons as the classic window. ButtonPanel lives in the page document, so the
	// PiP document needs its own copy (or the window has no menu at all).
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

		// Let bookmark state responses target these buttons instead of the
		// (absent) page panel.
		ButtonPanel.btn_bkm = panel.querySelector('#__btn_bkm');

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
					__BgCmd.sendCmd('printScr', { name: window.location.hostname });
					break;
				case '__btn_bkm':
					if (self._pip) Bookmarks.addBookmark(self._pip.target);
					break;
				case '__btn_link':
					if (self._pip) self._showPipLink(doc, self._pip.target);
					break;
			}
		}, true);

		this._updatePipState();
	},
	// Reflect the current node / saved-size state on the PiP toolbar.
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

		// The classic window hides these three when the whole page is shown.
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
	// Save / clear the PiP window size for the current selector, so the next pop-out
	// of the same region reopens at that size.
	_pipToggleSave: function () {
		var st = this._pip;
		if (!st || !this._pipWin) return;
		var sel = st.selector;
		if (this._sizes[sel]) {
			delete this._sizes[sel];
			__BgCmd.sendCmd('savePipSize', { selector: sel, size: '{}' });
		} else {
			var size = {
				width: Math.round(this._pipWin.innerWidth),
				height: Math.round(this._pipWin.innerHeight)
			};
			this._sizes[sel] = size;
			__BgCmd.sendCmd('savePipSize', { selector: sel, size: JSON.stringify(size) });
		}
		this._updatePipState();
	},
	// Show the parent element instead of the current one (classic "scroll up").
	_pipNavUp: function () {
		var st = this._pip;
		if (!st) return;
		var parent = st.parent;
		if (!parent || parent === document.body || parent === document.documentElement) return;
		this._pipStack.push(st.target);
		this._showNode(parent);
	},
	// Go back to the previously shown (child) element (classic "scroll down").
	_pipNavDown: function () {
		if (!this._pipStack || !this._pipStack.length) return;
		this._showNode(this._pipStack.pop());
	},
	// Put the currently mounted node back where it came from.
	_restorePipNode: function () {
		var st = this._pip;
		try {
			// 1. put the real <video> back into its original slot
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
			// 2. move the shown region back
			if (st) {
				this._pip = null;
				if (st.parent && st.target.parentNode !== st.parent) {
					var ref = (st.next && st.next.parentNode === st.parent) ? st.next : null;
					st.parent.insertBefore(st.target, ref);
				}
			}
			// 3. drop the mirror that travelled back with the region
			var views = document.querySelectorAll('#__sepWinPipVideo');
			for (var i = 0; i < views.length; i++) {
				if (views[i].parentNode) views[i].parentNode.removeChild(views[i]);
			}
			// 4. restore the inline styles we changed (scale/position/size)
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
	// Close the PiP window (the node is put back by _restorePip on pagehide).
	cancelPip: function () {
		if (this._pipWin && !this._pipWin.closed) {
			this._pipWin.close();
		} else {
			this._restorePip();
		}
	},
	// "Get link" overlay rendered inside the PiP document.
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
		ta.value = Selector.getLink(target);
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
	// Put the moved node back where it came from once the PiP window closes.
	_restorePip: function () {
		this._stopWatchdog();
		this._stopPipStream();
		this._releaseWakeLock();
		this._visibilityShim(false);
		this._keepAwake(false);
		this._pipVideo = null;
		this._pipView = null;
		this._lastFrames = null;
		this._restorePipNode();
		this._pipStack = [];
		this._pipPanel = null;
		this._pipWin = null;
		// Drop the reference to the PiP toolbar button so later bookmark state
		// updates don't touch a detached node.
		ButtonPanel.btn_bkm = {};
	},
	// Shown when PiP is requested without a page gesture (popup / context menu):
	// a real click on this banner supplies the activation the API requires.
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
		Selector.restoreURL();
		__BgCmd.sendCmd('cancel', {});
		CmdToFrame.remove();
		Modification.cancel();
		ButtonPanel.remove();
		EventPanel.remove();
		SepWinEvents.removeEvents();
	},
	dellIcon: function () {
		Observer.disconnectDomChange();
		__Icons.delAllIcon();
	},
	responseSelectors: function () {
		__BgCmd.sendCmd('getItems', {});
	},
	saveSelector: function (newSelector) {
		__BgCmd.sendCmd('saveSelector', { prop: { name: 'css', value: newSelector } });
	},
	saveSize:function(newSize){
		__BgCmd.sendCmd('saveSize', { prop: { name: 'size', value: newSize } });
	},
	start: function () {
		if (Modification.isSeparate) return;
		if (!this.run) {
			this.run = !this.run;
			this.dellIcon();
			__Element.addWrapper();
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
			__Element.delWrapper();
			__Element.reset();
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
					__Element.set(e.target);
					this.scroll = 0;
					break;
				case 'G':
				case 'PATH':
				case 'RECT':
					__Element.set(e.target.parentNode);
					this.scroll = 0;
					break;
			}
		}
	},
	mouseClick: function (e) {
		this.blockEvent(e);
		if (__Element.prototype) {
			this.apply(__Element.prototype);
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
		__Element.set(target);
	},
	mouseMove: function (e) {
		this.blockEvent(e);
		if ((e.timeStamp - this.lastEv) < 30) { return true; }

		this.lastEv = e.timeStamp;
		var target = e.target;
		if (target.id == '__panelWrapper') {
			__Element.hideWrapper();
			target = document.elementFromPoint(e.clientX, e.clientY);
			if ('elementsFromPoint' in document) {
			//Chrome 43
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
			__Element.showWrapper();
		}

		if (target === this.target || target == document) { return true; }

		this.target = target;

		if (this.target && this.target.tagName !== 'BODY') {
			__Element.set(this.target);
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
	if(Bookmarks.isEntireTab){
		Bookmarks.isEntireTab = false;
		__AppPanel.updateTab();
	}else{
		__AppPanel.responseSelectors();
		Bookmarks.domChange();
		__BgCmd.sendCmd('isDuplicate', {});	
	}
};
Bookmarks.getHash();
__AppPanel._initCfg();
window.addEventListener('DOMContentLoaded', __onLoad);