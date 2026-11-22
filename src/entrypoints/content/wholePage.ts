/**
 * 整页模式（BODY 弹出）的自适应。
 *
 * 站点普遍写死最小宽度（B 站是 `body{min-width:1080px}`），窗口比它窄时页面会
 * 横向溢出、几列被挤在一起 —— 看着就是"布局坏了"。
 *
 * 处理办法：只按宽度收敛，把 body 的 `zoom` 设成 `窗口宽 / 自然宽度`。
 * 用 `zoom` 而不是 `transform`，是因为 zoom 会连**布局**一起缩放（宽高、滚动范围
 * 都跟着变）；transform 只改画面、布局还留在原尺寸，会出现大片空白或裁切。
 * 纵向不缩放 —— 按高度缩会把整页压到看不清，纵向交给滚动条。
 */
export interface FitHost {
  readonly innerWidth: number;
}

export class WholePageFitter {
  private scale = 1;

  constructor(private readonly host: FitHost) {}

  /** 当前缩放比例（1 = 未缩放）。 */
  get currentScale(): number {
    return this.scale;
  }

  /**
   * 按窗口宽度收敛，返回实际使用的缩放比例。
   *
   * `naturalHint` 是**搬动之前**在页面里量到的 body 宽度，优先使用它：
   * body 一旦被搬进 PiP 文档（而且可能已经带着上一轮的 zoom），再量就会失准 ——
   * 实测出现过 480×30371 这种把页面拉成一条的失真值。
   */
  fit(body: HTMLElement | null, naturalHint?: number): number {
    if (!body || !body.style) return 1;
    body.style.zoom = '';                        // 先按 100% 量一次（有 hint 时也会被 hint 覆盖）
    const viewport = this.host.innerWidth | 0;
    if (!viewport) return 1;
    const measured = Math.max(body.scrollWidth | 0, body.offsetWidth | 0, 1);
    const natural = naturalHint && naturalHint > 0 ? naturalHint : measured;
    const scale = Math.min(viewport / natural, 1);
    this.scale = scale;
    // 只有放不下才缩
    body.style.zoom = scale < 0.999 ? String(scale) : '';
    return scale;
  }

  /** 搬回页面之前调用，清掉我们改过的内联样式。 */
  reset(body: HTMLElement | null): void {
    if (body && body.style) body.style.zoom = '';
    this.scale = 1;
  }
}
