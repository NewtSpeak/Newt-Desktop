import type { Config } from "@react-router/dev/config"

export default {
  // Tauri 加载静态资源，使用 SPA 模式
  ssr: false,
} satisfies Config
