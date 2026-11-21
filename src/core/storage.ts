/**
 * 站点记录存储：按归一化 URL 保存选中的区域（css）、区域名、图标开关和窗口尺寸，
 * 数据落在 chrome.storage.local。
 *
 * 这是遗留 `Storage` 对象的等价移植，只是把存储区做成注入参数，因此既能在 Node 里单测，
 * 也能被后台、弹窗、内容脚本复用。行为刻意保持一致：每站最多三条、最新的排最后、
 * `BODY` 不记录、尺寸槽位默认是字符串 "{}"。
 */
import { normUrl } from './url';

export type PropName = 'css' | 'name' | 'icon' | 'size';

export interface SiteItems {
  css: string[];
  name: string[];
  icon: boolean[];
  size: string[];
}

export interface StorageArea {
  get(keys?: string | string[] | null, cb?: (items: Record<string, unknown>) => void): void;
  set(items: Record<string, unknown>, cb?: () => void): void;
  remove(keys: string | string[], cb?: () => void): void;
}

export const PROPS: PropName[] = ['css', 'name', 'icon', 'size'];
export const MAX_AREAS = 3;

function emptyItems(): SiteItems {
  return { css: [], name: [], icon: [], size: [] };
}

export function createSiteStore(local: StorageArea) {
  /** 写回一条记录；记录为空时直接删键，和旧实现一致。 */
  function setItems(url: string, items: SiteItems): void {
    if (items.css.length === 0) {
      local.remove(url);
      return;
    }
    const payload: Record<string, unknown> = {};
    payload[url] = items;
    local.set(payload);
  }

  /** 老版本记录没有 icon 字段，读的时候补齐并写回。 */
  function checkItems(url: string, itemsObj: Record<string, SiteItems>): SiteItems {
    const items = itemsObj[url];
    if (!Object.prototype.hasOwnProperty.call(items, 'icon')) {
      items.icon = items.css.map(() => true);
      setItems(url, items);
    }
    return items;
  }

  function getItems(url: string, cb: (items: SiteItems | undefined) => void): void {
    const key = normUrl(url);
    local.get(key, (itemsObj) => {
      if (itemsObj && Object.prototype.hasOwnProperty.call(itemsObj, key)) {
        cb(checkItems(key, itemsObj as Record<string, SiteItems>));
      } else {
        cb(undefined);
      }
    });
  }

  return {
    normUrl,

    // 后台的窗口/弹窗辅助函数还会直接用到这几个内部成员
    prop: PROPS,
    setItems,
    checkItems,

    saveSetting(settings: unknown): void {
      local.set({ settings });
    },

    getSetting(cb: (itemsObj: Record<string, unknown> | undefined) => void): void {
      local.get('settings', (itemsObj) => cb(itemsObj ? itemsObj : undefined));
    },

    getItems,

    getAllSelectors(url: string, cb: (selectors: string[] | undefined) => void): void {
      getItems(url, (items) => cb(items && items.css ? items.css : undefined));
    },

    /** 只返回"显示图标"的那些区域（隐藏的站点图标不参与）。 */
    getShowItems(url: string, cb: (selectors: string[] | undefined) => void): void {
      getItems(url, (items) => {
        const shown = items ? items.css.filter((_s, i) => items.icon[i]) : [];
        cb(shown.length ? shown : undefined);
      });
    },

    getSize(url: string, selector: string, cb: (size: string | undefined) => void): void {
      getItems(url, (items) => {
        if (!items) return cb(undefined);
        const index = items.css.indexOf(selector);
        if (index < 0 || !Object.prototype.hasOwnProperty.call(items, 'size')) return cb(undefined);
        const size = items.size[index];
        cb(size && size !== '{}' ? size : undefined);
      });
    },

    saveProp(url: string, index: number, prop: { name: PropName; value: unknown }): void {
      const key = normUrl(url);
      getItems(url, (items) => {
        const target = items || emptyItems();
        if (!Object.prototype.hasOwnProperty.call(target, prop.name)) {
          (target as unknown as Record<string, unknown[]>)[prop.name] = [];
        }
        (target as unknown as Record<string, unknown[]>)[prop.name][index] = prop.value;
        setItems(key, target);
      });
    },

    /** 追加一条区域记录：同站去重，超过三条时丢最旧的。 */
    addItem(url: string, selector: string, name: string): void {
      if (selector === 'BODY') return;
      const key = normUrl(url);
      local.get(key, (itemObj) => {
        let items = emptyItems();
        const existing = itemObj && Object.prototype.hasOwnProperty.call(itemObj, key)
          ? (itemObj as Record<string, SiteItems>)[key]
          : undefined;
        if (existing) {
          if (existing.css.indexOf(selector) !== -1) return;
          items = existing;
        }
        if (items.css.length >= MAX_AREAS) {
          for (const prop of PROPS) (items[prop] as unknown[]).splice(0, 1);
        }
        items.css.push(selector);
        items.name.push(name);
        items.icon.push(true);
        items.size.push('{}');
        setItems(key, items);
      });
    },

    delItem(url: string, index: number, cb?: () => void): void {
      const key = normUrl(url);
      getItems(url, (items) => {
        if (items) {
          for (const prop of PROPS) {
            if (Object.prototype.hasOwnProperty.call(items, prop)) (items[prop] as unknown[]).splice(index, 1);
          }
          setItems(key, items);
        }
        if (cb) cb();
      });
    },

    getItem(url: string, index: number, cb: (item: { selector: string; name: string }) => void): void {
      getItems(url, (items) => {
        cb({
          selector: items ? items.css[index] : undefined,
          name: items ? items.name[index] : undefined,
        } as { selector: string; name: string });
      });
    },
  };
}

export type SiteStore = ReturnType<typeof createSiteStore>;
