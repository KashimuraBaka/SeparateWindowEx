/**
 * 很小的注册表，作用是让六个内容脚本不必互相 import。
 *
 * 这六个模块之间的依赖几乎是全连通的双向图（10 对互相引用：
 * common <-> elements <-> icon <-> newWindow <-> mainApp <-> communication），
 * 用 ES module import 写不出来 —— 求值顺序会让一半模块还没初始化就被读，顶层对象
 * 字面量一取邻居就抛错。
 *
 * 所以每个模块注册自己定义的东西，真正要用的时候再按名字取。这个行为和旧的全局脚本
 * 模型一致（全局名本来就是调用时才解析），但依赖图变成无环。
 */
const registry = new Map<string, unknown>();

export function register(name: string, value: unknown): void {
  registry.set(name, value);
}

export function use<T = any>(name: string): T {
  if (!registry.has(name)) {
    // 与旧的裸全局引用是同一种失败，只是错误信息更清楚
    throw new ReferenceError('[SepWin] 模块尚未注册：' + name);
  }
  return registry.get(name) as T;
}

export function has(name: string): boolean {
  return registry.has(name);
}

/** 把指定名字挂到 window，供注入脚本和冒烟测试使用。 */
export function expose(names: string[]): void {
  for (const name of names) (window as any)[name] = registry.get(name);
}
