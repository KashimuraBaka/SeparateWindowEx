// @ts-nocheck -- 遗留文件体：模块边界已就位，类型迁移留到后续步骤。
import { register, use } from './runtime';


/**
 * 作者：Kashimura
 */
if(window == top){
	chrome.runtime.onMessage.addListener(
		function(request,sender,callback){
			if(request){callback(__BgCmd.cmd(request.cmd,request.arg));}
		}
	);
	window.addEventListener('message',function(event){
		if(event){
			if(event.data.hasOwnProperty('cmd')){
				event.stopImmediatePropagation();
				CmdFromFrame.cmd(event.source,event.data.cmd);
			}
		}
	});
}

var CmdFromFrame={
	cmd:function(source,cmd){
		if(this.hasOwnProperty(cmd)){
			this[cmd]();
		}
	},
	isVideo:function(){
		use('EventPanel').insertBtnResize();
	},
	isModify:function(){
		use('EventPanel').switchBtnResize(true);
	},
	isCancel:function(){
		use('EventPanel').switchBtnResize(false);
	},
	clear:function(){
		use('EventPanel').removeBtnResize();
	},
	toggleFullScr:function(){
		var fullscr=false;
		if(document.webkitIsFullScreen){
			document.webkitCancelFullScreen();
		}else{
			fullscr=true;
			document.body.webkitRequestFullScreen();
		}
		CmdToFrame.postMessage('toogleFullScrIco',{state:fullscr});
	},
	minimizeWin:function(){
		__BgCmd.sendCmd('minimizeWin',{});
	},
	restoreWin:function(){
		__BgCmd.sendCmd('restoreWin',{});
	}
};

var CmdToFrame={
	target:undefined,
	searchInFrame:function(target){
		this.target = target.contentWindow;
		this.postMessage('searchVideo');
	},
	cancel:function(){
		this.postMessage('cancel');	
	},
	modify:function(){
		this.postMessage('modify');
	},
	postMessage:function(command,arg){
		if(this.target){
			this.target.postMessage({cmd:command,arg:arg},'*');
		}
	},
	remove:function(){
		this.postMessage('remove');
		this.target = undefined;
	}
};

var __BgCmd={
	cmd:function(cmd,arg){
		let resp=false;
		if(this.hasOwnProperty(cmd)){
			resp=this[cmd](arg);
		}
		return resp;
	},
	setItems:function(arg){
		use('Observer').disconnectDomChange();
		use('__Icons').setSelectors(arg.icons,arg.hideIcons);
		use('Observer').domChange();
	},
	refreshIcon:function(){
		use('__Element').switchOff();
		use('__AppPanel').responseSelectors();
	},
	hideAllIcons:function(){
		use('__AppPanel').dellIcon();
	},
	switchOn:function(arg){
		use('__Element').switchOn(use('Selector').getFirstVisibleElem(arg.css));
	},
	switchOff:function(){
		use('__Element').switchOff();
	},
	start:function(){
		use('__AppPanel').start();
	},
	stop:function(){
		use('__AppPanel').stop();
	},
	entireTab:function(){
		use('__AppPanel').apply(document.body);
	},
	updateEntireTab:function(){
		use('__AppPanel').updateTab();
	},
	saveImage:function(arg){
		let elem=document.createElement('a');
		elem.setAttribute('href',arg.data);
		elem.setAttribute('download',document.location.host.replace(/\./ig,'-'));
		elem.style.display='none';
		document.body.appendChild(elem);
		elem.click();
		document.body.removeChild(elem);
	},
	isRun:function(){
		return use('__AppPanel').run;
	},
	sendCmd:function(cmd,arg,callback){
		chrome.runtime.sendMessage({cmd:cmd,arg:arg},
			function (response){
				if(callback){ callback(response ? response.answer : undefined); }
			}
		);
	},
	isBookmark:function(arg){
		use('Bookmarks').isBookmark=arg;
		// In Document PiP mode the page's button panel does not exist (the PiP
		// window owns its own copy), so guard against missing buttons.
		if (use('ButtonPanel') && use('ButtonPanel').btn_bkm && use('ButtonPanel').btn_bkm.classList) {
			use('ButtonPanel').setBookmark(arg);
		}
	},
	isSavedSize:function(arg){
		use('Modification').isSavedSize = arg;
		if (use('ButtonPanel') && use('ButtonPanel').btn_save && use('ButtonPanel').btn_save.classList) {
			use('ButtonPanel').setSavedIcon(arg);
		}
	},
	apply:function(arg){
		use('__AppPanel').apply(document.querySelector(arg));
	},
	cancel:function(){
		use('__AppPanel').cancel();
	},
	duplicate:function(arg){
		use('Duplicate').preparation(arg.selector);
	},
	modifyURL:function(){
		use('Selector').modifyURL(use('Modification').target);
	}
};

// ---- 注册表 ----
register('CmdFromFrame', CmdFromFrame);
register('CmdToFrame', CmdToFrame);
register('__BgCmd', __BgCmd);
