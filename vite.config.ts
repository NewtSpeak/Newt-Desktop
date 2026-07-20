import { reactRouter } from "@react-router/dev/vite"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "vite"

export default defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [tailwindcss(), reactRouter()],
  // 提前预构建这些运行时才被发现的依赖，避免 dev 中途触发
  // “optimized dependencies changed” 强制刷新以及 504 (Outdated Optimize Dep)。
  optimizeDeps: {
    include: [
      "@base-ui/react/avatar",
      "@base-ui/react/button",
      "@base-ui/react/dialog",
      "@base-ui/react/input",
      "@base-ui/react/menu",
      "@base-ui/react/merge-props",
      "@base-ui/react/radio-group",
      "@base-ui/react/radio",
      "@base-ui/react/select",
      "@base-ui/react/separator",
      "@base-ui/react/slider",
      "@base-ui/react/switch",
      "@base-ui/react/tabs",
      "@base-ui/react/tooltip",
      "@base-ui/react/use-render",
      "@tauri-apps/api/core",
      "@tauri-apps/api/window",
      "class-variance-authority",
      "clsx",
      "cmdk",
      "lucide-react",
      "next-themes",
      "react-grab",
      "sonner",
      "tailwind-merge",
      "zustand",
      "zustand/middleware",
    ],
  },
  // 固定端口，避免与其他项目的 dev server 冲突（Tauri devUrl 指向此端口）
  server: {
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
