/** 左右侧栏（频道列表 / 成员栏）可拖拽宽度常量与钳制 */

export const PANEL_WIDTH_DEFAULT = 240
export const PANEL_WIDTH_MIN = 180
export const PANEL_WIDTH_MAX = 480

export function clampPanelWidth(width: number): number {
  if (!Number.isFinite(width)) return PANEL_WIDTH_DEFAULT
  return Math.round(
    Math.min(PANEL_WIDTH_MAX, Math.max(PANEL_WIDTH_MIN, width)),
  )
}
