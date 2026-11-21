<div align="right">

**English** · [中文](README.md)

</div>

---

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
