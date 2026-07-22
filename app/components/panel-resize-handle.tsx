// 侧栏宽度拖拽手柄：贴在面板左/右缘，拖动时实时回调新宽度。
// 使用 pointer capture，避免拖出元素后丢失事件；与窗口拖拽互斥（data-panel-resize）。

import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from "react"

import {
  PANEL_WIDTH_MAX,
  PANEL_WIDTH_MIN,
} from "~/lib/panel-width"
import { cn } from "~/lib/utils"

export {
  clampPanelWidth,
  PANEL_WIDTH_DEFAULT,
  PANEL_WIDTH_MAX,
  PANEL_WIDTH_MIN,
} from "~/lib/panel-width"

/**
 * @param edge `end` = 贴右缘（左侧频道栏）：向右拖变宽
 *             `start` = 贴左缘（右侧成员栏）：向左拖变宽
 */
export function PanelResizeHandle({
  edge,
  width,
  onWidthChange,
  min = PANEL_WIDTH_MIN,
  max = PANEL_WIDTH_MAX,
  className,
  label = "调整面板宽度",
}: {
  edge: "start" | "end"
  width: number
  onWidthChange: (next: number) => void
  min?: number
  max?: number
  className?: string
  label?: string
}) {
  const dragging = useRef(false)
  const startX = useRef(0)
  const startW = useRef(0)

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      dragging.current = true
      startX.current = event.clientX
      startW.current = width
      event.currentTarget.setPointerCapture(event.pointerId)
      document.body.style.cursor = "col-resize"
      document.body.style.userSelect = "none"
    },
    [width],
  )

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragging.current) return
      const dx = event.clientX - startX.current
      // 右缘：向右 +；左缘：向左 +（dx 取反）
      const raw = edge === "end" ? startW.current + dx : startW.current - dx
      const next = Math.round(Math.min(max, Math.max(min, raw)))
      if (next !== width) onWidthChange(next)
    },
    [edge, max, min, onWidthChange, width],
  )

  const endDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return
    dragging.current = false
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      /* already released */
    }
    document.body.style.cursor = ""
    document.body.style.userSelect = ""
  }, [])

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      data-panel-resize=""
      tabIndex={0}
      className={cn(
        "absolute top-0 bottom-0 z-30 w-1.5 touch-none",
        "cursor-col-resize",
        // 可点区域略宽，命中更轻松；视觉条居中
        "flex items-stretch justify-center",
        edge === "end" ? "right-0 translate-x-1/2" : "left-0 -translate-x-1/2",
        "group/resize",
        className,
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 24 : 8
        if (event.key === "ArrowLeft") {
          event.preventDefault()
          const delta = edge === "end" ? -step : step
          onWidthChange(
            Math.round(Math.min(max, Math.max(min, width + delta))),
          )
        } else if (event.key === "ArrowRight") {
          event.preventDefault()
          const delta = edge === "end" ? step : -step
          onWidthChange(
            Math.round(Math.min(max, Math.max(min, width + delta))),
          )
        } else if (event.key === "Home") {
          event.preventDefault()
          onWidthChange(min)
        } else if (event.key === "End") {
          event.preventDefault()
          onWidthChange(max)
        }
      }}
    >
      {/* 视觉条始终透明，避免频道/成员列表旁出现竖线；仅保留可拖拽热区与光标 */}
      <span
        aria-hidden
        className="my-2 w-0.5 rounded-full bg-transparent"
      />
    </div>
  )
}
