import {
  type RouteConfig,
  index,
  layout,
  route,
} from "@react-router/dev/routes"

export default [
  // 应用壳：未登录时渲染欢迎空态（页内添加服务器 / 登录注册），不再有独立登录页路由
  layout("routes/app-shell.tsx", [
    index("routes/home.tsx"),
    route("channels/:guildId/:channelId", "routes/channel.tsx"),
  ]),
] satisfies RouteConfig
