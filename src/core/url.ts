/**
 * URL 归一化，后台、弹窗和内容脚本共用。
 *
 * 遗留实现用 `String(url.match(re))` 当站点键，已经装过的用户存档就是这个形状。
 * 这里保持完全一致，不要"顺手修"成普通 origin —— 否则老记录读不出来，还需要迁移。
 */
const SITE_RE = /^(https?:\/\/)?([\da-z|0-9.-]+)\.([a-z|0-9.]{2,6})/gi;

export function normUrl(url: string): string {
  const match = String(url || '').match(SITE_RE);
  return match ? String(match) : String(url || '');
}

export function isHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url || '');
}
