import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
} from "react-router"

import { useEffect } from "react"

import type { Route } from "./+types/root"
import "./app.css"
import { TitlebarControls } from "~/components/titlebar-controls"
import { TooltipProvider } from "~/components/ui/tooltip"
import { useDeepLinkNavigation } from "~/hooks/use-deep-link"
import { initAppearance } from "~/stores/settings"

// react-grab 仅在开发模式的浏览器环境加载
if (import.meta.env.DEV && typeof document !== "undefined") {
  import("react-grab")
}

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        <TooltipProvider>{children}</TooltipProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  )
}

export default function App() {
  // 外观设置（主题 / 字体大小）挂载即生效，覆盖登录页等全部路由
  useEffect(() => {
    initAppearance()
  }, [])
  // Tauri：owlspeak://oauth/* 深链 → 授权页
  useDeepLinkNavigation()
  return (
    <>
      <Outlet />
      {/* 右上角悬浮：主题切换 + 通知 + 好友（含未读）+（Windows/Linux）窗口三键 */}
      <TitlebarControls />
    </>
  )
}

export function HydrateFallback() {
  return (
    <main
      style={{
        display: "flex",
        height: "100vh",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        gap: 12,
        background: "#0b0b0f",
        color: "#e8e8ed",
        fontFamily: '"MiSans VF", "MiSans", system-ui, sans-serif',
      }}
    >
      <div
        style={{
          width: 28,
          height: 28,
          border: "3px solid #3f3f46",
          borderTopColor: "#a1a1aa",
          borderRadius: "50%",
          animation: "owl-spin 0.8s linear infinite",
        }}
      />
      <p style={{ fontSize: 14, opacity: 0.85 }}>正在加载 NewtSpeak…</p>
      <style>{`@keyframes owl-spin { to { transform: rotate(360deg) } }`}</style>
    </main>
  )
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Oops!"
  let details = "An unexpected error occurred."
  let stack: string | undefined

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error"
    details =
      error.status === 404
        ? "The requested page could not be found."
        : error.statusText || details
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message
    stack = error.stack
  }

  return (
    <main className="container mx-auto p-4 pt-16">
      <h1>{message}</h1>
      <p>{details}</p>
      {stack && (
        <pre className="w-full overflow-x-auto p-4">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  )
}
