/**
 * 用服务端快照更新列表，同时复用内容未变化的旧对象。
 *
 * Zustand selector 默认使用 Object.is；整表刷新若无条件替换对象，会让所有订阅
 * 单项的组件一起重渲染。这里既保留未变化的单项引用，也在列表内容和顺序完全一致时
 * 保留数组引用。
 */
export function reconcileList<T>(
  previous: T[] | undefined,
  incoming: T[],
  keyOf: (item: T) => string,
  isEqual: (previousItem: T, incomingItem: T) => boolean
): T[] {
  if (!previous) return incoming

  const previousByKey = new Map(
    previous.map((item) => [keyOf(item), item] as const)
  )
  let changed = previous.length !== incoming.length
  const next = incoming.map((item, index) => {
    const existing = previousByKey.get(keyOf(item))
    const reconciled = existing && isEqual(existing, item) ? existing : item
    if (reconciled !== previous[index]) changed = true
    return reconciled
  })

  return changed ? next : previous
}
