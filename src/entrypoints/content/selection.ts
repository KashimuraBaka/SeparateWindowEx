/**
 * 选中区域的解析：把"鼠标下面那个元素"翻译成用户真正想选的东西。
 *
 * 两个真实存在的坑：
 *
 * 1. 透明拦截层。站点常用一层没有可见内容的浮层盖住播放器（B 站是 geetest
 *    验证码浮层），`elementFromPoint` 命中的永远是它：点击被它吃掉，弹出的
 *    只有裸视频或整页，站点记录里还会多出一条 `DIV.geetest_…` 的垃圾区域。
 *    这里按 display/visibility/opacity/尺寸识别并穿透。
 *
 * 2. 盖在播放器上的浮层。光标下面确实有 `<video>`，但命中的元素不是它 ——
 *    用户想点的显然是播放器，于是改取视频外面那层容器（弹幕层、控件都在那里，
 *    而 `<video>` 本身只剩画面）。只点视频本体时维持"只镜像视频"的行为。
 */

export interface SelectionHooks {
  /** 隐藏扩展自己的选区覆盖层，避免它参与命中测试。 */
  hideOverlay?: () => void;
  /** 恢复上面的覆盖层。 */
  showOverlay?: () => void;
  /** 扩展自己注入的元素（不该被选中），默认按 `__` 前缀的 id 判断。 */
  isOwnElement?: (el: Element) => boolean;
}

export class TargetResolver {
  /** 播放器容器至少要有这么大（太小说明只是包了一层的壳）。 */
  private readonly minHostWidth = 200;
  private readonly minHostHeight = 120;
  /** 弹幕层的特征选择器（bilibili 视频页/直播页、以及常见 danmaku 命名）。 */
  private readonly danmakuSelector = '.bpx-player-row-dm-wrap, .web-player-danmaku, .bili-danmaku-x-dm, [class*="danmaku"]';

  constructor(
    private readonly doc: Document,
    private readonly hooks: SelectionHooks = {},
  ) {}

  /** 不可见 / 零尺寸的拦截层。 */
  isGhostLayer(el: Element | null | undefined): boolean {
    if (!el || el.nodeType !== 1) return false;
    if (el === this.doc.body || el === this.doc.documentElement) return false;
    const view = this.doc.defaultView;
    if (!view) return false;
    let style: CSSStyleDeclaration | null = null;
    try {
      style = view.getComputedStyle(el);
    } catch {
      return false;
    }
    if (!style) return false;
    if (style.display === 'none' || style.visibility === 'hidden') return true;
    if (parseFloat(style.opacity) === 0) return true;
    const rect = el.getBoundingClientRect();
    return rect.width < 2 || rect.height < 2;
  }

  /** 光标下有 `<video>`、但命中的是盖在它上面的浮层时，返回视频外面那层容器。 */
  videoHostFor(stack: Element[] | null, target: Element | null): Element | null {
    if (!stack || !stack.length) return null;
    for (const node of stack) {
      if (!node || node.tagName !== 'VIDEO') continue;
      if (node === target || node.contains(target)) return null; // 就点在视频里：维持"只镜像视频"
      let parent: Element | null = node;
      for (let i = 0; i < 4 && parent; i++) {
        parent = parent.parentElement;
        if (!parent || parent === this.doc.body || parent === this.doc.documentElement) break;
        const rect = parent.getBoundingClientRect();
        if (rect.width >= 200 && rect.height >= 120) return parent;
      }
      return null;
    }
    return null;
  }

  /**
   * 找"视频外面那层播放器容器"：它得装着弹幕层（DOM 弹幕），才值得整块搬进置顶窗口。
   *
   * 为什么需要它：用户点的是视频本身，而只要视频的话弹幕、字幕、控件全都看不到
   * （普通视频页和直播页都是如此）。所以往上找一层既有弹幕、又够大的容器，
   * 把容器搬走、视频仍然用镜像 —— 既带上弹幕，又不会像搬 <video> 那样打断 MSE。
   */
  playerHostFor(video: Element | null): Element | null {
    if (!video) return null;
    let node: Element | null = video;
    for (let i = 0; i < 4 && node; i++) {
      node = node.parentElement;
      if (!node || node === this.doc.body || node === this.doc.documentElement) return null;
      const rect = node.getBoundingClientRect();
      if (rect.width < this.minHostWidth || rect.height < this.minHostHeight) continue;
      // 装着弹幕层的容器最理想；弹幕还没加载时，退一步按结构判断：
      // 真实播放器容器里除了视频那条链，还会有控件/浮层（子元素 ≥ 2），
      // 而纯包一层的壳通常只有 1 个孩子。
      if (node.querySelector(this.danmakuSelector)) return node;
      if (node.children.length >= 2) return node;
    }
    return null;
  }
  /** 命中测试 + 穿透（会临时收起扩展自己的覆盖层）。 */
  fromPoint(x: number, y: number): Element | null {
    this.hooks.hideOverlay?.();
    let target = this.doc.elementFromPoint(x, y);
    const stack = this.doc.elementsFromPoint ? Array.from(this.doc.elementsFromPoint(x, y)) : [];
    if (this.isGhostLayer(target) && stack.length) {
      // elementsFromPoint 是"最上面优先"：从最上面往下找第一个既不是自己的覆盖层、
      // 也不是透明拦截层的元素 —— 那才是用户真正看见的东西。
      for (const el of stack) {
        if (!el || this.isOwn(el) || this.isGhostLayer(el)) continue;
        target = el;
        break;
      }
    }
    const host = this.videoHostFor(stack, target);
    if (host) target = host;
    this.hooks.showOverlay?.();
    return target;
  }

  /** 统一入口：把光标下的元素解析成最终要选的元素。 */
  resolve(x: number, y: number, hovered: Element | null): Element | null {
    if (!hovered || this.isGhostLayer(hovered)) return this.fromPoint(x, y);
    const stack = this.doc.elementsFromPoint ? Array.from(this.doc.elementsFromPoint(x, y)) : null;
    return this.videoHostFor(stack, hovered) || hovered;
  }

  private isOwn(el: Element | null | undefined): boolean {
    if (!el) return true;
    if (this.hooks.isOwnElement) return this.hooks.isOwnElement(el);
    return !!el.id && el.id.indexOf('__') === 0;
  }
}
