// @ts-nocheck -- 遗留文件体：模块边界已就位，类型迁移留到后续步骤。
import { register, use } from './runtime';


/**
 * 作者：Kashimura
 */
var EventPanel = {
	panel: undefined,
	id: {
		panel: '__evt_panel',
		btn_resize: '__btn_resize',
		btn_player: '__btn_player'
	},
	btn_resize: undefined,
	btn_player: undefined,
	isModify: false,
	frcePlayer: false,
	add: function () {
		if (!this.panel) {
			this.panel = document.createElement('div');
			this.panel.id = this.id.panel;
			use('CssControl').setComClass(this.panel);
			document.body.appendChild(this.panel);
		}
	},
	remove: function () {
		if (this.panel) {
			this.removeBtnPlayer();
			this.removeBtnResize();
		}
	},
	insertBtnResize: function () {
		this.add();
		if (!this.btn_resize) {
			this.btn_resize = document.createElement('button');
			this.btn_resize.id = this.id.btn_resize;
			this.btn_resize.title = chrome.i18n.getMessage('PanelLoadIframe');
			this.btn_resize.classList.add(use('CssControl').class.eventPanel);
			this.btn_resize.classList.add('__btn_resize_off');
			this.panel.appendChild(this.btn_resize);
			this.panel.classList.add('__evt_panel_blink');
		}
	},
	insertBtnPlayer: function () {
		this.add();
		if (!this.btn_player) {
			this.btn_player = document.createElement('button');
			this.btn_player.id = this.id.btn_player;
			this.btn_player.title = chrome.i18n.getMessage('PanelForcePlayerOn');
			this.btn_player.classList.add(use('CssControl').class.eventPanel);
			this.btn_player.classList.add('__btn_player_off');
			this.panel.appendChild(this.btn_player);
			this.panel.classList.add('__evt_panel_blink');
		}
	},
	removeBtnPlayer: function () {
		if (this.btn_player) {
			this.panel.removeChild(this.btn_player);
			this.btn_player = undefined;
			this.frcePlayer = false;
			this.removePanel();
		}
	},
	removeBtnResize: function () {
		if (this.btn_resize) {
			this.panel.removeChild(this.btn_resize);
			this.btn_resize = undefined;
			this.isModify = false;
			this.removePanel();
		}
	},
	removePanel: function () {
		if (!this.btn_player && !this.btn_resize) {
			document.body.removeChild(this.panel);
			this.panel = undefined;
		}
	},
	switchBtnResize: function (isModify) {
		this.isModify = isModify;
		if (isModify) {
			this.btn_resize.classList.remove('__btn_resize_off');
			this.btn_resize.classList.add('__btn_resize_on');
		} else {
			this.btn_resize.classList.remove('__btn_resize_on');
			this.btn_resize.classList.add('__btn_resize_off');
		}
	},
	clickBtnPlayer: function () {
		if (this.frcePlayer) {
			VideoControls.remove();
			this.btn_player.title = chrome.i18n.getMessage('PanelForcePlayerOn');
			this.btn_player.classList.remove('__btn_player_on');
			this.btn_player.classList.add('__btn_player_off');
		} else {
			VideoControls.init(Modification.trgtVideo);
			this.btn_player.title = chrome.i18n.getMessage('PanelForcePlayerOff');
			this.btn_player.classList.remove('__btn_player_off');
			this.btn_player.classList.add('__btn_player_on');
		}
		this.frcePlayer = !this.frcePlayer;
	},
	clickBtnResize: function () {
		if (this.isModify) {
			use('CmdToFrame').cancel();
		} else {
			use('CmdToFrame').modify();
		}
	}
};

var ButtonPanel = {
	panel: {},
	id: {
		panel: '__btn_panel',
		btn_back: '__btn_back',
		btn_save:'__btn_save',
		btn_up: '__btn_up',
		btn_dwn: '__btn_dwn',
		btn_prsc: '__btn_prsc',
		btn_bkm: '__btn_bkm',
		btn_link: '__btn_link',
		btn_win_link: '__btn_win_link',
		area_link: '__area_link',
		win_link: '__win_link',
		win_link_over: '__win_link_overlay'
	},
	btn_save:{},
	btn_dwn: {},
	btn_up: {},
	btn_prsc: {},
	btn_bkm: {},
	btn_link: {},
	btn_iframe: {},
	win_link: {},
	isShowLink: false,
	windowZoom: 0,
	add: function () {
		use('CssControl').insert('panel');
		this.panel = document.createElement('div');
		this.panel.innerHTML = '<button id="' + this.id.btn_back + '" class="' + use('CssControl').class.btnPanel + '" title="' + chrome.i18n.getMessage('PanelBack') + '"></button>' +
			'<button id="' + this.id.btn_save + '" class="' + use('CssControl').class.btnPanel + '" title="' + chrome.i18n.getMessage('PanelSaveSize') + '"></button>' +
			'<button id="' + this.id.btn_up + '" class="' + use('CssControl').class.btnPanel + '" title="' + chrome.i18n.getMessage('PanelScrollUp') + '"></button>' +
			'<button id="' + this.id.btn_dwn + '" class="' + use('CssControl').class.btnPanel + '" title="' + chrome.i18n.getMessage('PanelScrollDown') + '"></button>' +
			'<button id="' + this.id.btn_prsc + '" class="' + use('CssControl').class.btnPanel + '" title="' + chrome.i18n.getMessage('PanelPrintScreen') + '"></button>' +
			'<button id="' + this.id.btn_bkm + '" class="' + use('CssControl').class.btnPanel + '" title="' + chrome.i18n.getMessage('PanelBookMarks') + '"></button>' +
			'<button id="' + this.id.btn_link + '" class="' + use('CssControl').class.btnPanel + '" title="' + chrome.i18n.getMessage('PanelGetLink') + '"></button>';
		this.panel.id = this.id.panel;
		use('CssControl').setComClass(this.panel);
		this.panel.classList.add('__btn_panel_blink');
		document.body.appendChild(this.panel);
		this.btn_save = document.getElementById(this.id.btn_save);
		this.btn_up = document.getElementById(this.id.btn_up);
		this.btn_dwn = document.getElementById(this.id.btn_dwn);
		this.btn_prsc = document.getElementById(this.id.btn_prsc);
		this.btn_bkm = document.getElementById(this.id.btn_bkm);
		this.btn_link = document.getElementById(this.id.btn_link);
		if (Modification.target == document.body) {
			this.btn_up.style.display = 'none';
			this.btn_dwn.style.display = 'none';
			this.btn_save.style.display = 'none';
		}
		use('__BgCmd').sendCmd('checkSaveSize', { selector: Modification.selector });
		use('Bookmarks').checkBookmark(Modification.target);
		this.scrollDownEnabled(false);
		setTimeout(function () {
			ButtonPanel.changeZoom();
		}, 650);
	},
	remove: function () {
		use('CssControl').remove('panel');
		if (this.panel instanceof HTMLElement) document.body.removeChild(this.panel);
		if (this.isShowLink) { this.delWinLink(); }
		this.btn_save = {};
		this.btn_up = {};
		this.btn_dwn = {};
		this.panel = {};
		this.btn_prsc = {};
		this.btn_bkm = {};
		this.btn_link = {};
		this.win_link = {};
	},
	clickBack: function () {
		use('__AppPanel').cancel();
	},
	clickSave:function(){
		let size={};
		if(!Modification.isSavedSize){
			size={
				top : window.screenTop,
				left : window.screenLeft,
				width : window.outerWidth,//innerWidth,
				height : window.outerHeight//innerHeight
			}
		}
		Modification.isSavedSize=!Modification.isSavedSize;
		// 一次记住：当前区域 + 尺寸 + 位置（区域未登记时后台会先登记）
		use('__AppPanel').saveAreaState(JSON.stringify(size));
		this.setSavedIcon(Modification.isSavedSize);
	},
	clickUp: function () {
		Modification.scrollUp();
		use('Bookmarks').checkBookmark(Modification.target);
	},
	clickDown: function () {
		Modification.scrollDown();
		use('Bookmarks').checkBookmark(Modification.target);
	},
	clickPrtScr: function () {
		this.panel.style.display = 'none';
		VideoControls.hide();
		setTimeout(function () {
			use('__BgCmd').sendCmd('printScr', { name: window.location.hostname });
		}.bind(this), 50);
		setTimeout(function () {
			this.panel.style.display = '';
			VideoControls.show();
		}.bind(this), 150);
	},
	clickBkm: function () {
		use('Bookmarks').addBookmark(Modification.target);
	},
	clickShowLink: function () {
		if (this.isShowLink) {
			this.delWinLink();
		} else {
			this.showWinLink();
		}
	},
	changeZoom: function () {
		let zoom = window.devicePixelRatio;
		// resize 往往先于"进入独立窗口"到达，此时 Modification.target / 面板
		// 都还不存在；早退，避免 offsetWidth of undefined（控制台会一直刷这条）。
		if (!Modification.target || !this.panel || !this.panel.style) return;
		let right = Modification.target.offsetWidth - Modification.target.clientWidth;
		this.windowZoom = zoom;
		if (zoom == 1) {
			this.panel.style.zoom = '';
		} else {
			zoom = 1 / zoom;
			this.panel.style.zoom = zoom;
			right = Math.round(right / zoom);
		}
		this.panel.style.right = right + 'px';
	},
	onResize: function () {
		this.changeZoom();
	},
	delWinLink: function () {
		document.body.removeChild(this.win_link);
		this.isShowLink = false;
	},
	showWinLink: function () {
		this.win_link = document.createElement('div');
		this.win_link.innerHTML = '<div id="' + this.id.win_link + '"><div><textarea>' + use('Selector').getLink(Modification.target) + '</textarea></div><button id="' + this.id.btn_win_link + '" class="' + use('CssControl').class.btnPanel + '" ">OK</button></div>';
		this.win_link.id = this.id.win_link_over;
		use('CssControl').setComClass(this.win_link);
		document.body.appendChild(this.win_link);
		this.isShowLink = true;
	},
	scrollUpEnabled: function (enabled) {
		enabled ?
			this.btn_up.classList.remove('disable') :
			this.btn_up.classList.add('disable');
	},
	scrollDownEnabled: function (enabled) {
		enabled ?
			this.btn_dwn.classList.remove('disable') :
			this.btn_dwn.classList.add('disable');
	},
	setBookmark: function (isBkm) {
		if (isBkm) {
			this.btn_bkm.classList.remove('btn_bkm_off');
			this.btn_bkm.classList.add('btn_bkm_on');
		} else {
			this.btn_bkm.classList.remove('btn_bkm_on');
			this.btn_bkm.classList.add('btn_bkm_off');
		}
	},
	setSavedIcon:function(isSaved) {
		if(isSaved){
			this.btn_save.classList.remove('btn_save_off');
			this.btn_save.classList.add('btn_save_on');
			this.btn_save.setAttribute('title',chrome.i18n.getMessage('PanelSaveSizeOn'));
		}else{
			this.btn_save.classList.remove('btn_save_on');
			this.btn_save.classList.add('btn_save_off');
			this.btn_save.setAttribute('title',chrome.i18n.getMessage('PanelSaveSizeOff'));
		}
	}
};

var Modification = {
	flags: {
		initElem:undefined,
		scroll:0
	},
	isSeparate: false,
	isSavedSize: false,
	scrollBefore: {
		top: 0,
		left: 0
	},
	selector: '',
	parent: {},
	target: undefined,
	trgtVideo: undefined,
	fixFunc: {},
	_modifyFunc: function () {
		var func = 'Element.prototype["swRemCh"]=Element.prototype.removeChild;' +
			'Element.prototype.removeChild=function(elem){' +
			'if(elem.classList && (elem.classList.contains("__parent") || elem.classList.contains("__target"))){' +
			'if(elem.hasAttribute("src") && elem.getAttribute("src")==""){elem.parentNode.swRemCh(elem);return;}' +
			'if(document.hasOwnProperty("swRemoval")){' +
			'if(document.swRemoval.indexOf(elem)==-1) document.swRemoval.push(elem);' +
			'}else{document["swRemoval"]=[];document.swRemoval.push(elem);}' +
			'}else{Element.prototype.swRemCh.apply(this,[elem]);}}';
		this.fixFunc = document.createElement('script');
		this.fixFunc.appendChild(document.createTextNode(func));
		document.body.appendChild(this.fixFunc);
	},
	_removeFunc: function () {
		var func = 'Element.prototype.removeChild=Element.prototype.swRemCh;' +
			'if(document.hasOwnProperty("swRemoval")){' +
			'for(var i=0,len=document.swRemoval.length;i<len;i++){document.swRemoval[i].parentNode.removeChild(document.swRemoval[i]);};' +
			'delete document["swRemoval"];delete document["swRemCh"];}';

		this.fixFunc = document.createElement('script');
		this.fixFunc.appendChild(document.createTextNode(func));
		document.body.appendChild(this.fixFunc);
	},
	_deleteFunc: function () {
		if (this.fixFunc.parentNode) {
			document.body.removeChild(this.fixFunc);
		}
	},
	_modifyStyle: function (elem, style, isSet) {
		if (use('CssControl').isComClass(elem)) return 0;
		if (isSet) {
			elem.classList.add(style);
			use('Observer').init(elem, style);
		} else {
			use('Observer').disconnect(elem, style);
			elem.classList.remove(style);
		}
	},
	_hideTextNode: function (elem, hide) {
		if (hide) {
			elem['oldValue'] = elem.nodeValue;
			elem.nodeValue = '';
		} else {
			elem.nodeValue = elem['oldValue'];
			delete elem['oldValue'];
		}
	},
	_modifyOne: function (elem, isSet) {
		let child = elem.parentNode.firstChild;
		while (child) {
			if (child !== elem && child.tagName !== 'SCRIPT' && child.tagName !== 'LINK') {
				switch (child.nodeType) {
					case 1:
						this._modifyStyle(child, '__hidden', isSet);
						break;
					case 3:
						this._hideTextNode(child, isSet);
						break;
				}
			}
			child = child.nextSibling;
		}
		this._modifyStyle(elem.parentNode, '__parent', isSet);
	},
	_modifyTarget: function (target, isSet) {
		if (isSet) {
			VideoControls.init(target);
			this._searchVideo(target);
		} else {
			VideoControls.remove();
			EventPanel.removeBtnPlayer();
		}
		this._modifyStyle(target, '__target', isSet);
	},
	_modifyParents: function (elem, isSet) {
		if (elem && elem.tagName !== 'BODY') {
			this._modifyParents(elem.parentNode, isSet);
			this._modifyOne(elem, isSet);
		}
	},
	_scroll: function (isSet) {
		if (isSet) {
			this.scrollBefore.top = window.pageYOffset;
			this.scrollBefore.left = window.pageXOffset;
			this.checkTrgtScrolling();
		} else {
			this.target.classList.remove('__onScroll');
		}
	},
	_searchVideo: function (target) {
		if (VideoControls.isPresent) return;
		if (!target) target = this.target;
		var video = target.querySelector('VIDEO');
		if (video) {
			this.trgtVideo = video;
			EventPanel.insertBtnPlayer();
		}
	},
	checkTrgtScrolling: function () {
		// 这个函数会被 resize/滚动监听调用，那时可能还没有 target
		// （还没进入"独立窗口"状态）；早退，否则抛
		// "Cannot read properties of undefined (reading 'scrollHeight')"。
		if (!this.target) return;
		if ((this.target.scrollHeight - this.target.clientHeight) > 55) {
			this.target.classList.add('__onScroll');
		} else {
			this.target.classList.remove('__onScroll');
		}
	},
	do: function (target, selector) {
		this.isSeparate = true;
		this.target = target;
		this.selector = selector;
		if (this.target && this.target !== document.body) {
			this._modifyFunc();
			this._scroll(true);
			try {
				this.parent = this.target.parentNode;
				this._modifyTarget(this.target, true);
				this._modifyParents(this.target, true);
			} catch (e) {
				this.errorRestore();
				console.log(e);
			}
			use('CssControl').insert('window');
			this._deleteFunc();
		}
	},
	cancel: function () {
		if (this.target && this.target !== document.body) {
			this._scroll(false);
			this._removeFunc();
			try {
				this._modifyParents(this.target, false);
				this._modifyTarget(this.target, false);
			} catch (e) {
				this.errorRestore();
				console.log(e);
			}
			document.body.removeChild(this.fixFunc);
		}
		use('Observer').clearServers();
		window.scrollTo(this.scrollBefore.left, this.scrollBefore.top);
		this.target = this.parent = undefined;
		this.selector = '';
		this.isSeparate = false;
		this.flags.scroll = 0;
		use('CssControl').remove('window');
		this._deleteFunc();
	},
	cancelOnChangeDOM: function () {
		use('Observer').clearServers();
		this.errorRestore();
		this._scroll(false);
		this._removeFunc();
		window.scrollTo(this.scrollBefore.left, this.scrollBefore.top);
		this.isSeparate = false;
		document.body.removeChild(this.fixFunc);
	},
	checkChanges: function () {
		if (!this.target.parentNode) {
			let elems = document.querySelectorAll(this.selector);
			this._modifyTarget(this.target, false);
			elems.forEach(function (elem) {
				if (elem.parentNode == this.parent) {
					this.target = elem;
					return false;
				}
			}.bind(this));
			if (this.target) this._modifyTarget(this.target, true);
		}
		let parent = this.parent;
		while (parent.tagName !== 'BODY') {
			if (!parent.classList.contains('__parent')) {
				this.cancelOnChangeDOM();
				this.do(this.target, use('Selector').getSelector(this.target));
				break;
			}
			parent = parent.parentNode;
		}
	},
	isTarget: function (srcWin) {
		return srcWin == this.target.contentWindow;
	},
	errorRestore: function () {
		this._modifyTarget(this.target, false);
		document.querySelectorAll('.__hidden,.__parent')
			.forEach(elem => elem.classList.remove('__hidden', '__parent'));
	},
	scrollCheck: function () {
		if (this.target.tagName == 'BODY') {
			ButtonPanel.scrollUpEnabled(false);
		} else {
			ButtonPanel.scrollUpEnabled(true);
		}
		if (this.target == this.flags.initElem) {
			ButtonPanel.scrollDownEnabled(false);
		} else {
			ButtonPanel.scrollDownEnabled(true);
		}
	},
	scrollUp: function () {
		if (this.target.tagName == 'BODY') return false;
		if (this.flags.scroll == 0) this.flags.initElem = this.target;
		this.flags.scroll++;
		this._modifyTarget(this.target, false);
		this._modifyOne(this.target, false);

		this.target = this.target.parentNode;
		this._modifyTarget(this.target, true);

		this.scrollCheck();
		this.saveSelector();
		return true;
	},
	scrollDown: function () {
		if (this.flags.scroll == 0) return false;
		var i = 0;
		var elem = this.flags.initElem;
		this.flags.scroll--;
		while (i < this.flags.scroll) {
			elem = elem.parentNode;
			i++;
		}
		this._modifyTarget(this.target, false);
		this.target = elem;
		this._modifyTarget(this.target, true);
		this._modifyOne(this.target, true);

		this.scrollCheck();
		this.saveSelector();
		return true;
	},
	saveSelector:function(){
		this.selector = use('Selector').getSelector(this.target);
		// 上一级/下一级换了区域：同步给面板，尺子按钮保存时才是当前这个区域
		use('__AppPanel').selector = this.selector;
		use('__AppPanel').saveSelector(this.selector);
	}
};

var SepWinEvents = {
	timers: {
		onResize: null
	},
	addEvents: function () {
		// 必须用**绑好的**函数注册：处理器里用 `this.cmdBtnPanel(...)` /
		// `this.timers` 访问对象成员，直接传 `SepWinEvents.onClick` 会让
		// this 变成 window，于是每次点击/缩放都抛
		// `this.cmdBtnPanel is not a function`、`checkTrgtScrolling` 里的
		// `.scrollHeight` of undefined（另一台设备的控制台就是这么报的）。
		// 而且 removeEventListener 必须拿到同一个引用，所以绑定后存回对象。
		SepWinEvents.onClick = SepWinEvents.onClick.bind(SepWinEvents);
		SepWinEvents.onResize = SepWinEvents.onResize.bind(SepWinEvents);
		SepWinEvents.unloadPage = SepWinEvents.unloadPage.bind(SepWinEvents);
		window.addEventListener('click', SepWinEvents.onClick, true);
		window.addEventListener('resize', SepWinEvents.onResize, true);
		// unload 已被 Chromium 弃用（控制台会报 "Permissions policy violation:
		// unload is not allowed in this document"），用 pagehide 代替。
		window.addEventListener('pagehide', SepWinEvents.unloadPage, true);
	},
	removeEvents: function () {
		clearTimeout(this.timers.onResize);
		window.removeEventListener('click', SepWinEvents.onClick, true);
		window.removeEventListener('resize', SepWinEvents.onResize, true);
		window.removeEventListener('pagehide', SepWinEvents.unloadPage, true);
	},
	onClick: function (event) {
		if (use('CssControl').isBtnClass(event.target)) {
			this.cmdBtnPanel(event.target.id);
		}
		else if (use('CssControl').isEventClass(event.target)) {
			this.cmdEventPanel(event.target.id);
		} else {
			if (VideoControls.isPresent) {
				VideoControls.mouseClick(event);
			}
		}
	},
	onResize: function () {
		if (this.timers.onResize) {
			clearTimeout(this.timers.onResize);
		}
		this.timers.onResize = setTimeout(
			function () {
				Modification.checkTrgtScrolling();
				ButtonPanel.onResize();
			},
			150);
	},
	cmdEventPanel: function (id) {
		switch (id) {
			case EventPanel.id.btn_resize:
				EventPanel.clickBtnResize();
				break;
			case EventPanel.id.btn_player:
				EventPanel.clickBtnPlayer();
				break;
			default:
				break;
		}
	},
	cmdBtnPanel: function (id) {
		switch (id) {
			case ButtonPanel.id.btn_back:
				ButtonPanel.clickBack();
				break;
			case ButtonPanel.id.btn_save:
				ButtonPanel.clickSave();
				break;
			case ButtonPanel.id.btn_up:
				ButtonPanel.clickUp();
				break;
			case ButtonPanel.id.btn_dwn:
				ButtonPanel.clickDown();
				break;
			case ButtonPanel.id.btn_prsc:
				ButtonPanel.clickPrtScr();
				break;
			case ButtonPanel.id.btn_bkm:
				ButtonPanel.clickBkm();
				break;
			case ButtonPanel.id.btn_link:
				ButtonPanel.clickShowLink();
				break;
			case ButtonPanel.id.btn_win_link:
				ButtonPanel.delWinLink();
				break;
			default:
				return;
		}
	},
	unloadPage:function(){
		if (Modification.target == document.body) {
			use('__BgCmd').sendCmd('updatePage', {});
		} else {
			use('__BgCmd').sendCmd('unloadPage', {});
		}
	}
};

// ---- 注册表 ----
register('EventPanel', EventPanel);
register('ButtonPanel', ButtonPanel);
register('Modification', Modification);
register('SepWinEvents', SepWinEvents);
