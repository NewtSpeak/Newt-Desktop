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
import { isMobileAppRuntime } from "~/lib/platform"
import { initAppearance } from "~/stores/settings"

// react-grab 仅在开发模式的浏览器环境加载
if (import.meta.env.DEV && typeof document !== "undefined") {
  import("react-grab")
}

/** 站点图标：来自 Newt-assets/logo.png（links + head 双写，避免 SPA 壳漏掉） */
export const links: Route.LinksFunction = () => [
  { rel: "icon", href: "/favicon.ico?v=newt2", sizes: "any" },
  { rel: "icon", type: "image/png", href: "/favicon.png?v=newt2" },
  { rel: "apple-touch-icon", href: "/apple-touch-icon.png?v=newt2" },
]

/** 默认标签页标题（各路由可再覆盖 document.title） */
export function meta(): Route.MetaDescriptors {
  return [
    { title: "NewtSpeak" },
    {
      name: "description",
      content:
        "NewtSpeak — 开源 Discord / KOOK 替代，自托管组队语音与社区协作",
    },
    { name: "application-name", content: "NewtSpeak" },
  ]
}

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <meta charSet="utf-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover"
        />
        <title>NewtSpeak</title>
        <link rel="icon" href="/favicon.ico?v=newt2" sizes="any" />
        <link rel="icon" type="image/png" href="/favicon.png?v=newt2" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png?v=newt2" />
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

  // 移动 App：挂 html.app-mobile-ui（侧栏底色等 App 样式；不再做全局缩放）
  useEffect(() => {
    const root = document.documentElement
    if (isMobileAppRuntime()) {
      root.classList.add("app-mobile-ui")
    } else {
      root.classList.remove("app-mobile-ui")
    }
    return () => root.classList.remove("app-mobile-ui")
  }, [])

  // Tauri：newtspeak://oauth/* 深链 → 授权页
  useDeepLinkNavigation()
  return (
    <>
      <Outlet />
      {/* 右上角：主题/通知/好友；（仅 Windows/Linux 桌面）窗口三键 —— App 端不显示 */}
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
