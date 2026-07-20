/** 在空白区域按下鼠标时拖拽窗口，交互元素（按钮/链接/菜单等）不受影响 */
export async function dragWindowOnMouseDown(e: React.MouseEvent) {
  if (e.button !== 0) return
  if (!("__TAURI_INTERNALS__" in window)) return
  const target = e.target as HTMLElement
  if (
    target.closest(
      "button, a, input, textarea, select, [role='button'], [role='menuitem'], [contenteditable]",
    )
  ) {
    return
  }
  const { getCurrentWindow } = await import("@tauri-apps/api/window")
  await getCurrentWindow().startDragging()
}

/** 仅当鼠标直接按在挂载元素本身（而非任何子元素）时拖拽窗口 */
export async function dragWindowOnSelfMouseDown(e: React.MouseEvent) {
  if (e.target !== e.currentTarget) return
  await dragWindowOnMouseDown(e)
}
