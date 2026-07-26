// 切换账号模态框：列出已登录账号、切换、退出某一账号、通过邀请链接添加新账号。

import * as React from "react"
import { useNavigate } from "react-router"
import {
  CheckIcon,
  LogOutIcon,
  PlusIcon,
  ServerIcon,
  UsersIcon,
} from "lucide-react"
import { toast } from "sonner"

import {
  notifySavedCredentialsChanged,
  SavedCredentialsPanel,
} from "~/components/saved-credentials-panel"
import { AvatarWithFrame } from "~/components/cosmetics/avatar-frame"
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar"
import { Button } from "~/components/ui/button"
import { Checkbox } from "~/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { ApiError } from "~/lib/api/http"
import {
  precheckGuildInvite,
  precheckRegistrationInvite,
} from "~/lib/api/invite"
import {
  upsertSavedCredential,
  type SavedCredential,
} from "~/lib/saved-credentials"
import {
  looksLikeBareInviteCode,
  parseInviteLink,
  setRuntimeServerBaseUrl,
} from "~/lib/server-connection"
import {
  nameInitials,
  resolveProfileAssetUrl,
  userDisplayName,
} from "~/lib/user-display"
import { cn } from "~/lib/utils"
import {
  LOGOUT_OFFLINE_MESSAGE,
  useAuthStore,
  type AccountSummary,
} from "~/stores/auth"
import { useCosmeticsStore } from "~/stores/cosmetics"
import { useUIStore } from "~/stores/ui"

type Step = "list" | "invite" | "login" | "signup"

function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host
  } catch {
    return baseUrl
  }
}

function loginErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return "登录失败，请稍后再试"
  switch (error.code) {
    case "INVALID_CREDENTIALS":
      return "账号或密码错误"
    case "LOGIN_RATE_LIMITED":
      return "尝试过于频繁，请稍后再试"
    case "NETWORK_ERROR":
      return "无法连接服务器，请检查网络"
    default:
      return error.message || "登录失败，请稍后再试"
  }
}

function signupErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return "注册失败，请稍后再试"
  switch (error.code) {
    case "INVITE_INVALID":
      return "邀请无效或已失效"
    case "INVITE_EXPIRED":
      return "邀请已过期"
    case "SIGNUP_DISABLED":
      return "该服务器暂未开放注册"
    case "ACCOUNT_EXISTS":
      return "用户名或邮箱已被使用"
    case "NETWORK_ERROR":
      return "无法连接服务器，请检查网络"
    default:
      return error.message || "注册失败，请稍后再试"
  }
}

export function SwitchAccountDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const navigate = useNavigate()
  const accounts = useAuthStore((s) => s.accounts)
  const activeAccountId = useAuthStore((s) => s.activeAccountId)
  const gatewayStatus = useUIStore((s) => s.gatewayStatus)
  const canLogoutActive = gatewayStatus === "connected"
  // 头像框：cosmetics store 只有当前激活账号的 loadout，其余账号无数据不套框
  const activeAvatarFrame = useCosmeticsStore((s) => s.loadout.avatar_frame)

  const [step, setStep] = React.useState<Step>("list")
  const [busyId, setBusyId] = React.useState<string | null>(null)

  // 添加账号流程状态
  const [inviteLink, setInviteLink] = React.useState("")
  const [serverBaseUrl, setServerBaseUrl] = React.useState("")
  const [serverName, setServerName] = React.useState("")
  const [inviteKind, setInviteKind] = React.useState<
    "registration" | "guild" | null
  >(null)
  const [inviteCode, setInviteCode] = React.useState("")
  const [guildName, setGuildName] = React.useState("")
  const [formError, setFormError] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)

  // 登录/注册表单
  const [identifier, setIdentifier] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [username, setUsername] = React.useState("")
  const [email, setEmail] = React.useState("")
  const [confirm, setConfirm] = React.useState("")
  const [remember, setRemember] = React.useState(true)
  const [selectedCredId, setSelectedCredId] = React.useState<string | null>(
    null,
  )

  const resetAddFlow = () => {
    setStep("list")
    setInviteLink("")
    setServerBaseUrl("")
    setServerName("")
    setInviteKind(null)
    setInviteCode("")
    setGuildName("")
    setFormError(null)
    setSubmitting(false)
    setIdentifier("")
    setPassword("")
    setUsername("")
    setEmail("")
    setConfirm("")
    setRemember(true)
    setSelectedCredId(null)
  }

  /** 点击已记住账号：一键以该凭据添加/登录（含服务器上下文已在邀请流程设好） */
  const applyCredential = async (cred: SavedCredential) => {
    setIdentifier(cred.identifier)
    setPassword(cred.password)
    setSelectedCredId(cred.id)
    setRemember(true)
    setFormError(null)
    if (submitting) return
    setSubmitting(true)
    setRuntimeServerBaseUrl(serverBaseUrl || cred.serverBaseUrl)
    const { persistServerConnection } = await import("~/lib/server-connection")
    persistServerConnection(serverName || cred.serverName)
    try {
      await useAuthStore
        .getState()
        .addAccountLogin(cred.identifier, cred.password)
      if (remember) {
        await upsertSavedCredential({
          serverBaseUrl: serverBaseUrl || cred.serverBaseUrl,
          serverName: serverName || cred.serverName,
          identifier: cred.identifier,
          password: cred.password,
          id: cred.id,
        }).catch(() => undefined)
        notifySavedCredentialsChanged()
      }
      navigate("/", { replace: true })
      onOpenChange(false)
      toast.success("账号已添加")
    } catch (caught) {
      setFormError(loginErrorMessage(caught))
    } finally {
      setSubmitting(false)
    }
  }

  React.useEffect(() => {
    if (!open) {
      // 取消添加流程时恢复当前激活账号的服务器基址，避免后续请求打到半成品目标
      const state = useAuthStore.getState()
      const active = state.accounts.find((a) => a.id === state.activeAccountId)
      if (active) {
        void import("~/lib/server-connection").then((m) =>
          m.applyAccountServer(active.serverBaseUrl, active.serverName),
        )
      }
      resetAddFlow()
    }
  }, [open])

  const handleSwitch = async (accountId: string) => {
    if (accountId === activeAccountId) {
      onOpenChange(false)
      return
    }
    setBusyId(accountId)
    try {
      await useAuthStore.getState().switchAccount(accountId)
      navigate("/", { replace: true })
      onOpenChange(false)
      toast.success("已切换账号")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "切换失败")
    } finally {
      setBusyId(null)
    }
  }

  const handleRemove = async (account: AccountSummary) => {
    // 当前激活账号且 Gateway 未连接：直接拦截
    if (account.id === activeAccountId && !canLogoutActive) {
      toast.error(LOGOUT_OFFLINE_MESSAGE)
      return
    }
    const label = userDisplayName(account.user)
    const ok = window.confirm(
      accounts.length <= 1
        ? `确定退出「${label}」？退出后将返回欢迎界面。`
        : `确定退出账号「${label}」？其服务器与频道将从本机移除。`,
    )
    if (!ok) return
    setBusyId(account.id)
    try {
      await useAuthStore.getState().removeAccount(account.id)
      if (useAuthStore.getState().status === "unauthenticated") {
        navigate("/", { replace: true })
        onOpenChange(false)
      }
      toast.success(`已退出「${label}」`)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "退出账号失败",
      )
    } finally {
      setBusyId(null)
    }
  }

  const handleInviteSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (submitting) return
    const parsed = parseInviteLink(inviteLink)
    if (!parsed) {
      if (looksLikeBareInviteCode(inviteLink)) {
        setFormError(
          "只有邀请码无法定位服务器，请粘贴完整链接（形如 https://服务器地址/invite/邀请码）",
        )
      } else {
        setFormError("无法识别的邀请链接，请粘贴完整的注册或社区邀请链接")
      }
      return
    }
    setSubmitting(true)
    setFormError(null)
    try {
      if (parsed.kind === "registration") {
        const info = await precheckRegistrationInvite(
          parsed.serverBaseUrl,
          parsed.code,
        )
        setServerBaseUrl(parsed.serverBaseUrl)
        setServerName(info.server_name)
        setInviteKind("registration")
        setInviteCode(info.code)
        setRuntimeServerBaseUrl(parsed.serverBaseUrl)
        setStep("signup")
      } else {
        const info = await precheckGuildInvite(
          parsed.serverBaseUrl,
          parsed.code,
        )
        setServerBaseUrl(parsed.serverBaseUrl)
        setServerName(info.portal.app_name || hostOf(parsed.serverBaseUrl))
        setInviteKind("guild")
        setInviteCode(info.code)
        setGuildName(info.guild.name)
        setRuntimeServerBaseUrl(parsed.serverBaseUrl)
        setStep(info.signup_enabled ? "signup" : "login")
      }
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "NETWORK_ERROR") {
        setFormError("无法连接该服务器，请检查链接或网络")
      } else if (caught instanceof ApiError) {
        setFormError(caught.message || "校验邀请失败")
      } else {
        setFormError("校验邀请失败，请稍后再试")
      }
    } finally {
      setSubmitting(false)
    }
  }

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault()
    if (submitting) return
    if (!identifier.trim() || !password) {
      setFormError("请输入账号和密码")
      return
    }
    setSubmitting(true)
    setFormError(null)
    setRuntimeServerBaseUrl(serverBaseUrl)
    // 写入服务器名，供 commitAuthenticated 登记到账号元数据
    const { persistServerConnection } = await import("~/lib/server-connection")
    persistServerConnection(serverName || null)
    try {
      await useAuthStore.getState().addAccountLogin(identifier.trim(), password)
      if (remember) {
        await upsertSavedCredential({
          serverBaseUrl,
          serverName,
          identifier: identifier.trim(),
          password,
          id: selectedCredId ?? undefined,
        }).catch(() => undefined)
        notifySavedCredentialsChanged()
      }
      navigate("/", { replace: true })
      onOpenChange(false)
      toast.success("账号已添加")
    } catch (caught) {
      setFormError(loginErrorMessage(caught))
    } finally {
      setSubmitting(false)
    }
  }

  const handleSignup = async (event: React.FormEvent) => {
    event.preventDefault()
    if (submitting) return
    const u = username.trim()
    const e = email.trim()
    if (u.length < 2 || u.length > 32) {
      setFormError("用户名长度需为 2-32 个字符")
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
      setFormError("请输入有效的邮箱地址")
      return
    }
    if (password.length < 8 || password.length > 128) {
      setFormError("密码长度需为 8-128 个字符")
      return
    }
    if (password !== confirm) {
      setFormError("两次输入的密码不一致")
      return
    }
    setSubmitting(true)
    setFormError(null)
    setRuntimeServerBaseUrl(serverBaseUrl)
    const { persistServerConnection } = await import("~/lib/server-connection")
    persistServerConnection(serverName || null)
    try {
      await useAuthStore.getState().addAccountSignup({
        username: u,
        email: e,
        password,
        invite_code:
          inviteKind === "registration" ? inviteCode : undefined,
        guild_invite_code: inviteKind === "guild" ? inviteCode : undefined,
      })
      if (remember) {
        await upsertSavedCredential({
          serverBaseUrl,
          serverName,
          identifier: u,
          password,
        }).catch(() => undefined)
        notifySavedCredentialsChanged()
      }
      // 社区邀请：自动加入
      if (inviteKind === "guild" && inviteCode) {
        try {
          const { joinInvite } = await import("~/lib/api/guilds")
          const { useGuildsStore } = await import("~/stores/guilds")
          const { useUIStore } = await import("~/stores/ui")
          const member = await joinInvite(inviteCode)
          await useGuildsStore.getState().fetchGuilds().catch(() => undefined)
          useUIStore.getState().selectGuild(member.guild_id)
        } catch {
          toast.message("账号已添加，但未能自动加入社区，可稍后凭邀请码加入")
        }
      }
      navigate("/", { replace: true })
      onOpenChange(false)
      toast.success("账号已添加")
    } catch (caught) {
      setFormError(signupErrorMessage(caught))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UsersIcon className="size-5" />
            {step === "list"
              ? "切换账号"
              : step === "invite"
                ? "添加账号"
                : step === "login"
                  ? "登录账号"
                  : "注册账号"}
          </DialogTitle>
          <DialogDescription>
            {step === "list"
              ? "多个账号的服务器与频道会同时保留；进入频道时自动使用对应身份。"
              : step === "invite"
                ? "粘贴目标服务器的注册邀请或社区邀请链接。"
                : `${serverName || hostOf(serverBaseUrl)}${
                    guildName ? ` · ${guildName}` : ""
                  }`}
          </DialogDescription>
        </DialogHeader>

        {step === "list" && (
          <div className="flex flex-col gap-3">
            <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
              {accounts.map((account) => {
                const display = userDisplayName(account.user)
                const avatarSrc = resolveProfileAssetUrl(
                  account.user.avatar_url,
                  account.serverBaseUrl,
                )
                const isActive = account.id === activeAccountId
                const busy = busyId === account.id
                return (
                  <li
                    key={account.id}
                    className={cn(
                      "flex items-center gap-2 rounded-lg border border-transparent px-2 py-2",
                      isActive && "border-border bg-muted/60",
                    )}
                  >
                    <button
                      type="button"
                      disabled={busy || Boolean(busyId)}
                      onClick={() => void handleSwitch(account.id)}
                      className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left outline-none hover:opacity-90 disabled:opacity-50"
                    >
                      {/* 仅当前激活账号套 loadout 头像框（其他账号无装扮数据） */}
                      <AvatarWithFrame
                        frame={isActive ? activeAvatarFrame : undefined}
                        sizeClass="size-9"
                      >
                        <Avatar className="size-9 shrink-0 rounded-lg after:rounded-lg after:border-0">
                          {avatarSrc ? (
                            <AvatarImage
                              src={avatarSrc}
                              alt={display}
                              className="rounded-lg object-cover"
                            />
                          ) : null}
                          <AvatarFallback className="rounded-lg text-xs">
                            {nameInitials(display)}
                          </AvatarFallback>
                        </Avatar>
                      </AvatarWithFrame>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-medium">
                            {display}
                          </span>
                          {isActive && (
                            <CheckIcon className="size-3.5 shrink-0 text-emerald-500" />
                          )}
                        </div>
                        <p className="truncate text-xs text-muted-foreground">
                          @{account.user.username}
                          <span className="mx-1 opacity-40">·</span>
                          <ServerIcon className="mr-0.5 inline size-3 align-text-bottom opacity-70" />
                          {account.serverName || hostOf(account.serverBaseUrl)}
                        </p>
                      </div>
                    </button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      title={
                        account.id === activeAccountId && !canLogoutActive
                          ? LOGOUT_OFFLINE_MESSAGE
                          : "退出此账号"
                      }
                      disabled={
                        busy ||
                        Boolean(busyId) ||
                        (account.id === activeAccountId && !canLogoutActive)
                      }
                      onClick={() => void handleRemove(account)}
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                    >
                      <LogOutIcon className="size-4" />
                    </Button>
                  </li>
                )
              })}
            </ul>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => setStep("invite")}
            >
              <PlusIcon className="size-4" />
              添加账号
            </Button>
          </div>
        )}

        {step === "invite" && (
          <form className="flex flex-col gap-3" onSubmit={handleInviteSubmit}>
            <div className="space-y-2">
              <Label htmlFor="switch-invite">邀请链接</Label>
              <Input
                id="switch-invite"
                value={inviteLink}
                onChange={(e) => setInviteLink(e.target.value)}
                placeholder="https://服务器/register/… 或 /invite/…"
                autoFocus
                disabled={submitting}
              />
            </div>
            {formError && (
              <p className="text-sm text-destructive">{formError}</p>
            )}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={() => setStep("list")}
                disabled={submitting}
              >
                返回
              </Button>
              <Button type="submit" className="flex-1" disabled={submitting}>
                {submitting ? "校验中…" : "继续"}
              </Button>
            </div>
          </form>
        )}

        {step === "login" && (
          <form className="flex flex-col gap-3" onSubmit={handleLogin}>
            {serverBaseUrl ? (
              <SavedCredentialsPanel
                serverBaseUrl={serverBaseUrl}
                selectedId={selectedCredId}
                action="fill"
                disabled={submitting}
                onSelect={(cred) => void applyCredential(cred)}
              />
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="switch-login-id">用户名或邮箱</Label>
              <Input
                id="switch-login-id"
                value={identifier}
                onChange={(e) => {
                  setIdentifier(e.target.value)
                  setSelectedCredId(null)
                }}
                autoComplete="username"
                autoFocus
                disabled={submitting}
                className="border-0 bg-zinc-100 shadow-none dark:bg-zinc-800/80"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="switch-login-pw">密码</Label>
              <Input
                id="switch-login-pw"
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value)
                  setSelectedCredId(null)
                }}
                autoComplete="current-password"
                disabled={submitting}
                className="border-0 bg-zinc-100 shadow-none dark:bg-zinc-800/80"
              />
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
              <Checkbox
                checked={remember}
                onCheckedChange={(checked) => setRemember(checked)}
                disabled={submitting}
              />
              记住账号密码
            </label>
            {formError && (
              <p className="text-sm text-destructive">{formError}</p>
            )}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={() => setStep("invite")}
                disabled={submitting}
              >
                返回
              </Button>
              <Button type="submit" className="flex-1" disabled={submitting}>
                {submitting ? "登录中…" : "登录并添加"}
              </Button>
            </div>
            <button
              type="button"
              className="text-center text-sm text-muted-foreground underline underline-offset-4"
              onClick={() => setStep("signup")}
            >
              没有账号？注册
            </button>
          </form>
        )}

        {step === "signup" && (
          <form className="flex flex-col gap-3" onSubmit={handleSignup}>
            <div className="space-y-2">
              <Label htmlFor="switch-signup-user">用户名</Label>
              <Input
                id="switch-signup-user"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                autoFocus
                disabled={submitting}
                className="bg-zinc-100 dark:bg-zinc-800/80"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="switch-signup-email">邮箱</Label>
              <Input
                id="switch-signup-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                disabled={submitting}
                className="bg-zinc-100 dark:bg-zinc-800/80"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="switch-signup-pw">密码</Label>
              <Input
                id="switch-signup-pw"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                disabled={submitting}
                className="bg-zinc-100 dark:bg-zinc-800/80"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="switch-signup-confirm">确认密码</Label>
              <Input
                id="switch-signup-confirm"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                disabled={submitting}
                className="bg-zinc-100 dark:bg-zinc-800/80"
              />
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
              <Checkbox
                checked={remember}
                onCheckedChange={(checked) => setRemember(checked)}
                disabled={submitting}
              />
              记住账号密码
            </label>
            {formError && (
              <p className="text-sm text-destructive">{formError}</p>
            )}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={() => setStep("invite")}
                disabled={submitting}
              >
                返回
              </Button>
              <Button type="submit" className="flex-1" disabled={submitting}>
                {submitting ? "注册中…" : "注册并添加"}
              </Button>
            </div>
            <button
              type="button"
              className="text-center text-sm text-muted-foreground underline underline-offset-4"
              onClick={() => setStep("login")}
            >
              已有账号？登录
            </button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
