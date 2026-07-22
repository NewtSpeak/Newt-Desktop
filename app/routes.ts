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
    // 好友页别名：主入口为 /?tab=friends（index）；此处兼容旧链接并 replace 过去
    route("friends", "routes/friends.tsx"),
    // 贴图库别名：主入口为 /?tab=stickers（index）
    route("stickers", "routes/stickers.tsx"),
    route("channels/:guildId/:channelId", "routes/channel.tsx"),
    // 服务器管理员操作面板（语音静音/禁听/踢出、成员踢封、封禁列表）
    route("guilds/:guildId/moderation", "routes/moderation.tsx"),
  ]),
] satisfies RouteConfig
