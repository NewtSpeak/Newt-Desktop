// OAuth scope 预设：从「请求集合」中选出子集，供授权页一键应用。

export type ScopePresetId = "minimum" | "recommended" | "all"

const IDENTITY = ["openid", "profile", "offline_access"] as const

/** gapi 从窄到宽的偏好顺序（最小权限优先更窄的） */
const GAPI_NARROW_FIRST = ["gapi.read", "gapi.guilds.manage", "gapi.full"] as const

export function splitScopes(scope: string): string[] {
  return scope.split(/\s+/).filter(Boolean)
}

export function joinScopes(ids: string[]): string {
  return ids.join(" ")
}

/**
 * 最小权限：身份三件套（若在请求中）+ 最窄的 gapi.*（若有）。
 * 不含 platform.*。
 * 若请求中无任何 gapi/身份，则回退为全部非 platform 项中的第一项，避免空集。
 */
export function pickMinimumScopes(requested: string[]): string[] {
  const set = new Set(requested)
  const out: string[] = []
  for (const id of IDENTITY) {
    if (set.has(id)) out.push(id)
  }
  for (const id of GAPI_NARROW_FIRST) {
    if (set.has(id)) {
      out.push(id)
      break
    }
  }
  if (out.length === 0) {
    const safe = requested.filter((id) => !id.startsWith("platform."))
    if (safe[0]) out.push(safe[0])
    else if (requested[0]) out.push(requested[0])
  }
  return out
}

/** 推荐：全部非 platform 请求项 */
export function pickRecommendedScopes(requested: string[]): string[] {
  return requested.filter((id) => !id.startsWith("platform."))
}

/** 全部申请：原样（含 platform） */
export function pickAllScopes(requested: string[]): string[] {
  return [...requested]
}

export function applyScopePreset(
  requestedScope: string,
  preset: ScopePresetId,
): string {
  const requested = splitScopes(requestedScope)
  switch (preset) {
    case "minimum":
      return joinScopes(pickMinimumScopes(requested))
    case "recommended":
      return joinScopes(pickRecommendedScopes(requested))
    case "all":
      return joinScopes(pickAllScopes(requested))
    default:
      return joinScopes(pickRecommendedScopes(requested))
  }
}

/** 由勾选 map 生成 scope 串 */
export function selectionToScope(
  items: string[],
  selected: Record<string, boolean>,
): string {
  return items.filter((id) => selected[id]).join(" ")
}

/** 由预设生成勾选 map */
export function selectionFromPreset(
  items: string[],
  preset: ScopePresetId,
): Record<string, boolean> {
  const chosen = new Set(splitScopes(applyScopePreset(items.join(" "), preset)))
  const next: Record<string, boolean> = {}
  for (const id of items) next[id] = chosen.has(id)
  return next
}

/** 默认初始勾选：非 platform 全开，platform 关（同 recommended） */
export function defaultSelection(
  items: { id: string; danger: boolean }[],
  defaultEnablePlatform = false,
): Record<string, boolean> {
  const next: Record<string, boolean> = {}
  for (const s of items) {
    next[s.id] = s.danger ? defaultEnablePlatform : true
  }
  return next
}
