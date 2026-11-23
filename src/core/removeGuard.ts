/**
 * “别让站点删掉我们的容器”的补丁（在主世界运行）。
 *
 * 站点切换播放器/清空容器时会把我们的 `.__parent` / `.__target` 元素一起
 * removeChild 掉，导致 PiP 里/经典窗口里那块区域变空。这里把 removeChild
 * 包一层：命中我们的元素就**暂存**起来（不真的删），退出时再统一释放。
 *
 * 为什么放在这里而不是内容脚本里拼 `document.createElement('script')`：
 *   1. 内联 `<script>` 会被页面的 CSP（script-src 无 unsafe-inline）直接拦掉，
 *      失败还是静默的；
 *   2. 拼字符串的代码既难读也没法被类型检查/压缩覆盖；
 *   3. MV3 的标准做法是 chrome.scripting.executeScript({ world: 'MAIN', func })
 *      —— 后台注入、可传参数、不受页面 CSP 限制（和可见性闸门 gate.ts 一致）。
 */

export function sepWinRemoveGuard(on: boolean): string {
  const doc: any = document as any;
  const proto: any = Element.prototype as any;

  if (on) {
    if (proto.__swRemCh) return 'already';
    proto.__swRemCh = proto.removeChild;
    proto.removeChild = function (this: any, elem: any) {
      try {
        if (elem && elem.classList && (elem.classList.contains('__parent') || elem.classList.contains('__target'))) {
          // 站点把 <video> 的 src 清空后自己删掉：这种放行
          if (elem.hasAttribute('src') && elem.getAttribute('src') === '') {
            return proto.__swRemCh.call(this, elem);
          }
          if (!doc.swRemoval) doc.swRemoval = [];
          if (doc.swRemoval.indexOf(elem) === -1) doc.swRemoval.push(elem);
          return elem;
        }
      } catch (e) { /* 失败就走原生逻辑 */ }
      return proto.__swRemCh.call(this, elem);
    };
    return 'installed';
  }

  if (!proto.__swRemCh) return 'absent';
  proto.removeChild = proto.__swRemCh;
  delete proto.__swRemCh;
  try {
    const list: any[] = doc.swRemoval || [];
    for (let i = 0; i < list.length; i++) {
      const el = list[i];
      if (el && el.parentNode) el.parentNode.removeChild(el);
    }
    delete doc.swRemoval;
  } catch (e) { }
  return 'restored';
}
