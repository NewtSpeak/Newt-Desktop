import path from "node:path"
import { fileURLToPath } from "node:url"
import { reactRouter } from "@react-router/dev/vite"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "vite"

const rootDir = path.dirname(fileURLToPath(import.meta.url))
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
  resolve: {
    tsconfigPaths: true,
    alias: {
      // package.json 无 exports 字段时 Vite 可能落到 CJS main，导致：
      // "Importing binding name 'default' cannot be resolved by star export entries"
      "@sapphi-red/dtln-web": dtlnWebEsm,
    },
  },
  plugins: [tailwindcss(), reactRouter()],
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
    host: true,
    port: 1420,
    strictPort: true,
    // 服务端 CORS 只放行 localhost:5173，dev 下把 /gapi 代理到本地 Owl-Server；
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
