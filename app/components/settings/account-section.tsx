// 设置 · 我的账号（docs 16 FR-04 P0）：头像/用户名/邮箱（脱敏）+ 登出；
// 改密码等能力等服务端账号体系补齐，先占位。

import { useNavigate } from "react-router"
import { LogOutIcon } from "lucide-react"

import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar"
import { Button } from "~/components/ui/button"
import { useAuthStore } from "~/stores/auth"
import { useSettingsStore } from "~/stores/settings"
import { ComingSoon, GroupLabel, SectionTitle, SettingRow } from "./section"

/** 邮箱脱敏：local part 保留首尾字符，中间打码 */
export function maskEmail(email: string): string {
  const at = email.indexOf("@")
  if (at <= 0) return email
  const local = email.slice(0, at)
  const domain = email.slice(at)
  if (local.length <= 2) return `${local[0]}***${domain}`
  return `${local[0]}***${local[local.length - 1]}${domain}`
}

export function AccountSection() {
  const user = useAuthStore((state) => state.user)
  const navigate = useNavigate()

  if (!user) return null

  const handleLogout = async () => {
    useSettingsStore.getState().closePanel()
    await useAuthStore.getState().logout()
    // 未登录态由应用壳渲染欢迎空态，回到根路由即可
    navigate("/", { replace: true })
  }

  return (
    <div>
      <SectionTitle>我的账号</SectionTitle>

      {/* 账号信息卡片 */}
      <div className="flex items-center gap-4 rounded-2xl bg-muted/50 p-4">
        <Avatar className="size-16 rounded-2xl">
          {user.avatar_url && (
            <AvatarImage src={user.avatar_url} alt={user.username} />
          )}
          <AvatarFallback className="rounded-2xl text-lg">
            {user.username.trim().slice(0, 2) || "?"}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="truncate text-base font-semibold">{user.username}</p>
          <p className="truncate text-sm text-muted-foreground">
            {maskEmail(user.email)}
          </p>
        </div>
      </div>

      <GroupLabel>账号管理</GroupLabel>
      <SettingRow label="修改密码" description="更换登录密码">
        <ComingSoon />
      </SettingRow>
      <SettingRow label="已登录设备" description="查看并管理各端会话">
        <ComingSoon />
      </SettingRow>
      <SettingRow label="删除账号" description="永久删除账号与全部数据">
        <ComingSoon />
      </SettingRow>

      <GroupLabel>会话</GroupLabel>
      <SettingRow label="退出登录" description="吊销当前会话并返回欢迎界面">
        <Button variant="destructive" size="sm" onClick={handleLogout}>
          <LogOutIcon />
          退出登录
        </Button>
      </SettingRow>
    </div>
  )
}
