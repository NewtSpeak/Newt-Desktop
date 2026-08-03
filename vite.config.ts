import { EventEmitter } from "node:events"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { reactRouter } from "@react-router/dev/vite"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig, type Plugin } from "vite"

const rootDir = path.dirname(fileURLToPath(import.meta.url))
const srcTauriDir = path.resolve(rootDir, "src-tauri")

// Windows + 非 ASCII 路径下，chokidar 的 src-tauri glob 有时匹配失败，
// 仍会 watch 到 Cargo 锁定的 app_lib.dll，触发 EBUSY 把 tauri dev 干崩。
// 用 path.relative 做目录归属判断，比 glob 稳。
function isInsideSrcTauri(filePath: string): boolean {
  const abs = path.resolve(filePath)
  const rel = path.relative(srcTauriDir, abs)
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))
}

/**
 * React Router 会再 createServer 一个 child compiler，并 **整段覆盖** server 配置：
 *   server: { watch: command==="build" ? null : undefined, hmr: false, ... }
 * 主配置里的 server.watch.ignored 对 child 无效；child 仍会 chokidar 扫到
 * src-tauri/target 里 Cargo 正在锁的 dll，EBUSY 直接把 Node 进程打崩，
 * 表现就是 `bun run tauri dev` 的 beforeDevCommand 退出。
 *
 * 在加载 vite 配置时给 fs.watch 打补丁：对 src-tauri 产物路径直接返回空 watcher，
 * 其它路径的 EBUSY/EPERM 也吞掉，主 server 与 child compiler 都生效。
 */
function installFsWatchGuard(): void {
  const original = fs.watch
  if ((original as typeof original & { __newtspeakPatched?: boolean }).__newtspeakPatched) {
    return
  }

  const isBenignWatchError = (err: unknown): boolean => {
    const code = (err as NodeJS.ErrnoException | undefined)?.code
    return code === "EBUSY" || code === "EPERM" || code === "EACCES"
  }

  const makeNoopWatcher = (): fs.FSWatcher => {
    const noop = new EventEmitter() as fs.FSWatcher
    noop.close = () => {
      noop.emit("close")
      return noop
    }
    noop.ref = () => noop
    noop.unref = () => noop
    return noop
  }

  const patched = ((
    filename: fs.PathLike,
    options?: fs.WatchOptions | string | ((e: string, f: string | null) => void),
    listener?: (e: string, f: string | null) => void,
  ): fs.FSWatcher => {
    const filePath = filename.toString()
    if (isInsideSrcTauri(filePath)) {
      return makeNoopWatcher()
    }
    try {
      const watcher =
        typeof options === "function"
          ? original(filename, options)
          : listener
            ? original(filename, options as fs.WatchOptions | string, listener)
            : original(filename, options as fs.WatchOptions | string | undefined)
      watcher.on("error", (err) => {
        if (isBenignWatchError(err)) return
        if (watcher.listenerCount("error") <= 1) {
          console.warn("[vite-watch-guard]", err)
        }
      })
      return watcher
    } catch (err) {
      if (isBenignWatchError(err)) return makeNoopWatcher()
      throw err
    }
  }) as typeof fs.watch & { __newtspeakPatched?: boolean }

  patched.__newtspeakPatched = true
  fs.watch = patched
}

installFsWatchGuard()

/** 主 dev server：主动 unwatch src-tauri，并兜底吞掉 watcher EBUSY */
function tauriWatchGuardPlugin(): Plugin {
  return {
    name: "newtspeak:tauri-watch-guard",
    configureServer(server) {
      server.watcher.unwatch(srcTauriDir)
      server.watcher.unwatch(path.join(srcTauriDir, "**"))
      server.watcher.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EBUSY" || err.code === "EPERM" || err.code === "EACCES") return
        console.warn("[vite-watch-guard]", err)
      })
    },
  }
}

/**
 * Chrome/Chromium DevTools 会自动探测
 * `/.well-known/appspecific/com.chrome.devtools.json`。
 * React Router 框架模式没有匹配路由时会抛
 * “No route matches URL”，把 dev 控制台刷红。
 * 在进入 RR 处理器之前直接 204 短路。
 */
function chromeDevtoolsJsonPlugin(): Plugin {
  return {
    name: "newtspeak:chrome-devtools-json",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = (req.url ?? "").split("?")[0] ?? ""
        if (pathname === "/.well-known/appspecific/com.chrome.devtools.json") {
          res.statusCode = 204
          res.end()
          return
        }
        next()
      })
    },
  }
}

/** 强制走 ESM 产物，避免 main→index.js(CJS) 触发 default 互操作错误 */
const dtlnWebEsm = path.resolve(
  rootDir,
  "node_modules/@sapphi-red/dtln-web/dist/index.mjs",
)

/**
 * 显式预构建清单。配合 optimizeDeps.noDiscovery=true，禁止运行时再发现新依赖并
 * 改写 browserHash——那是 504 Outdated Optimize Dep 的根因。
 * 若新增 npm 依赖被 app 直接 import，请同步加进此列表。
 */
const OPTIMIZE_INCLUDE = [
  // React 核心（必须固定，否则 hash 一变全站 504）
  "react",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "react-dom",
  "react-dom/client",
  "react-router",
  "react-router/dom",
  // UI / 工具
  "@base-ui/react/avatar",
  "@base-ui/react/button",
  "@base-ui/react/checkbox",
  "@base-ui/react/context-menu",
  "@base-ui/react/dialog",
  "@base-ui/react/drawer",
  "@base-ui/react/input",
  "@base-ui/react/menu",
  "@base-ui/react/merge-props",
  "@base-ui/react/popover",
  "@base-ui/react/radio",
  "@base-ui/react/radio-group",
  "@base-ui/react/select",
  "@base-ui/react/separator",
  "@base-ui/react/slider",
  "@base-ui/react/switch",
  "@base-ui/react/tabs",
  "@base-ui/react/toggle",
  "@base-ui/react/toggle-group",
  "@base-ui/react/tooltip",
  "@base-ui/react/use-render",
  "@dnd-kit/core",
  "@dnd-kit/sortable",
  "@dnd-kit/utilities",
  "@tauri-apps/api/core",
  "@tauri-apps/api/window",
  "@tauri-apps/plugin-notification",
  "class-variance-authority",
  "clsx",
  "cmdk",
  // DTLN 的 ESM 产物默认导入此 CommonJS 包；Safari 不能从 Vite 的按需
  // export-star 代理解析 default，必须在启动时完成 CJS→ESM 预构建。
  "fft.js",
  "lucide-react",
  "next-themes",
  "react-grab",
  "recharts",
  "sonner",
  "tailwind-merge",
  // CJS-only：recharts / @base-ui 会 import named export；
  // 不预构建时 WebKit 报 "Importing binding name 'useSyncExternalStoreWithSelector' is not found"
  "use-sync-external-store",
  "use-sync-external-store/shim",
  "use-sync-external-store/shim/with-selector",
  "use-sync-external-store/with-selector",
  "zustand",
  "zustand/middleware",
  // TipTap（composer 富文本）
  // 注意：@tiptap/pm 是子路径聚合包，无 "." 导出，不能整包 include
  "@tiptap/core",
  "@tiptap/react",
  "@tiptap/starter-kit",
  "@tiptap/extension-link",
  "@tiptap/extension-placeholder",
  "marked",
]

export default defineConfig({
  // Tauri 会自己清屏打印 Rust 编译日志；关掉 Vite 清屏避免两边抢输出
  clearScreen: false,
  resolve: {
    tsconfigPaths: true,
    alias: {
      // package.json 无 exports 字段时 Vite 可能落到 CJS main，导致：
      // "Importing binding name 'default' cannot be resolved by star export entries"
      "@sapphi-red/dtln-web": dtlnWebEsm,
    },
  },
  plugins: [
    tauriWatchGuardPlugin(),
    chromeDevtoolsJsonPlugin(),
    tailwindcss(),
    reactRouter(),
  ],
  optimizeDeps: {
    // 禁止运行时依赖发现 → 禁止中途改 browserHash → 消除 504 Outdated Optimize Dep
    noDiscovery: true,
    include: OPTIMIZE_INCLUDE,
    // dtln-web ≈1.3MB 内嵌 tfjs：动态 import + alias 即可，绝不要预构建
    exclude: ["@sapphi-red/dtln-web"],
  },
  // 固定端口，避免与其他项目的 dev server 冲突（Tauri devUrl 指向此端口）
  server: {
    // 同时支持 127.0.0.1 与 localhost（::1），避免只绑一边导致连不上/旧缓存
    // host:true → 0.0.0.0，供 Android 真机通过局域网 IP 访问
    host: true,
    port: 1420,
    strictPort: true,
    // Android 热更：HMR 客户端需连到手机可达的本机 IP（android-dev.mjs 设置）
    // 未设置时保持 Vite 默认（桌面 dev 不受影响）
    ...(process.env.TAURI_DEV_HOST || process.env.VITE_DEV_HOST
      ? {
          hmr: {
            protocol: "ws",
            host: process.env.TAURI_DEV_HOST || process.env.VITE_DEV_HOST,
            port: 1420,
          },
        }
      : {}),
    // 热重载必须开 watch；只把 src-tauri 整棵树排除（尤其是 target/*.dll）
    watch: {
      ignored: [
        "**/src-tauri/**",
        (filePath: string) => isInsideSrcTauri(filePath),
      ],
    },
    // 服务端 CORS 只放行 localhost:5173，dev 下把 /gapi 代理到本地 Newt-Server；
    // ws: true 让 Gateway WebSocket（/gapi/v1/gateway）也走同一代理。
    proxy: {
      "/gapi": {
        target: "http://127.0.0.1:8080",
        changeOrigin: true,
        ws: true,
      },
    },
  },
})
