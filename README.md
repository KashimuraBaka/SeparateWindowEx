<details open name="lang">
<summary><b>中文</b></summary>

# Separate Window Ex（Chrome/Edge 扩展，Manifest V3）

"Separate Window Ex" 可将网页中的任意区域——或整个 `<video>` / `<iframe>`——弹出为一个独立的置顶窗口，并自带自定义视频播放器（画中画、旋转/缩放/滤镜、倍速、全屏）。

## 功能

**区域弹出**

- 选中网页中的任意元素，弹出只显示该区域的独立窗口
- 一键弹出整个标签页
- 自动记住每个站点上次使用的区域与窗口尺寸

**两种窗口模式**

- **置顶窗口（默认）**：基于 Document Picture-in-Picture，始终浮在其他窗口之上；视频以镜像方式播放，直播不会中断，浏览器切到后台或最小化后画面与弹幕仍持续
- **经典窗口**：把整个标签页移入独立浏览器窗口，完整保留页面原有状态与样式

**置顶窗口控制面板**

- 返回（关闭并还原页面）
- 保存 / 清除该区域的窗口尺寸
- 上一级 / 下一级（在父元素与子元素之间切换显示区域）
- 截图、添加书签、获取元素链接

**自定义视频播放器**

- 画中画、旋转、缩放
- 亮度 / 对比度 / 饱和度 / 模糊 滤镜与重置
- 播放倍速、全屏
- 内嵌 `<iframe>` 播放器同样可用

**其他**

- 右键菜单快速弹出
- 按站点保存选区历史、书签与截图
- 界面支持中文 / English / Русский

## 许可证

基于 [MIT 许可证](LICENSE) 发布。

</details>

<details name="lang">
<summary><b>English</b></summary>

# Separate Window Ex (Chrome/Edge extension, Manifest V3)

"Separate Window Ex" pops an arbitrary area of a web page — or a whole `<video>` / `<iframe>` —
out into its own always-on-top popup window, with a custom video player (picture-in-picture,
rotate/zoom/filters, playback speed, fullscreen).

## Features

**Pop out a region**

- Select any element on a page and open it in a separate window that shows only that region
- Pop out the whole tab with one click
- Remembers the last region and window size per site

**Two window modes**

- **Top-most window (default)**: built on Document Picture-in-Picture, so it floats above other
  windows. Video is mirrored instead of moved, so live streams keep playing and the picture and
  danmaku keep updating even when the browser is in the background or minimised
- **Classic window**: moves the whole tab into its own browser window and keeps the page exactly
  as it was

**Top-most window control panel**

- Back (close and restore the page)
- Save / clear the window size for this region
- Previous / next level (walk between the parent and child elements)
- Screenshot, add bookmark, copy element link

**Custom video player**

- Picture-in-picture, rotate, zoom
- Brightness / contrast / saturation / blur filters with reset
- Playback speed, fullscreen
- Works for players embedded in an `<iframe>` too

**Other**

- Context-menu shortcut
- Per-site history of selections, bookmarks and screenshots
- UI in 中文 / English / Русский

## License

Released under the [MIT License](LICENSE).

</details>
