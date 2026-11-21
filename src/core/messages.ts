/**
 * 消息收发，后台、内容脚本和 frame 脚本共用。
 *
 * 线上格式沿用旧版：进来是 `{ cmd, arg }`，出去是普通返回值 —— 已经装过的版本就是这么
 * 通信的。集中到这里的好处是后台与内容脚本不会再各写一套信封，派发规则也能脱离浏览器单测。
 */

export interface Envelope<T = unknown> {
  cmd: string;
  arg?: T;
  [key: string]: unknown;
}

export type Handler = (arg: any, sender?: unknown) => unknown;
export type HandlerTable = Record<string, Handler>;

/**
 * 按 `request.cmd` 执行表里的处理函数。未知命令返回 undefined 而不抛错：
 * 旧版本残留的内容脚本不应该把后台搞崩。
 */
export function dispatch(table: HandlerTable, request: Envelope | null | undefined, sender?: unknown): unknown {
  if (!request || typeof request.cmd !== 'string') return undefined;
  if (!Object.prototype.hasOwnProperty.call(table, request.cmd)) return undefined;
  return table[request.cmd](request.arg, sender);
}

/** 给某个标签页发 `{ cmd, arg }`，忽略"没有接收端"的错误。 */
export function sendToTab<T>(tabId: number, cmd: string, arg?: T, callback?: (response: unknown) => void): void {
  const message: Envelope<T> = { cmd };
  if (arg !== undefined) message.arg = arg;
  chrome.tabs.sendMessage(tabId, message, (response) => {
    void chrome.runtime.lastError;
    if (callback) callback(response);
  });
}

/** 发给扩展自身上下文（弹窗、后台）。 */
export function sendToExtension<T>(cmd: string, arg?: T, callback?: (response: unknown) => void): void {
  const message: Envelope<T> = { cmd };
  if (arg !== undefined) message.arg = arg;
  chrome.runtime.sendMessage(message, (response) => {
    void chrome.runtime.lastError;
    if (callback) callback(response);
  });
}
