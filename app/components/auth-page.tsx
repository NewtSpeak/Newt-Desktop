// 登录/注册页外框：居中卡片 + 顶部窗口拖拽留白。

import { dragWindowOnMouseDown, dragWindowOnSelfMouseDown } from "~/lib/window-drag"

export function AuthPage({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex h-svh flex-col overflow-hidden bg-background"
      onMouseDown={dragWindowOnSelfMouseDown}
    >
      {/* 顶部可拖拽空白（对齐应用壳的 --app-top-inset 32px） */}
      <div className="h-8 shrink-0" onMouseDown={dragWindowOnMouseDown} />
      <div
        className="flex flex-1 items-center justify-center p-6"
        onMouseDown={dragWindowOnSelfMouseDown}
      >
        {children}
      </div>
    </div>
  )
}
