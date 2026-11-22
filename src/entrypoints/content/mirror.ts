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
  readonly innerWidth: number;
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
    if (video.videoWidth !== this.srcW || video.videoHeight !== this.srcH) {
      this.srcW = video.videoWidth;
      this.srcH = video.videoHeight;
      this.computeTargetSize();
    }
    if (this.view.width !== this.targetW || this.view.height !== this.targetH) {
      this.view.width = this.targetW;
      this.view.height = this.targetH;
    }
    ctx.drawImage(video, 0, 0, this.targetW, this.targetH);
    this.drawn += 1;
    this.sampleFps();
    return true;
  }

  /**
   * 后备尺寸不必等于源分辨率：取"窗口尺寸 × 像素比"就够清晰，
   * 但能挡住 4K 源在 144Hz 下每秒上 G 像素的填充量（高帧率下的卡顿来源之一）。
   */
  private computeTargetSize(): void {
    const dpr = Math.min(this.host.devicePixelRatio || 1, 2);
    const cap = Math.round((this.host.innerWidth || 0) * dpr);
    let width = this.srcW;
    let height = this.srcH;
    if (cap > 0 && width > cap) {
      width = cap;
      height = Math.max(1, Math.round((cap * this.srcH) / this.srcW));
    }
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
