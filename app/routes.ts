import { type RouteConfig, index, layout, route } from "@react-router/dev/routes"

export default [
  route("login", "routes/login.tsx"),
  route("register", "routes/register.tsx"),
  // 受保护的应用壳：未登录跳 /login
  layout("routes/app-shell.tsx", [
    index("routes/home.tsx"),
    route("channels/:guildId/:channelId", "routes/channel.tsx"),
  ]),
] satisfies RouteConfig
