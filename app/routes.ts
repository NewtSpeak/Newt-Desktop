import {
  type RouteConfig,
  index,
  layout,
  route,
} from "@react-router/dev/routes"

export default [
  // OAuth 授权（CLI / AI）：独立于应用壳，Desktop 与用户 Web 共用
  route("oauth/device", "routes/oauth-device.tsx"),
  route("oauth/authorize", "routes/oauth-authorize.tsx"),
  // 开发/e2e：scope 预设演示（无后端）
  route("oauth/scope-demo", "routes/oauth-scope-demo.tsx"),
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
