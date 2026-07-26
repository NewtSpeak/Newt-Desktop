// 设置 · 我的账号（docs 16 FR-04 / 01 FR-27–28）：
// 账号标识 + 修改密码 + 会话管理 + 删除账号 + 登出。

import { useCallback, useEffect, useState } from "react"
import { useNavigate } from "react-router"
import {
  LogOutIcon,
  MonitorIcon,
  ShieldCheckIcon,
  Trash2Icon,
} from "lucide-react"
import { toast } from "sonner"

import { AvatarWithFrame } from "~/components/cosmetics/avatar-frame"
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { ApiError } from "~/lib/api/http"
import {
  changePassword,
  deleteAccount,
  listSessions,
  revokeOtherSessions,
  revokeSession,
  type LoginSession,
} from "~/lib/api/users"
import {
  nameInitials,
  resolveProfileAssetUrl,
  userDisplayName,
} from "~/lib/user-display"
import {
  LOGOUT_OFFLINE_MESSAGE,
  useAuthStore,
} from "~/stores/auth"
import { useCosmeticsStore } from "~/stores/cosmetics"
import { useSettingsStore } from "~/stores/settings"
import { useUIStore } from "~/stores/ui"
import { GroupLabel, SectionTitle, SettingRow } from "./section"

/** 邮箱脱敏：local part 保留首尾字符，中间打码 */
export function maskEmail(email: string): string {
  const at = email.indexOf("@")
  if (at <= 0) return email
  const local = email.slice(0, at)
  const domain = email.slice(at)
  if (local.length <= 2) return `${local[0]}***${domain}`
  return `${local[0]}***${local[local.length - 1]}${domain}`
}

function platformLabel(session: LoginSession): string {
  const parts = [
    session.device_name?.trim(),
    session.platform?.trim(),
  ].filter(Boolean)
  if (parts.length) return parts.join(" · ")
  if (session.audience === "admin") return "管理后台"
  return "未知设备"
}

function formatTime(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return iso
  return new Date(t).toLocaleString()
}

export function AccountSection() {
  const user = useAuthStore((state) => state.user)
  const navigate = useNavigate()
  // 自己的头像框走本人 loadout（放在 early return 之前，保证 hooks 顺序稳定）
  const avatarFrame = useCosmeticsStore((state) => state.loadout.avatar_frame)

  // 改密
  const [showPassword, setShowPassword] = useState(false)
  const [currentPw, setCurrentPw] = useState("")
  const [newPw, setNewPw] = useState("")
  const [confirmPw, setConfirmPw] = useState("")
  const [pwBusy, setPwBusy] = useState(false)

  // 会话
  const [sessions, setSessions] = useState<LoginSession[] | null>(null)
  const [sessionsError, setSessionsError] = useState(false)
  const [sessionBusy, setSessionBusy] = useState(false)

  // 删号
  const [showDelete, setShowDelete] = useState(false)
  const [deletePw, setDeletePw] = useState("")
  const [deleteBusy, setDeleteBusy] = useState(false)

  const refreshSessions = useCallback(() => {
    setSessionsError(false)
    listSessions()
      .then(setSessions)
      .catch(() => {
        setSessionsError(true)
        setSessions(null)
      })
  }, [])

  useEffect(() => {
    refreshSessions()
  }, [refreshSessions])

  if (!user) return null

  const display = userDisplayName(user)
  const avatarSrc = resolveProfileAssetUrl(user.avatar_url)

  const gatewayStatus = useUIStore((s) => s.gatewayStatus)
  const canLogout = gatewayStatus === "connected"

  const handleLogout = async () => {
    if (!canLogout) {
      toast.error(LOGOUT_OFFLINE_MESSAGE)
      return
    }
    try {
      useSettingsStore.getState().closePanel()
      await useAuthStore.getState().logout()
      navigate("/", { replace: true })
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : LOGOUT_OFFLINE_MESSAGE,
      )
    }
  }

  const submitPassword = async () => {
    if (newPw.length < 8) {
      toast.error("新密码至少 8 位")
      return
    }
    if (newPw !== confirmPw) {
      toast.error("两次输入的新密码不一致")
      return
    }
    setPwBusy(true)
    try {
      await changePassword(currentPw, newPw)
      toast.success("密码已更新；其他设备的登录已失效")
      setCurrentPw("")
      setNewPw("")
      setConfirmPw("")
      setShowPassword(false)
      refreshSessions()
    } catch (error) {
      toast.error(
        error instanceof ApiError
          ? error.code === "INVALID_PASSWORD"
            ? "当前密码错误"
            : error.message
          : "修改失败",
      )
    } finally {
      setPwBusy(false)
    }
  }

  const onRevokeSession = async (session: LoginSession) => {
    if (session.current) {
      const ok = window.confirm("吊销当前会话将立即退出登录，继续吗？")
      if (!ok) return
      setSessionBusy(true)
      try {
        await revokeSession(session.id)
        await handleLogout()
      } catch {
        toast.error("吊销失败")
        setSessionBusy(false)
      }
      return
    }
    setSessionBusy(true)
    try {
      await revokeSession(session.id)
      toast.success("已吊销该会话")
      refreshSessions()
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "吊销失败")
    } finally {
      setSessionBusy(false)
    }
  }

  const onRevokeOthers = async () => {
    setSessionBusy(true)
    try {
      const { revoked } = await revokeOtherSessions()
      toast.success(
        revoked > 0 ? `已登出 ${revoked} 个其他会话` : "没有其他活跃会话",
      )
      refreshSessions()
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "操作失败")
    } finally {
      setSessionBusy(false)
    }
  }

  const submitDelete = async () => {
    if (!deletePw) {
      toast.error("请输入密码确认")
      return
    }
    const ok = window.confirm(
      "此操作不可恢复：账号将被注销，历史消息作者匿名化。确定继续？",
    )
    if (!ok) return
    setDeleteBusy(true)
    try {
      await deleteAccount(deletePw)
      toast.success("账号已注销")
      useSettingsStore.getState().closePanel()
      await useAuthStore.getState().logout()
      navigate("/", { replace: true })
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.code === "OWNS_GUILDS") {
          toast.error("你仍拥有服务器，请先转让或删除后再注销")
        } else if (error.code === "INVALID_PASSWORD") {
          toast.error("密码错误")
        } else if (error.code === "SYSTEM_ADMIN_UNDELETABLE") {
          toast.error("系统管理员账号不能自助注销")
        } else {
          toast.error(error.message)
        }
      } else {
        toast.error("注销失败")
      }
    } finally {
      setDeleteBusy(false)
    }
  }

  return (
    <div>
      <SectionTitle>我的账号</SectionTitle>

      <GroupLabel id="account-info">账号信息</GroupLabel>
      <div className="flex items-center gap-4 rounded-2xl bg-muted/50 p-4">
        {/* 账号信息卡头像：套上自己已装备的头像框 */}
        <AvatarWithFrame frame={avatarFrame} sizeClass="size-16">
          <Avatar className="size-16 rounded-2xl">
            {avatarSrc && <AvatarImage src={avatarSrc} alt={display} />}
            <AvatarFallback className="rounded-2xl text-lg">
              {nameInitials(display)}
            </AvatarFallback>
          </Avatar>
        </AvatarWithFrame>
        <div className="min-w-0">
          <p className="truncate text-base font-semibold">{display}</p>
          <p className="truncate text-sm text-muted-foreground">@{user.username}</p>
          <p className="truncate text-sm text-muted-foreground">
            {maskEmail(user.email)}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="ml-auto shrink-0"
          onClick={() => useSettingsStore.getState().openPanel("profile")}
        >
          编辑资料
        </Button>
      </div>

      <GroupLabel id="account-manage">账号管理</GroupLabel>

      {/* 修改密码 */}
      <SettingRow label="修改密码" description="更换登录密码；成功后其他设备将下线">
        <Button
          size="sm"
          variant="outline"
          onClick={() => setShowPassword((v) => !v)}
        >
          <ShieldCheckIcon className="size-4" />
          {showPassword ? "收起" : "修改"}
        </Button>
      </SettingRow>
      {showPassword && (
        <div className="mb-4 flex flex-col gap-3 rounded-xl border p-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">当前密码</span>
            <Input
              type="password"
              autoComplete="current-password"
              value={currentPw}
              onChange={(e) => setCurrentPw(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">新密码（≥8 位）</span>
            <Input
              type="password"
              autoComplete="new-password"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">确认新密码</span>
            <Input
              type="password"
              autoComplete="new-password"
              value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)}
            />
          </label>
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              disabled={pwBusy}
              onClick={() => {
                setShowPassword(false)
                setCurrentPw("")
                setNewPw("")
                setConfirmPw("")
              }}
            >
              取消
            </Button>
            <Button
              size="sm"
              disabled={pwBusy || !currentPw || !newPw}
              onClick={() => void submitPassword()}
            >
              {pwBusy ? "提交中…" : "保存新密码"}
            </Button>
          </div>
        </div>
      )}

      {/* 会话 */}
      <SettingRow
        label="已登录设备"
        description="查看并管理各端会话"
      >
        <Button
          size="sm"
          variant="outline"
          disabled={sessionBusy || !sessions?.some((s) => !s.current)}
          onClick={() => void onRevokeOthers()}
        >
          登出其他设备
        </Button>
      </SettingRow>
      {sessionsError && (
        <p className="mb-2 text-xs text-destructive">
          会话列表加载失败
          <button
            type="button"
            className="ml-2 underline"
            onClick={refreshSessions}
          >
            重试
          </button>
        </p>
      )}
      {sessions && sessions.length > 0 && (
        <div className="mb-4 flex flex-col gap-0.5 rounded-xl bg-muted/30 p-1 dark:bg-white/[0.04]">
          {sessions.map((session) => (
            <div
              key={session.id}
              className="flex items-center justify-between gap-3 px-3 py-2.5"
            >
              <div className="flex min-w-0 items-start gap-2">
                <MonitorIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="truncate text-sm">
                    {platformLabel(session)}
                    {session.current && (
                      <span className="ml-1.5 text-[10px] text-emerald-600 dark:text-emerald-400">
                        当前
                      </span>
                    )}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {session.ip_address ? `${session.ip_address} · ` : ""}
                    最近活动 {formatTime(session.last_used_at)}
                  </p>
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="shrink-0 text-destructive"
                disabled={sessionBusy}
                onClick={() => void onRevokeSession(session)}
              >
                {session.current ? "退出" : "吊销"}
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* 删除账号 */}
      <SettingRow
        label="删除账号"
        description="永久注销账号；须先转让或删除所拥有的服务器"
      >
        <Button
          size="sm"
          variant="destructive"
          onClick={() => setShowDelete((v) => !v)}
        >
          <Trash2Icon className="size-4" />
          {showDelete ? "收起" : "删除"}
        </Button>
      </SettingRow>
      {showDelete && (
        <div className="mb-4 flex flex-col gap-3 rounded-xl border border-destructive/40 p-4">
          <p className="text-xs text-muted-foreground">
            注销后历史消息作者将匿名化，此操作不可恢复。请输入当前密码确认。
          </p>
          <Input
            type="password"
            placeholder="当前密码"
            autoComplete="current-password"
            value={deletePw}
            onChange={(e) => setDeletePw(e.target.value)}
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="destructive"
              disabled={deleteBusy || !deletePw}
              onClick={() => void submitDelete()}
            >
              {deleteBusy ? "注销中…" : "确认删除账号"}
            </Button>
          </div>
        </div>
      )}

      <GroupLabel id="account-session">会话</GroupLabel>
      <SettingRow
        label="退出当前账号"
        description={
          canLogout
            ? "吊销当前账号会话；若仍有其他已登录账号将自动切换，否则返回欢迎界面"
            : LOGOUT_OFFLINE_MESSAGE
        }
      >
        <Button
          variant="destructive"
          size="sm"
          disabled={!canLogout}
          title={!canLogout ? LOGOUT_OFFLINE_MESSAGE : undefined}
          onClick={() => void handleLogout()}
        >
          <LogOutIcon />
          退出当前账号
        </Button>
      </SettingRow>
    </div>
  )
}
