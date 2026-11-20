/**
 * Author: Belousov Alexandr
 * MV3 migration: the popup can no longer reach the background page, so every piece of
 * state it used to read straight off the background globals (Panel.cfg, Storage history)
 * is now fetched from the background service worker over messages via req().
 */
var i18 = chrome.i18n.getMessage;
var Tabs = chrome.tabs;

// Ask the background service worker for data / to run a command.
function req(name, arg) {
	return new Promise(function (resolve) {
		chrome.runtime.sendMessage({ req: name, arg: arg }, function (response) {
			void chrome.runtime.lastError;
			resolve(response);
		});
	});
}

// Send a command to this tab's content script (same as before).
function sendCommand(command, callback) {
	getTab(function (tab) {
		Tabs.sendMessage(tab.id, command, function (response) {
			if (typeof (response) == 'undefined') {
				void chrome.runtime.lastError;
				callback('err');
			} else {
				callback(response);
			}
		});
	});
}

function getTab(callback) {
	Tabs.query({ active: true, currentWindow: true }, function (tab) { callback(tab[0]); });
}

var PopUp = {
	_forEmptyTab: function () {
		chrome.tabs.query({ active: true, currentWindow: true }, function (tab) {
			if (tab[0].url.indexOf('chrome://newtab/') == 0) {
				document.querySelectorAll('.wrap-buttons').forEach(
					function (elem) {
						elem.style.display = 'none';
					});
				document.getElementById('advCfg').style.maxHeight = '550px';
			} else {
				sendCommand({ cmd: 'isRun' }, function (response) {
					if (response == 'err') {
						document.getElementById('error').style.display = 'block';
						document.getElementById('main').style.display = 'none';
					} else {
						document.getElementById('select').checked = response;
					}
				});
			}
		});
	},
	_loadSettings: function () {
		var self = this;
		this._forEmptyTab();
		req('getCfg').then(function (cfg) {
			if (!cfg) return;
			document.getElementById('duplicate').checked = cfg.isDuplicate;
			document.getElementById('isCopy').checked = cfg.isCopy;
			document.getElementById('focus').checked = !cfg.isFocus;
			document.getElementById('hideAllIcon').checked = cfg.hideAllIcon;
			document.getElementById('advSettings').checked = cfg.showAdvSettings;
			var pos = cfg.position, size = cfg.size;
			document.getElementById('width').value = size.width;
			document.getElementById('height').value = size.height;
			if (pos.auto) {
				document.getElementById('auto').checked = true;
			} else {
				if (pos.left) {
					pos.top ? document.getElementById('lftop').checked = true :
						document.getElementById('lfbottom').checked = true;
				} else {
					pos.top ? document.getElementById('rgtop').checked = true :
						document.getElementById('rgbottom').checked = true;
				}
			}
			self.toggleAdvSettings();
			self.toggleDupCfg();
		});
	},
	_localization: function () {
		let elems = document.querySelectorAll('*[data-i18n]');
		for (let elem of elems) {
			if (elem.classList.contains('switch-inner') || elem.classList.contains('button')) {
				elem.setAttribute('data-on', i18(elem.getAttribute('data-i18n') + 'On'));
				elem.setAttribute('data-off', i18(elem.getAttribute('data-i18n') + 'Off'));
			}
			else if (elem.classList.contains('mark')) {
				elem.setAttribute('title', i18(elem.getAttribute('data-i18n')));
			}
			else {
				elem.innerHTML = i18(elem.getAttribute('data-i18n'));
			}
		}
	},
	_onClick: function (e) {
		switch (e.target.id) {
			case 'select':
				this.onSelect();
				break;
			case 'popTab':
				this.onPopTab();
				break;
			case 'advSettings':
				this.toggleAdvSettings();
			case 'duplicate':
				this.toggleDupCfg();
			case 'isCopy':
			case 'focus':
			case 'hideAllIcon':
			case 'width':
			case 'height':
				this.saveSettings();
				break;
			default:
				break;
		}
		switch (e.target.className) {
			case 'name':
				this.onButtons(e.target);
				break;
			case 'delete':
				this.onDelete(e.target);
				break;
			case 'showIcon':
				this.onCheckIcons(e.target);
				break;
			case 'switch-position':
				this.saveSettings();
				break;
			default:
				break;
		}
	},
	_formHistory: function () {
		getTab(function (tab) {
			let last = document.getElementById('last'),
				history = document.getElementById('history');

			req('getItems', { url: tab.url }).then(function (items) {
				if (items) {
					history.style.display = 'block';
					last.innerHTML = '';
					for (let i = 0, len = items.css.length; i < len; ++i) {
						let name = items.name[i];
						let checked = '';
						if (items.icon[i] == true) checked = 'checked';
						if (name == '') name = 'Area #' + (i + 1);
						last.innerHTML += '<div id="' + i + '" class="buttons" data-index="' + i + '">' +
							'<div class="name" data-index="' + i + '">' + name + '</div>' +
							'<div class="edit">' +
							'<div class="wrap_icons"><input id="icon_' + i + '" class="showIcon" data-index="' + i + '" type="checkbox" ' + checked + '><label for="icon_' + i + '" class="icons" title="' + i18('showIcon') + '"></label></div>' +
							'<div class="wrap_del"><button id="edit_' + i + '" class="delete" data-index="' + i + '" title="' + i18('delete') + '"></button></div>' +
							'</div>' +
							'</div>';
					}
					document.querySelectorAll('.buttons').forEach(
						function (button) {
							button.addEventListener('mouseenter', PopUp.switchOn);
							button.addEventListener('mouseleave', PopUp.switchOff);
						});
				} else {
					history.style.display = 'none';
					last.innerHTML = '';
				}
			});
		});
	},
	onCheckIcons: function (target) {
		let index = target.getAttribute('data-index');
		let prop = { name: 'icon', value: target.checked };
		getTab(function (tab) {
			req('saveProp', { url: tab.url, index: index, prop: prop }).then(function () {
				Tabs.sendMessage(tab.id, { cmd: 'refreshIcon', arg: {} }, function () { void chrome.runtime.lastError; });
			});
		});
	},
	onButtons: function (target) {
		let index = target.getAttribute('data-index');
		getTab(function (tab) {
			req('fromHistory', { index: index, tabId: tab.id, url: tab.url });
		});
	},
	onDelete: function (target) {
		let index = target.getAttribute('data-index');
		getTab(function (tab) {
			req('delItem', { url: tab.url, index: index }).then(function () {
				PopUp._formHistory();
				Tabs.sendMessage(tab.id, { cmd: 'refreshIcon', arg: {} }, function () { void chrome.runtime.lastError; });
			});
		});
	},
	onPopTab: function () {
		sendCommand({ cmd: 'entireTab' }, function (answer) {
			if (answer) window.close();
		});
	},
	onSelect: function () {
		if (document.getElementById('select').checked) {
			sendCommand({ cmd: 'start' }, function () {
				window.close();
			});
		} else {
			sendCommand({ cmd: 'stop' }, function () { });
		}
	},
	switchOn: function (e) {
		let index = e.target.getAttribute('data-index');
		getTab(function (tab) {
			req('getItem', { url: tab.url, index: index }).then(function (item) {
				Tabs.sendMessage(tab.id, { cmd: 'switchOn', arg: { css: item.selector } });
			});
		});
	},
	switchOff: function () {
		sendCommand({ cmd: 'switchOff', arg: {} }, function () { });
	},
	saveSettings: function () {
		var pos = { left: 0, top: 0, auto: 0 };
		if (document.getElementById('auto').checked) {
			pos.auto = 1;
		} else {
			if (document.getElementById('lftop').checked || document.getElementById('rgtop').checked) {
				pos.top = 1;
			}
			if (document.getElementById('lftop').checked || document.getElementById('lfbottom').checked) {
				pos.left = 1;
			}
		}
		req('getCfg').then(function (cfg) {
			cfg.isDuplicate = document.getElementById('duplicate').checked;
			cfg.isCopy = document.getElementById('isCopy').checked;
			cfg.isFocus = !document.getElementById('focus').checked;
			cfg.hideAllIcon = document.getElementById('hideAllIcon').checked;
			cfg.size.width = document.getElementById('width').value;
			cfg.size.height = document.getElementById('height').value;
			cfg.showAdvSettings = document.getElementById('advSettings').checked;
			cfg.position = pos;
			return req('saveCfg', cfg);
		}).then(function () {
			if (document.getElementById('hideAllIcon').checked) {
				sendCommand({ cmd: 'hideAllIcons', arg: {} }, function () { });
			} else {
				sendCommand({ cmd: 'refreshIcon', arg: {} }, function () { });
			}
		});
	},
	toggleAdvSettings: function () {
		if (document.getElementById('advSettings').checked) {
			document.getElementById('advCfg').style.maxHeight = '550px';
		} else {
			document.getElementById('advCfg').style.maxHeight = '0';
		}
	},
	toggleDupCfg: function () {
		if (document.getElementById('duplicate').checked) {
			document.getElementById('restTab').style.display = 'block';
		} else {
			document.getElementById('restTab').style.display = 'none';
		}
	},
	init: function () {
		this._loadSettings();
		this._localization();
		this._formHistory();
		document.body.addEventListener('click', this._onClick.bind(PopUp));
	}
};

window.onload = function () { PopUp.init(); };
