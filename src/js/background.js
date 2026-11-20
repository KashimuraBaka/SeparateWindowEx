/**
 * Author: Belousov Alexandr
 *
 * "Separate Window" — background service worker.
 *
 * MV2 -> MV3 migration notes (this file replaces the old background page made up of
 * storage.js + bg_panel.js + background.js, which MV3 collapses into a single
 * service_worker script):
 *   - No DOM and no persistent global state: the worker can be suspended at any time.
 *     The in-memory state the MV2 background page kept in globals (newTabs, Panel.cfg) is
 *     therefore mirrored into chrome.storage.local / .session and re-hydrated before use.
 *   - The popup can no longer reach a background page, so it talks to this worker over
 *     messages (see popupCmd below).
 *   - Programmatic injection now goes through chrome.scripting.executeScript (needs the
 *     "scripting" permission plus host permissions).
 *   - Toolbar button APIs moved from browserAction to chrome.action.
 */

/* ------------------------------------------------------------------ *
 * Persisted state helpers
 * ------------------------------------------------------------------ */

// Per-tab popup state that used to live in a background-page global.
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
	/* chrome.storage.session is cleared when the browser closes, which matches the
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

// Stored settings (survive browser restarts).
var Storage = {
	prop: ['css', 'name', 'icon', 'size'],
	_local: chrome.storage.local,
	_setItems: function (url, items) {
		if (items.css.length == 0) {
			this._local.remove(url);
		} else {
			var itemsObj = {};
			itemsObj[url] = items;
			this._local.set(itemsObj);
		}
	},
	saveSetting: function (settings) {
		this._local.set({ settings: settings });
	},
	getSetting: function (callback) {
		this._local.get('settings', function (itemsObj) {
			callback(itemsObj ? itemsObj : undefined);
		});
	},
	delItem: function (url, index, callback) {
		var URL = this.normUrl(url);
		this.getItems(url, function (items) {
			Storage.prop.forEach(function (element) {
				if (items.hasOwnProperty(element)) {
					items[element].splice(index, 1);
				}
			});
			Storage._setItems(URL, items);
			callback();
		});
	},
	getItem: function (url, index, callback) {
		this.getItems(url, function (items) {
			callback({
				selector: items.css[index],
				name: items.name[index]
			});
		});
	},
	checkItems: function (URL, itemsObj) {
		var items = itemsObj[URL];
		if (!items.hasOwnProperty('icon')) {
			items['icon'] = [];
			for (var i = 0; i < items.css.length; i++) {
				items.icon.push(true);
			}
			Storage._setItems(URL, items);
		}
		return items;
	},
	getShowItems: function (url, callback) {
		this.getItems(url, function (items) {
			var showSelector = [];
			if (items) {
				for (var i = 0; i < items.icon.length; i++) {
					if (items.icon[i]) {
						showSelector.push(items.css[i]);
					}
				}
			}
			if (showSelector.length == 0) showSelector = undefined;
			callback(showSelector);
		});
	},
	getSize: function (url, selector, callback) {
		this.getItems(url, function (items) {
			let winSize = undefined;
			if (items) {
				let index = items.css.indexOf(selector);
				if (index > -1 && items.hasOwnProperty('size')) {
					if (items.size[index] && items.size[index] != '{}') {
						winSize = items.size[index];
					}
				}
			}
			callback(winSize);
		});
	},
	getAllSelectors: function (url, callback) {
		this.getItems(url, function (items) {
			var selectors = undefined;
			if (items && items.hasOwnProperty('css')) {
				selectors = items.css;
			}
			callback(selectors);
		});
	},
	getItems: function (url, callback) {
		var URL = this.normUrl(url);
		this._local.get(URL, function (itemsObj) {
			if (itemsObj && itemsObj.hasOwnProperty(URL)) {
				callback(Storage.checkItems(URL, itemsObj));
			} else {
				callback(undefined);
			}
		});
	},
	saveProp: function (url, index, prop) {
		var URL = this.normUrl(url);
		this.getItems(url, function (items) {
			if (!items.hasOwnProperty(prop.name)) {
				items[prop.name] = [];
			}
			items[prop.name][index] = prop.value;
			Storage._setItems(URL, items);
		});
	},
	addItem: function (url, selector, name) {
		if (selector == 'BODY') return;
		var URL = this.normUrl(url);
		this._local.get(URL, function (itemObj) {
			var items = { css: [], name: [], icon: [], size: [] };
			if (itemObj && itemObj.hasOwnProperty(URL)) {
				items = itemObj[URL];
				if (items.css.indexOf(selector) !== -1) return;
				if (items.css.length < 3) {
					items.css.push(selector);
					items.name.push(name);
					items.icon.push(true);
					items.size.push("{}");
				} else {
					items.css.splice(0, 1);
					items.name.splice(0, 1);
					items.icon.splice(0, 1);
					items.size.splice(0, 1);
					items.css.push(selector);
					items.name.push(name);
					items.icon.push(true);
					items.size.push("{}");
				}
			} else {
				items.css.push(selector);
				items.name.push(name);
				items.icon.push(true);
				items.size.push("{}");
			}
			Storage._setItems(URL, items);
		});
	},
	normUrl: function (url) {
		var reg = /^(https?:\/\/)?([\da-z|0-9\.-]+)\.([a-z|0-9\.]{2,6})/ig;
		return url.match(new RegExp(reg));
	}
};

// Popup / window configuration (persisted so the worker can reload it after a suspend).
var Panel = {
	cfg: {
		isDuplicate: false,
		isCopy: false,
		isFocus: true,
		position: { left: 0, top: 0, auto: 1 },
		size: { width: 'Auto', height: 'Auto' },
		showAdvSettings: false,
		hideAllIcon: false
	},
	load: function (callback) {
		Storage.getSetting(function (itemsObj) {
			if (itemsObj && itemsObj.hasOwnProperty('settings')) {
				Panel.setSettings(itemsObj.settings);
			}
			if (callback) callback(Panel.cfg);
		});
	},
	saveSetting: function () {
		Storage.saveSetting({ cfg: this.cfg });
	},
	setSettings: function (items) {
		if (items.hasOwnProperty('cfg')) {
			for (var item in items.cfg) {
				if (this.cfg.hasOwnProperty(item)) this.cfg[item] = items.cfg[item];
			}
		}
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
						focused: Panel.cfg.isFocus,
						type: 'popup',
						incognito: window.incognito
					},
					function (window) {
						newTabs.addNewWinId(tabId, window.id);
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

// Bookmarks integration.
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
 * Commands coming from content scripts
 * ------------------------------------------------------------------ */
var cmdFromTab = {
	apply: function (arg, tab) {
		if (newTabs.find(tab.id) == -1) {
			newTabs.add(tab.id, arg.selector, tab.windowId);
			Storage.getSize(tab.url, arg.selector, function (size) {
				var winSize = size ? JSON.parse(size) : null;
				Panel.createPop(tab.id, arg.size, winSize);
				Storage.addItem(tab.url, arg.selector, '');
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
	printScr: function (arg, tab) {
		chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }, function (srcUrl) {
			SendMessage(tab.id, { cmd: 'saveImage', arg: { data: srcUrl } });
		});
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
	// MV3: programmatic injection uses chrome.scripting.
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
 * Commands coming from the popup (MV3: no background page to reach into)
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
 * Wiring
 * ------------------------------------------------------------------ */
chrome.runtime.onMessage.addListener(function (request, sender, callback) {
	if (!request) return false;
	if (request.cmd && sender && sender.tab) {
		// Message from a content script.
		newTabs.load().then(function () {
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
		// Message from the popup.
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

function SendMessage(tabId, command) {
	chrome.tabs.sendMessage(tabId, command, function (response) {
		void chrome.runtime.lastError; // ignore tabs with no content script yet
	});
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

// Warm the persisted state when the worker starts.
newTabs.load();
Panel.load();
