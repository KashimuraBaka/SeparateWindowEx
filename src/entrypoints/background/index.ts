// @ts-nocheck -- 遗留文件体：模块边界已就位，类型迁移留到后续步骤。
import { createSiteStore } from '../../core/storage';
import { dispatch, sendToTab } from '../../core/messages';
/**
 * 作者：Kashimura
 *
 * "Separate Window" —— 后台 service worker。
 *
 * MV2 → MV3 迁移说明（本文件替代旧后台页的组合：
 * storage.js + bg_panel.js + background.js，MV3 把它合并成单个
 * service_worker 脚本）：
 *   - 没有 DOM，也没有持久的全局状态：worker 随时可能被挂起。
 *     因此 MV2 后台页存在全局变量里的内存状态（newTabs、Panel.cfg），
 *     现在镜像到 chrome.storage.local / .session，用之前再读回来。
 *   - 弹窗无法再直接访问后台页，改为通过消息与本 worker 通信
 *     （见下面的 popupCmd）。
 *   - 程序化注入改走 chrome.scripting.executeScript（需要
 *     "scripting" 权限以及主机权限）。
 *   - 工具栏按钮 API 从 browserAction 改为 chrome.action。
 */

/* ------------------------------------------------------------------ *
 * 持久化状态辅助函数
 * ------------------------------------------------------------------ */

// 每个标签页的弹窗状态，过去放在后台页的全局变量里。
var newTabs = {
	tabId: [],
	css: [],
	winId: [],
	newWinId: [],
	dupId: [],
	updateTab: [],
	add: function (tabId, selector, winId) {
		this.tabId.push(tabId);
		this.css.push(selector);
		this.winId.push(winId);
		this.dupId.push(0);
		this.newWinId.push(0);
		this.save();
	},
	addDupId: function (tabId, dupId) {
		let index = this.find(tabId);
		if (index > -1) { this.dupId[index] = dupId; this.save(); }
	},
	addNewWinId: function (tabId, newWinId) {
		let index = this.find(tabId);
		if (index > -1) { this.newWinId[index] = newWinId; this.save(); }
	},
	get: function (tabId) {
		var index = this.find(tabId);
		if (index > -1) {
			return {
				tabId: this.tabId[index],
				selector: this.css[index],
				winId: this.winId[index],
				dupId: this.dupId[index],
				newWinId: this.newWinId[index]
			};
		}
	},
	getSelector: function (index) {
		return this.css[index];
	},
	replace: function (tabId, prop) {
		var index = this.find(tabId);
		this[prop.name][index] = prop.value;
		this.save();
	},
	findDuplicate: function (dupId) {
		return this.dupId.indexOf(dupId);
	},
	findNewWin: function (winId) {
		return this.newWinId.indexOf(winId);
	},
	find: function (tabId) {
		return this.tabId.indexOf(tabId);
	},
	remove: function (index) {
		if (index == -1) return;
		this.tabId.splice(index, 1);
		this.css.splice(index, 1);
		this.winId.splice(index, 1);
		this.dupId.splice(index, 1);
		this.newWinId.splice(index, 1);
		this.save();
	},
	removeUpdateTab: function (tabId) {
		let index = this.updateTab.indexOf(tabId);
		if (index > -1) this.updateTab.splice(index, 1);
	},
	/* chrome.storage.session 在浏览器关闭时清空，这个生命周期和
	   lifetime this state had as a background-page global in MV2. */
	save: function () {
		var snapshot = {
			tabId: this.tabId,
			css: this.css,
			winId: this.winId,
			newWinId: this.newWinId,
			dupId: this.dupId
		};
		try { chrome.storage.session.set({ newTabs: snapshot }); } catch (e) { }
	},
	load: function () {
		var self = this;
		return chrome.storage.session.get('newTabs').then(function (data) {
			if (data && data.newTabs) {
				var s = data.newTabs;
				self.tabId = s.tabId || [];
				self.css = s.css || [];
				self.winId = s.winId || [];
				self.newWinId = s.newWinId || [];
				self.dupId = s.dupId || [];
			}
		}).catch(function () { });
	}
};

// 持久化设置（浏览器重启后仍在）。
// 站点记录存储，与弹窗、内容脚本共用（core/storage）。
var Storage = createSiteStore(chrome.storage.local);
// 弹窗 / 窗口配置（持久化，以便 worker 被挂起后重新加载）。
var Panel = {
	cfg: {
		isDuplicate: false,
		isCopy: false,
		isFocus: true,
		position: { left: 0, top: 0, auto: 1 },
		size: { width: 'Auto', height: 'Auto' },
		showAdvSettings: false,
		hideAllIcon: false,
		// 默认使用置顶窗口（Document PiP）；旧的经典窗口
		// 需要用户通过「经典窗口」开关主动启用。
		useDocPip: true,
		modeVersion: 2
	},
	load: function (callback) {
		Storage.getSetting(function (itemsObj) {
			var migrated = false;
			if (itemsObj && itemsObj.hasOwnProperty('settings')) {
				migrated = Panel.setSettings(itemsObj.settings);
			}
			if (migrated) Panel.saveSetting();
			if (callback) callback(Panel.cfg);
		});
	},
	saveSetting: function () {
		Storage.saveSetting({ cfg: this.cfg });
	},
	setSettings: function (items) {
		var migrated = false;
		if (items.hasOwnProperty('cfg')) {
			for (var item in items.cfg) {
				if (this.cfg.hasOwnProperty(item)) this.cfg[item] = items.cfg[item];
			}
			// 窗口模式改版之前写下的设置没有 modeVersion；
			// 那时的 useDocPip:false 只是旧的默认值，这里重置它，
			// 而不是让所有人默默停留在旧的经典窗口上。
			if (items.cfg.modeVersion !== 2) {
				this.cfg.useDocPip = true;
				this.cfg.modeVersion = 2;
				migrated = true;
			}
		}
		return migrated;
	},
	_moveTab: function (tabId, winId, index) {
		chrome.tabs.move(tabId, { windowId: winId, index: index }, function (tab) {
			if (!chrome.runtime.lastError) chrome.tabs.update(tab.id, { active: true });
		});
	},
	createPop: function (tabId, size, windowSize) {
		this.load(function () { Panel._createPop(tabId, size, windowSize); });
	},
	_createPop: function (tabId, size, windowSize) {
		chrome.tabs.get(tabId, function (tab) {
			if (Panel.cfg.isDuplicate) {
				chrome.windows.getCurrent(function (win) {
					if (win.type == 'normal' && tab.url.indexOf('#sepwin') == -1) {
						chrome.tabs.duplicate(tabId, function (dupTab) {
							newTabs.addDupId(tabId, dupTab.id);
						});
					}
				});
			}
			chrome.windows.get(tab.windowId, {}, function (window) {
				if (window.type !== 'popup') {
					chrome.tabs.query({ windowId: window.id }, function (arrTab) {
						if (arrTab.length == 1) {
							chrome.windows.create({
								top: window.top,
								left: window.left,
								width: window.width,
								height: window.height,
								focused: !Panel.cfg.isFocus,
								incognito: window.incognito
							});
						}
					});
					let left = null,
						top = null,
						position = Panel.cfg.position,
						width = size.width > 150 ? size.width : 150,
						height = size.height > 150 ? size.height : 150,
						aspect = width / height;

					if (Panel.cfg.size.width !== 'Auto') {
						width = Math.round(Panel.cfg.size.width);
						if (Panel.cfg.size.height == 'Auto' && !size.entireTab) {
							height = Math.round(width / aspect);
						}
					}
					if (Panel.cfg.size.height !== 'Auto') {
						height = Math.round(Panel.cfg.size.height);
						if (Panel.cfg.size.width == 'Auto' && !size.entireTab) {
							width = Math.round(height * aspect);
						}
					}
					if (!position.auto) {
						left = size.avLeft;
						top = size.avTop;
						if (!position.left) { left += size.avWidth - width; }
						if (!position.top) { top += size.avHeight - height; }
						left = Math.round(left);
						top = Math.round(top);
					}
					if (windowSize) {
						left = windowSize.left;
						top = windowSize.top;
						width = windowSize.width;
						height = windowSize.height;
					}
					chrome.windows.create({
						left: left,
						top: top,
						tabId: tabId,
						width: width,
						height: height,
						// 注意：chrome.windows.create 不接受 alwaysOnTop 属性，
						// 传了会抛 "Unexpected property"，窗口根本创建不出来。
						// 焦点行为保持原样。
						focused: Panel.cfg.isFocus,
						type: 'popup',
						incognito: window.incognito
					},
					function (window) {
						newTabs.addNewWinId(tabId, window.id);
						// 让弹出的窗口始终置顶。windows.create 不
						// 接受 alwaysOnTop，所以创建后立刻设置。
						chrome.windows.update(window.id, { alwaysOnTop: true });
						SendMessage(tabId, { cmd: 'modifyURL', arg: false });
					});
				}
			});
		});
	},
	checkTab: function (tab) {
		chrome.windows.get(tab.windowId, {}, function (window) {
			if (window.type == 'popup') {
				Panel.restoreTab(tab, false);
			}
		});
	},
	restoreTab: function (tab, unload) {
		unload = unload || false;
		let incognito = tab.incognito;
		let index = newTabs.find(tab.id);
		let prop = { tabId: tab.id, winId: -1 };
		if (index > -1) {
			prop = newTabs.get(tab.id);
		}
		chrome.windows.get(prop.winId, function (window) {
			if (!chrome.runtime.lastError && window) {
				if (Panel.cfg.isDuplicate && !Panel.cfg.isCopy && !unload) {
					chrome.tabs.get(prop.dupId, function (dupTab) {
						var pos = -1;
						if (!chrome.runtime.lastError) {
							pos = dupTab.index;
							chrome.tabs.remove(prop.dupId);
						}
						Panel._moveTab(prop.tabId, window.id, pos);
					});
				} else {
					Panel._moveTab(prop.tabId, window.id, -1);
				}
			} else {
				chrome.windows.getAll({ windowTypes: ['normal'] }, function (allWin) {
					let winId = -1;
					for (var i = 0; i < allWin.length; i++) {
						if (allWin[i].incognito == incognito) {
							winId = allWin[i].id;
							break;
						}
					}
					if (winId > -1) {
						Panel._moveTab(prop.tabId, winId, -1);
					} else {
						chrome.windows.create({
							tabId: prop.tabId,
							focused: true,
							type: 'normal',
							state: 'maximized',
							incognito: incognito
						});
					}
				});
			}
		});
		newTabs.remove(index);
	},
	updateWin: function (winId, state) {
		chrome.windows.update(winId, state, function () { });
	}
};

// 书签集成。
var Bookmarks = {
	bookmark: { title: '', url: '', parentId: '' },
	anchor: '#sepwin=',
	addBookmark: function (tab, url) {
		this.bookmark.title = tab.title;
		this.bookmark.url = url;
		var folderName = chrome.i18n.getMessage('folderBookMarks');
		chrome.bookmarks.search({ title: folderName }, function (result) {
			if (result.length == 0) {
				chrome.bookmarks.create({ parentId: '1', title: folderName }, function (newFolder) {
					Bookmarks.bookmark.parentId = String(newFolder.id);
					Bookmarks.add();
				});
			} else {
				Bookmarks.bookmark.parentId = String(result[0].id);
				Bookmarks.add();
			}
		});
		SendMessage(tab.id, { cmd: 'isBookmark', arg: true });
	},
	add: function () {
		chrome.bookmarks.search({ title: this.bookmark.title, url: this.bookmark.url }, function (result) {
			if (result.length == 0) {
				chrome.bookmarks.create(Bookmarks.bookmark);
			}
		});
	},
	checkBookmark: function (tab, url, callback) {
		chrome.bookmarks.search({ url: url }, function (result) {
			callback(result.length > 0);
		});
	},
	delBookmark: function (tab, url) {
		chrome.bookmarks.search({ url: url }, function (result) {
			if (result.length > 0) {
				chrome.bookmarks.remove(result[0].id);
				SendMessage(tab.id, { cmd: 'isBookmark', arg: false });
			}
		});
	}
};

/* ------------------------------------------------------------------ *
 * 来自内容脚本的命令
 * ------------------------------------------------------------------ */
// tabId -> { discardable }：记录哪些标签页的 PiP 窗口持有屏幕唤醒锁。
var keepAwakeTabs = {};

// 在页面主世界运行（由 chrome.scripting.executeScript 注入），因此
// 必须自包含。PiP 窗口打开期间告诉页面"你可见"：
// 站点常在 visibilitychange 时暂停弹幕/覆盖层渲染，否则 PiP 里的副本
// 会僵住，尽管它自己的窗口还显示在屏幕上。
function sepWinVisibilityShim(on) {
	var KEY = '__sepWinVisShim';
	var st = window[KEY];
	if (on) {
		if (st) return 'already';
		st = window[KEY] = { descs: [], blocks: [] };
		try {
			st.descs.push(['hidden', Object.getOwnPropertyDescriptor(Document.prototype, 'hidden')]);
			st.descs.push(['visibilityState', Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState')]);
			Object.defineProperty(Document.prototype, 'hidden', {
				configurable: true, get: function () { return false; }
			});
			Object.defineProperty(Document.prototype, 'visibilityState', {
				configurable: true, get: function () { return 'visible'; }
			});
		} catch (e) { /* keep going: the event block below is the important part */ }
		var stop = function (e) { e.stopImmediatePropagation(); };
		['visibilitychange', 'webkitvisibilitychange'].forEach(function (type) {
			window.addEventListener(type, stop, true);
			st.blocks.push([type, stop]);
		});
		return 'on';
	}
	if (!st) return 'off';
	try {
		st.blocks.forEach(function (b) { window.removeEventListener(b[0], b[1], true); });
		st.descs.forEach(function (d) {
			if (d[1]) Object.defineProperty(Document.prototype, d[0], d[1]);
			else delete Document.prototype[d[0]];
		});
	} catch (e) { }
	delete window[KEY];
	return 'off';
}

// 在页面主世界运行。播放器页面是按"页面视口"计算覆盖层尺寸（含弹幕字号）的，
// 而 PiP 模式下页面视口并不改变，副本就会沿用旧字号。
// 因此 PiP 打开期间把 PiP 窗口尺寸当作视口上报，
// 并派发 resize，让站点按这个尺寸重新计算。
function sepWinViewportShim(on, w, h) {
	var KEY = '__sepWinViewportShim';
	var st = window[KEY];
	if (on) {
		if (!st) {
			st = window[KEY] = { descs: [], w: w || window.innerWidth, h: h || window.innerHeight };
			var save = function (obj, prop) {
				st.descs.push([obj, prop, Object.getOwnPropertyDescriptor(obj, prop)]);
			};
			var override = function (obj, prop, dim) {
				save(obj, prop);
				try {
					Object.defineProperty(obj, prop, {
						configurable: true,
						get: function () { return dim === 'w' ? st.w : st.h; }
					});
				} catch (e) { }
			};
			override(window, 'innerWidth', 'w');
			override(window, 'innerHeight', 'h');
			override(window, 'outerWidth', 'w');
			override(window, 'outerHeight', 'h');
			var de = document.documentElement;
			if (de) {
				override(de, 'clientWidth', 'w');
				override(de, 'clientHeight', 'h');
			}
		}
		if (w) st.w = w;
		if (h) st.h = h;
		try { window.dispatchEvent(new Event('resize')); } catch (e) { }
		return 'on ' + st.w + 'x' + st.h;
	}
	if (!st) return 'off';
	try {
		st.descs.forEach(function (d) {
			if (d[2]) Object.defineProperty(d[0], d[1], d[2]);
			else delete d[0][d[1]];
		});
	} catch (e) { }
	delete window[KEY];
	try { window.dispatchEvent(new Event('resize')); } catch (e) { }
	return 'off';
}

var cmdFromTab = {
	apply: function (arg, tab) {
		if (newTabs.find(tab.id) == -1) {
			newTabs.add(tab.id, arg.selector, tab.windowId);
			Storage.getSize(tab.url, arg.selector, function (size) {
				var winSize = size ? JSON.parse(size) : null;
				Panel.createPop(tab.id, arg.size, winSize);
			});
		}
	},
	minimizeWin: function (arg, tab) {
		Panel.updateWin(tab.windowId, { focused: false });
	},
	restoreWin: function (arg, tab) {
		Panel.updateWin(tab.windowId, { focused: true, state: 'normal' });
	},
	saveProp: function (arg, tab) {
		Storage.saveProp(tab.url, arg.index, arg.prop);
	},
	saveSelector: function (arg, tab) {
		var oldSelector = newTabs.get(tab.id).selector;
		Storage.getAllSelectors(tab.url, function (selectors) {
			var index = selectors.indexOf(oldSelector);
			Storage.saveProp(tab.url, index, arg.prop);
			newTabs.replace(tab.id, arg.prop);
		});
	},
	saveSize: function (arg, tab) {
		let selector = newTabs.get(tab.id).selector;
		Storage.getAllSelectors(tab.url, function (selectors) {
			let index = selectors.indexOf(selector);
			Storage.saveProp(tab.url, index, arg.prop);
		});
	},
	// Document PiP 模式没有 newTabs 记录（没有打开经典窗口），
	// 所以保存的尺寸以内容脚本发来的选择器为键。
	savePipSize: function (arg, tab) {
		Storage.getAllSelectors(tab.url, function (selectors) {
			if (!selectors) return;
			var index = selectors.indexOf(arg.selector);
			if (index > -1) {
				Storage.saveProp(tab.url, index, { name: 'size', value: arg.size });
			}
		});
	},
	printScr: function (arg, tab) {
		chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }, function (srcUrl) {
			SendMessage(tab.id, { cmd: 'saveImage', arg: { data: srcUrl } });
		});
	},
	// 记录选中区域的唯一入口，与窗口模式无关：
	// 内容脚本每次选中只发一次，经典窗口和 PiP 窗口
	// 因此共用同一份站点区域列表。
	recordArea: function (arg, tab) {
		if (!arg || !arg.selector) return;
		Storage.addItem(tab.url, arg.selector, '');
	},
	// 如果系统休眠、或源标签页在用户切到别的窗口时被冻结/丢弃，
	// 置顶窗口就没意义了。因此保持屏幕唤醒，
	// 并在 PiP 窗口打开期间把该标签页标记为不自动丢弃。
	pipKeepAwake: function (arg, tab) {
		try {
			chrome.power.requestKeepAwake('display');
			keepAwakeTabs[tab.id] = keepAwakeTabs[tab.id] || { discardable: null };
			chrome.tabs.get(tab.id, function (t) {
				if (chrome.runtime.lastError || !t) return;
				if (!keepAwakeTabs[tab.id]) return;
				keepAwakeTabs[tab.id].discardable = t.autoDiscardable !== false;
				if (t.autoDiscardable === false) return;
				chrome.tabs.update(tab.id, { autoDiscardable: false });
			});
		} catch (e) { /* power API unavailable */ }
	},
	pipReleaseAwake: function (arg, tab) {
		var saved = keepAwakeTabs[tab.id];
		delete keepAwakeTabs[tab.id];
		if (Object.keys(keepAwakeTabs).length === 0) {
			try { chrome.power.releaseKeepAwake(); } catch (e) { }
		}
		if (saved && saved.discardable) {
			chrome.tabs.update(tab.id, { autoDiscardable: true });
		}
	},
	// 播放器页面会在 visibilitychange 时停止弹幕/覆盖层渲染，
	// 导致标签页隐藏或窗口最小化后 PiP 副本立即僵住。
	// 在页面主世界拦截该事件，可以让站点在 PiP 打开期间继续出弹幕，
	// 关闭时再解除。
	pipVisibilityShim: function (arg, tab) {
		try {
			chrome.scripting.executeScript({
				target: { tabId: tab.id, allFrames: false },
				world: 'MAIN',
				func: sepWinVisibilityShim,
				args: [!!arg.on]
			}, function () { void chrome.runtime.lastError; });
		} catch (e) {
			console.warn('[SepWin] visibility shim failed:', e);
		}
	},
	// 把 PiP 窗口尺寸作为页面视口上报，让视口驱动的尺寸计算（弹幕
	// 字号、覆盖层缩放）跟随 PiP 窗口而不是原页面。
	pipViewportShim: function (arg, tab) {
		try {
			chrome.scripting.executeScript({
				target: { tabId: tab.id, allFrames: false },
				world: 'MAIN',
				func: sepWinViewportShim,
				args: [!!arg.on, arg.w | 0, arg.h | 0]
			}, function () { void chrome.runtime.lastError; });
		} catch (e) {
			console.warn('[SepWin] viewport shim failed:', e);
		}
	},
	fromHistory: function (index, tab) {
		Storage.getItem(tab.url, index, function (item) {
			SendMessage(tab.id, { cmd: 'apply', arg: item.selector });
		});
	},
	getItems: function (arg, tab) {
		Panel.load(function () {
			Storage.getShowItems(tab.url, function (icons) {
				SendMessage(tab.id, {
					cmd: 'setItems',
					arg: { icons: icons, hideIcons: Panel.cfg.hideAllIcon }
				});
			});
		});
	},
	checkTab: function (arg, tab) {
		Panel.checkTab(tab);
	},
	cancel: function (arg, tab) {
		Panel.restoreTab(tab, false);
		this.getItems('', tab);
	},
	updatePage: function (arg, tab) {
		newTabs.updateTab.push(tab.id);
	},
	unloadPage: function (arg, tab) {
		Panel.restoreTab(tab, true);
		this.getItems('', tab);
	},
	addBookmark: function (arg, tab) {
		Bookmarks.addBookmark(tab, arg.url);
	},
	delBookmark: function (arg, tab) {
		Bookmarks.delBookmark(tab, arg.url);
	},
	checkBookmark: function (arg, tab) {
		Bookmarks.checkBookmark(tab, arg.url, function (result) {
			SendMessage(tab.id, { cmd: 'isBookmark', arg: result });
		});
	},
	checkSaveSize: function (arg, tab) {
		Storage.getSize(tab.url, arg.selector, function (size) {
			SendMessage(tab.id, { cmd: 'isSavedSize', arg: !!size });
		});
	},
	// MV3：程序化注入使用 chrome.scripting。
	loadPlayer: function (arg, tab) {
		chrome.webNavigation.getAllFrames({ tabId: tab.id }, function (frames) {
			for (var i = 0; i < frames.length; i++) {
				if (arg.href == frames[i].url) {
					chrome.scripting.executeScript({
						target: { tabId: tab.id, frameIds: [frames[i].frameId] },
						files: ['js/player.js']
					}, function () { });
					break;
				}
			}
		});
	},
	loadToFrame: function (arg, tab) {
		chrome.webNavigation.getAllFrames({ tabId: tab.id }, function (frames) {
			frames.map(function (frame) {
				if (frame.parentFrameId > -1 && frame.url.indexOf('about:') == -1 && !frame.errorOccurred) {
					chrome.scripting.executeScript({
						target: { tabId: tab.id, frameIds: [frame.frameId] },
						files: ['js/iframe.js']
					}, function () { });
				}
			});
		});
	},
	isDuplicate: function (arg, tab) {
		var i = newTabs.findDuplicate(tab.id);
		if (i > -1) {
			SendMessage(tab.id, { cmd: 'duplicate', arg: { selector: newTabs.getSelector(i) } });
		}
	}
};

/* ------------------------------------------------------------------ *
 * 来自弹窗的命令（MV3 没有可直接访问的后台页）
 * ------------------------------------------------------------------ */
var popupCmd = {
	getCfg: function (arg, callback) {
		Panel.load(function (cfg) { callback(cfg); });
	},
	saveCfg: function (arg, callback) {
		Panel.cfg = arg;
		Panel.saveSetting();
		Panel.load(function () { callback(); });
	},
	getItems: function (arg, callback) {
		Storage.getItems(arg.url, callback);
	},
	getItem: function (arg, callback) {
		Storage.getItem(arg.url, arg.index, callback);
	},
	saveProp: function (arg, callback) {
		Storage.saveProp(arg.url, arg.index, arg.prop);
		callback();
	},
	delItem: function (arg, callback) {
		Storage.delItem(arg.url, arg.index, function () { callback(); });
	},
	fromHistory: function (arg, callback) {
		cmdFromTab.fromHistory(arg.index, { id: arg.tabId, url: arg.url });
		callback();
	}
};

/* ------------------------------------------------------------------ *
 * 事件接线
 * ------------------------------------------------------------------ */
chrome.runtime.onMessage.addListener(function (request, sender, callback) {
	if (!request) return false;
	if (request.cmd && sender && sender.tab) {
		// 来自内容脚本的消息。
		newTabs.load().then(function () {
			if (request.cmd === 'getCfg') {
				// 回传配置，让内容脚本据此选择窗口模式。
				Panel.load(function (cfg) { callback({ answer: true, cfg: cfg }); });
				return;
			}
			if (cmdFromTab.hasOwnProperty(request.cmd)) {
				cmdFromTab[request.cmd](request.arg, sender.tab);
				callback({ answer: true });
			} else {
				console.log(request.cmd);
				callback();
			}
		});
		return true; // keep the channel open for the async response
	}
	if (request.req) {
		// 来自弹窗的消息。
		newTabs.load().then(function () {
			if (popupCmd.hasOwnProperty(request.req)) {
				popupCmd[request.req](request.arg, callback);
			} else {
				callback();
			}
		});
		return true;
	}
	return false;
});

function SendMessage(tabId, message) {
	sendToTab(tabId, message.cmd, message.arg);
}

function CheckURL() {
	chrome.tabs.query({ active: true, currentWindow: true }, function (tab) {
		if (tab && tab[0] && tab[0].url) {
			if (tab[0].url.indexOf('https://chrome.') == -1 &&
				(tab[0].url.indexOf('http://') == 0 || tab[0].url.indexOf('https://') == 0 ||
					tab[0].url.indexOf('chrome://newtab/') == 0)) {
				chrome.action.enable(tab[0].id);
			} else {
				chrome.action.disable(tab[0].id);
			}
		}
	});
}

function ToggleContextMenu(tgl) {
	chrome.contextMenus.update('start', { 'enabled': tgl });
	chrome.contextMenus.update('entireTab', { 'enabled': tgl });
	chrome.contextMenus.update('back', { 'enabled': !tgl });
}

chrome.tabs.onRemoved.addListener(function (tabId) {
	newTabs.load().then(function () {
		newTabs.remove(newTabs.find(tabId));
		newTabs.removeUpdateTab(tabId);
	});
});

chrome.tabs.onUpdated.addListener(function (id, info, tab) {
	if (info.hasOwnProperty('url')) { CheckURL(); }
	let index = newTabs.updateTab.indexOf(tab.id);
	if (tab.status == 'complete' && index > -1) {
		newTabs.updateTab.splice(index, 1);
		SendMessage(tab.id, { cmd: 'updateEntireTab' });
	}
});

chrome.tabs.onActivated.addListener(function () {
	CheckURL();
});

chrome.windows.onFocusChanged.addListener(function (winId) {
	chrome.windows.getCurrent(function (curWin) {
		if (curWin && curWin.id == winId) {
			newTabs.load().then(function () {
				ToggleContextMenu(newTabs.findNewWin(winId) == -1);
			});
		}
	});
});

chrome.runtime.onStartup.addListener(function () {
	Panel.load();
});

chrome.contextMenus.onClicked.addListener(function (info, tab) {
	switch (info.menuItemId) {
		case 'start':
			SendMessage(tab.id, { cmd: 'start' });
			break;
		case 'back':
			SendMessage(tab.id, { cmd: 'cancel' });
			break;
		case 'entireTab':
			SendMessage(tab.id, { cmd: 'entireTab' });
			break;
	}
});

let contextMenuId = ['start', 'entireTab', 'back'];
let contextMenuI18 = ['txtButtonChooseOff', 'txtButtonPopTabOff', 'PanelBack'];
let contextMenuCfg = ['page', 'frame', 'selection', 'link', 'editable', 'image', 'video', 'audio'];
chrome.contextMenus.removeAll(function () {
	chrome.contextMenus.create({
		'id': 'sepwin',
		'title': 'Separate Window',
		'contexts': contextMenuCfg
	});
	contextMenuId.forEach(function (item, i) {
		chrome.contextMenus.create({
			'id': item,
			'parentId': 'sepwin',
			'title': chrome.i18n.getMessage(contextMenuI18[i]),
			'contexts': contextMenuCfg
		});
	});
});

// worker 启动时预热持久化状态。
newTabs.load();
Panel.load();
