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
  return (
    <>
      <Outlet />
      {/* 右上角悬浮：主题切换 + 私信占位 +（Windows/Linux）窗口三键，覆盖全部路由 */}
      <TitlebarControls />
    </>
  )
}

export function HydrateFallback() {
  return (
    <main className="flex h-svh items-center justify-center bg-background">
      <p className="text-sm text-muted-foreground">正在加载 OwlSpeak…</p>
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
