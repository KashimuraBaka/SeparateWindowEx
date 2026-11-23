/**
 * 把页面里某个 `<video>` 的当前帧持续复制到 PiP 窗口的 `<canvas>` 上。
 *
 * 为什么不用 `captureStream`：它的帧来自源元素自己的 frame sink，页面一隐藏
 * （源 `<video>` 又被挪到屏幕外）浏览器就不再送帧，镜像会冻在最后一帧，而声音
 * 仍在播放 —— 就是"画面冻住、声音还在"。
 * `drawImage` 是直接从解码器取当前帧，与元素有没有被合成无关。
 *
 * 帧时钟：每个 `requestAnimationFrame` 画一次（= 显示器刷新率，60/144 都跟得上），
 * 另有一个 60ms 的兜底定时器，只在 rAF 停了 120ms 以上时补帧（窗口被遮挡、
 * 合成器停摆）。**不要**用 `totalVideoFrames` / `requestVideoFrameCallback` 判断
 * "有没有新帧"：那两个都是送显计数，隐藏页面下按 ~200ms 一批跳好几帧，
 * 拿它们当判据会把镜像压成 5 帧/秒（画面一顿一顿）。
 */

export interface MirrorSize {
  width: number;
  height: number;
}

/** rAF/定时器的宿主。PiP 窗口和页面 window 都满足这个形状。 */
export interface FrameHost {
  requestAnimationFrame(cb: FrameRequestCallback): number;
  cancelAnimationFrame(handle: number): void;
  setInterval(handler: () => void, timeout: number): number;
  clearInterval(handle: number): void;
  setTimeout(handler: () => void, timeout: number): number;
  clearTimeout(handle: number): void;
  readonly innerWidth: number;
  readonly innerHeight: number;
  readonly devicePixelRatio: number;
}

export class VideoMirror {
  private ctx: CanvasRenderingContext2D | null = null;
  private rafHandle = 0;
  private backstopHandle = 0;
  private started = false;
  private drawn = 0;
  private fpsValue = 0;
  private rafStamp = 0;
  private errorCount = 0;
  private restartCount = 0;
  private targetW = 0;
  private targetH = 0;
  private srcW = 0;
  private srcH = 0;
  /** 上次算后备尺寸时的宿主尺寸（用来发现窗口被拖动/缩放）。 */
  private hostW = -1;
  private hostH = -1;
  /** 拖动窗口时的待应用尺寸：尺寸稳定后才重算（每帧重建后备缓冲是卡顿主因）。 */
  private pendingW = 0;
  private pendingH = 0;
  private lastSizeChangeAt = 0;
  /** 每帧看到的窗口尺寸（用来区分「还在拖」和「已经停下」）。 */
  private lastSeenW = -1;
  private lastSeenH = -1;
  /** 上次真正重建后备缓冲的时间（拖动过程中用它把重建限流到每 100ms 一次）。 */
  private lastResizeAt = 0;
  private fpsWindowStart = 0;
  private fpsWindowCount = 0;

  constructor(
    private host: FrameHost,
    private video: HTMLVideoElement,
    private readonly view: HTMLCanvasElement,
  ) {}

  get running(): boolean {
    return this.started;
  }

  /** 已绘制帧数（每画一帧 +1）。 */
  get frames(): number {
    return this.drawn;
  }

  /** 最近一秒的实际绘制帧率。 */
  get fps(): number {
    return this.fpsValue;
  }

  /** 距离上一次 rAF 回调多久了（用来判断循环是否还活着）。 */
  get rafAge(): number {
    return this.rafStamp ? Date.now() - this.rafStamp : -1;
  }

  get errors(): number {
    return this.errorCount;
  }

  get restarts(): number {
    return this.restartCount;
  }

  /** 画布后备尺寸（不是显示尺寸）。 */
  get size(): MirrorSize {
    return { width: this.view.width, height: this.view.height };
  }

  /** 站点换掉了源元素（切码率、断流重连）时接管新的那个。 */
  bindVideo(video: HTMLVideoElement): void {
    this.video = video;
    this.srcW = 0;
    this.srcH = 0;
  }

  /** 供看门狗使用：循环断了就原地重起，并记一次重启。 */
  restart(): void {
    this.restartCount += 1;
    this.start();
  }

  start(): void {
    this.stop();
    const host = this.host;
    if (!host || !this.view) return;
    try {
      this.ctx = this.view.getContext('2d', { alpha: false });
    } catch {
      this.ctx = null;
    }
    if (!this.ctx) return;
    this.started = true;
    this.drawn = 0;
    this.fpsValue = 0;
    this.fpsWindowStart = 0;
    this.fpsWindowCount = 0;
    this.srcW = 0;
    this.srcH = 0;
    this.hostW = -1;
    this.hostH = -1;
    this.rafStamp = 0;
    // 兜底：rAF 真的停摆时才补帧，不参与每帧调度
    this.backstopHandle = host.setInterval(() => {
      if (!this.started) {
        host.clearInterval(this.backstopHandle);
        this.backstopHandle = 0;
        return;
      }
      if (Date.now() - this.rafStamp < 120) return;
      try {
        this.paint();
      } catch {
        this.fail();
      }
    }, 60);
    try {
      this.rafHandle = host.requestAnimationFrame(this.tick);
    } catch {
      this.rafHandle = 0;
    }
  }

  stop(): void {
    this.started = false;
    const host = this.host;
    if (this.rafHandle && host) {
      try { host.cancelAnimationFrame(this.rafHandle); } catch { /* ignore */ }
    }
    if (this.backstopHandle && host) {
      try { host.clearInterval(this.backstopHandle); } catch { /* ignore */ }
    }
    this.rafHandle = 0;
    this.backstopHandle = 0;
    this.pendingW = 0;
    this.pendingH = 0;
  }

  private readonly tick = (): void => {
    this.rafStamp = Date.now();
    if (!this.started) return;
    try {
      this.paint();
    } catch {
      this.fail();
      return;
    }
    try {
      this.rafHandle = this.host.requestAnimationFrame(this.tick);
    } catch {
      this.rafHandle = 0;
    }
  };

  private fail(): void {
    this.errorCount += 1;
    this.started = false;
  }

  /** 画一帧；返回是否真的画了。 */
  private paint(): boolean {
    const video = this.video;
    if (!video || !video.videoWidth) return false;
    const ctx = this.ctx;
    if (!ctx) return false;
    // 源换了分辨率，或者**宿主窗口尺寸变了**，都要重算后备尺寸。
    // 只认源变化是不够的：PiP 窗口从 1084 拖到 1536 时后备尺寸会停在
    // 1084×610，画面被整体拉伸 —— 看起来就是马赛克。
    const winW = this.host.innerWidth || 0;
    const winH = this.host.innerHeight || 0;
    const now = Date.now();
    if (video.videoWidth !== this.srcW || video.videoHeight !== this.srcH) {
      this.srcW = video.videoWidth;
      this.srcH = video.videoHeight;
      this.pendingW = 0;
      this.pendingH = 0;
      this.lastSeenW = winW;
      this.lastSeenH = winH;
      this.computeTargetSize();
      this.resizeCanvas();
      this.lastResizeAt = now;
      return this.drawFrame(ctx, video);
    }
    // 拖动窗口时尺寸每帧都在变。每帧都改 canvas.width/height，等于每帧重建
    // 一次后备缓冲（GPU 重新分配 + 内容作废），拖动会明显卡；但只"等停下再算"
    // 又会出现"松手后画面还糊一会儿"。折中成两条：
    //   ① 拖动过程中最多每 100ms 重建一次（持续拖动时也能很快变清晰）；
    //   ② 尺寸一停（24ms≈3 帧没再变）立刻重建，松手瞬间就该是清晰的。
    if (winW !== this.lastSeenW || winH !== this.lastSeenH) {
      this.lastSeenW = winW;
      this.lastSeenH = winH;
      this.pendingW = winW;
      this.pendingH = winH;
      this.lastSizeChangeAt = now;
    }
    if (this.pendingW && (now - this.lastResizeAt >= 100 || now - this.lastSizeChangeAt >= 24)) {
      this.pendingW = 0;
      this.pendingH = 0;
      this.computeTargetSize();
      this.resizeCanvas();
      this.lastResizeAt = now;
    }
    return this.drawFrame(ctx, video);
  }

  private drawFrame(ctx: CanvasRenderingContext2D, video: HTMLVideoElement): boolean {
    ctx.drawImage(video, 0, 0, this.targetW, this.targetH);
    this.drawn += 1;
    this.sampleFps();
    return true;
  }

  /** 把后备尺寸写到画布上。会重建后备缓冲，所以只在必要时（源变化、尺寸稳定后）调用。 */
  private resizeCanvas(): void {
    if (this.view.width !== this.targetW || this.view.height !== this.targetH) {
      this.view.width = this.targetW;
      this.view.height = this.targetH;
    }
  }

  /**
   * 后备尺寸跟着**窗口大小**走：把源按比例铺进窗口，需要多少像素就渲染多少像素。
   *
   *  - 窗口比源小：按窗口渲染（4K 源在 1184 宽的窗口里只画 1184×666，
   *    不会在 144Hz 下白烧上 G 像素）；
   *  - 窗口比源大：直接按窗口渲染，放大由 drawImage 一次完成；
   *    以前是"封顶在源分辨率、再由合成器拉伸"，等于二次重采样，更糊。
   */
  private computeTargetSize(): void {
    const dpr = Math.min(this.host.devicePixelRatio || 1, 2);
    this.hostW = this.host.innerWidth || 0;
    this.hostH = this.host.innerHeight || 0;
    const winW = this.hostW || this.srcW;
    const winH = this.hostH || this.srcH;
    const fit = Math.min(winW / this.srcW, winH / this.srcH);
    const width = Math.max(1, Math.round(this.srcW * fit * dpr));
    const height = Math.max(1, Math.round(this.srcH * fit * dpr));
    this.targetW = width;
    this.targetH = height;
  }

  private sampleFps(): void {
    const now = Date.now();
    if (!this.fpsWindowStart) {
      this.fpsWindowStart = now;
      this.fpsWindowCount = 0;
    }
    this.fpsWindowCount += 1;
    const span = now - this.fpsWindowStart;
    if (span >= 1000) {
      this.fpsValue = Math.round((this.fpsWindowCount * 1000) / span);
      this.fpsWindowStart = now;
      this.fpsWindowCount = 0;
    }
  }
}
