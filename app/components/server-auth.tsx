// 右侧页内认证视图：邀请预检通过后，对目标服务器注册（注册邀请携带
// invite_code，社区邀请携带 guild_invite_code）或登录。表单校验与错误文案
// 沿用原 /login、/register 页面。成功后持久化服务器基址（refresh token 已由
// http 层写入安全存储），auth store 置为 authenticated，应用壳自动切换到
// 正常主界面；社区邀请在拿到凭据后还会自动加入对应社区（失败仅 toast 提示，
// 不阻塞进入主界面）。

import * as React from "react"
import { toast } from "sonner"

import {
  notifySavedCredentialsChanged,
  SavedCredentialsPanel,
} from "~/components/saved-credentials-panel"
import { Button } from "~/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card"
import { Checkbox } from "~/components/ui/checkbox"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { joinInvite } from "~/lib/api/guilds"
import { ApiError } from "~/lib/api/http"
import { upsertSavedCredential } from "~/lib/saved-credentials"
import { persistServerConnection } from "~/lib/server-connection"
import { cn } from "~/lib/utils"
import { useAuthStore } from "~/stores/auth"
import { useChannelsStore } from "~/stores/channels"
import {
  useConnectStore,
  type PendingInvite,
  type PendingServerAuth,
} from "~/stores/connect"
import { useGuildsStore } from "~/stores/guilds"
import { useUIStore } from "~/stores/ui"

// ---------------------------------------------------------------------------
// 校验与错误文案（沿用原登录/注册页）
// ---------------------------------------------------------------------------

function validateSignup(
  username: string,
  email: string,
  password: string,
  confirm: string,
): string | null {
  if (username.length < 2 || username.length > 32)
    return "用户名长度需为 2-32 个字符"
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "请输入有效的邮箱地址"
  if (password.length < 8 || password.length > 128)
    return "密码长度需为 8-128 个字符"
  if (password !== confirm) return "两次输入的密码不一致"
  return null
}

function signupErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return "注册失败，请稍后再试"
  switch (error.code) {
    case "INVITE_INVALID":
      return "邀请无效或已失效，请向服务器管理员索取新的邀请链接"
    case "INVITE_EXPIRED":
      return "邀请已过期，请向服务器管理员索取新的邀请链接"
    case "SIGNUP_DISABLED":
      return "该服务器暂未开放注册"
    case "ACCOUNT_EXISTS":
      return "用户名或邮箱已被使用"
    case "INVALID_REQUEST":
      return "填写的信息不符合要求，请检查后重试"
    case "NETWORK_ERROR":
      return "无法连接服务器，请检查网络"
    default:
      return error.message || "注册失败，请稍后再试"
  }
}

function loginErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return "登录失败，请稍后再试"
  switch (error.code) {
    case "INVALID_CREDENTIALS":
      return "账号或密码错误"
    case "LOGIN_RATE_LIMITED":
      return "" // 交给冷却提示
    case "NETWORK_ERROR":
      return "无法连接服务器，请检查网络"
    default:
      return error.message || "登录失败，请稍后再试"
  }
}

function joinGuildErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.isNotFound)
      return "社区邀请已失效，未能自动加入，可稍后在主界面凭邀请码加入"
    if (error.code === "BANNED") return "你已被该社区封禁，无法加入"
    if (error.code === "NETWORK_ERROR")
      return "网络异常，未能自动加入社区，可稍后在主界面凭邀请码加入"
  }
  return "未能自动加入社区，可稍后在主界面凭邀请码加入"
}

/** 登录/注册卡片：灰色底、无阴影、无描边 */
const authCardClassName = cn(
  "w-full max-w-sm border-0 shadow-none ring-0",
  "bg-zinc-100 text-foreground dark:bg-zinc-800/90 dark:text-zinc-50",
)

// ---------------------------------------------------------------------------
// 视图
// ---------------------------------------------------------------------------

export function ServerAuthView({ pending }: { pending: PendingServerAuth }) {
  // 带邀请进来默认走注册；重登（无邀请）只提供登录
  const [mode, setMode] = React.useState<"signup" | "login">(
    pending.invite ? "signup" : "login",
  )

  const guildInvite =
    pending.invite?.kind === "guild" ? pending.invite : null

  const serverHost = React.useMemo(() => {
    try {
      return new URL(pending.serverBaseUrl).host
    } catch {
      return pending.serverBaseUrl
    }
  }, [pending.serverBaseUrl])

  const finish = async () => {
    // 先持久化服务器名，再补全账号记录里的 serverName
    persistServerConnection(pending.serverName)
    const accountId = useAuthStore.getState().activeAccountId
    const user = useAuthStore.getState().user
    if (accountId && user) {
      const { registerAccountSession } = await import("~/lib/api/http")
      registerAccountSession({
        accountId,
        user,
        serverBaseUrl: pending.serverBaseUrl,
        serverName: pending.serverName,
      })
      useAuthStore.setState({
        accounts: useAuthStore.getState().accounts.map((a) =>
          a.id === accountId
            ? {
                ...a,
                serverName: pending.serverName,
                serverBaseUrl: pending.serverBaseUrl,
              }
            : a,
        ),
      })
    }
    // 社区邀请：拿到凭据后自动加入该社区（已是成员时接口幂等返回 200）；
    // 加入失败不阻塞进入主界面，仅 toast 提示
    if (guildInvite) {
      try {
        const member = await joinInvite(guildInvite.code)
        await useGuildsStore.getState().fetchGuilds().catch(() => undefined)
        useUIStore.getState().selectGuild(member.guild_id)
        void useChannelsStore.getState().fetchChannels(member.guild_id)
      } catch (caught) {
        toast.error(joinGuildErrorMessage(caught))
      }
    }
    useConnectStore.getState().reset()
  }

  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <Card className={authCardClassName}>
        <CardHeader>
          <CardTitle>
            {guildInvite
              ? `加入「${guildInvite.guildName}」`
              : pending.serverName}
          </CardTitle>
          <CardDescription className="text-muted-foreground dark:text-zinc-400">
            {guildInvite
              ? `${pending.serverName} · ${serverHost} · ${
                  mode === "signup"
                    ? "注册账号后自动加入该社区"
                    : "登录后自动加入该社区"
                }`
              : `${serverHost} · ${
                  mode === "signup"
                    ? "使用邀请注册账号，注册成功后自动登录"
                    : "登录到该服务器"
                }`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {mode === "signup" ? (
            <SignupForm
              invite={pending.invite}
              serverBaseUrl={pending.serverBaseUrl}
              serverName={pending.serverName}
              onSuccess={finish}
              onSwitchToLogin={() => setMode("login")}
            />
          ) : (
            <LoginForm
              serverBaseUrl={pending.serverBaseUrl}
              serverName={pending.serverName}
              onSuccess={finish}
              onSwitchToSignup={
                pending.invite ? () => setMode("signup") : undefined
              }
            />
          )}
          <Button
            type="button"
            variant="ghost"
            className="mt-2 w-full text-muted-foreground"
            onClick={() => useConnectStore.getState().cancelAuth()}
          >
            返回
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

function SignupForm({
  invite,
  serverBaseUrl,
  serverName,
  onSuccess,
  onSwitchToLogin,
}: {
  invite: PendingInvite | null
  serverBaseUrl: string
  serverName: string
  onSuccess: () => void
  onSwitchToLogin: () => void
}) {
  const signup = useAuthStore((state) => state.signup)
  const [username, setUsername] = React.useState("")
  const [email, setEmail] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [confirm, setConfirm] = React.useState("")
  const [remember, setRemember] = React.useState(true)
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (submitting) return
    const trimmedUsername = username.trim()
    const trimmedEmail = email.trim()
    const invalid = validateSignup(
      trimmedUsername,
      trimmedEmail,
      password,
      confirm,
    )
    if (invalid) {
      setError(invalid)
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await signup({
        username: trimmedUsername,
        email: trimmedEmail,
        password,
        invite_code: invite?.kind === "registration" ? invite.code : undefined,
        guild_invite_code: invite?.kind === "guild" ? invite.code : undefined,
      })
      if (remember) {
        await upsertSavedCredential({
          serverBaseUrl,
          serverName,
          identifier: trimmedUsername,
          password,
        }).catch(() => undefined)
        notifySavedCredentialsChanged()
      }
      onSuccess()
    } catch (caught) {
      setError(signupErrorMessage(caught))
      setSubmitting(false)
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      <div className="flex flex-col gap-2">
        <Label htmlFor="auth-username">用户名</Label>
        <Input
          id="auth-username"
          autoComplete="username"
          autoFocus
          placeholder="2-32 个字符"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          disabled={submitting}
          className="border-0 bg-background/70 shadow-none dark:bg-zinc-900/50"
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="auth-email">邮箱</Label>
        <Input
          id="auth-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={submitting}
          className="border-0 bg-background/70 shadow-none dark:bg-zinc-900/50"
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="auth-password">密码</Label>
        <Input
          id="auth-password"
          type="password"
          autoComplete="new-password"
          placeholder="8-128 个字符"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={submitting}
          className="border-0 bg-background/70 shadow-none dark:bg-zinc-900/50"
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="auth-confirm">确认密码</Label>
        <Input
          id="auth-confirm"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          disabled={submitting}
          className="border-0 bg-background/70 shadow-none dark:bg-zinc-900/50"
        />
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
        <Checkbox
          checked={remember}
          onCheckedChange={(checked) => setRemember(checked)}
          disabled={submitting}
        />
        记住账号密码（含服务器）
      </label>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={submitting}>
        {submitting ? "注册中…" : "注册"}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        已有账号？{" "}
        <button
          type="button"
          className="text-foreground underline underline-offset-4"
          onClick={onSwitchToLogin}
        >
          登录
        </button>
      </p>
    </form>
  )
}

function LoginForm({
  serverBaseUrl,
  serverName,
  onSuccess,
  onSwitchToSignup,
}: {
  serverBaseUrl: string
  serverName: string
  onSuccess: () => void
  onSwitchToSignup?: () => void
}) {
  const login = useAuthStore((state) => state.login)
  const [identifier, setIdentifier] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [remember, setRemember] = React.useState(true)
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [cooldown, setCooldown] = React.useState(0)

  // 429 冷却倒计时
  React.useEffect(() => {
    if (cooldown <= 0) return
    const timer = setInterval(
      () => setCooldown((value) => Math.max(0, value - 1)),
      1_000,
    )
    return () => clearInterval(timer)
  }, [cooldown > 0])

  const handleQuickLoginSuccess = React.useCallback(async () => {
    await onSuccess()
  }, [onSuccess])

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (submitting || cooldown > 0) return
    if (!identifier.trim() || !password) {
      setError("请输入账号和密码")
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await login(identifier.trim(), password)
      if (remember) {
        await upsertSavedCredential({
          serverBaseUrl,
          serverName,
          identifier: identifier.trim(),
          password,
        }).catch(() => undefined)
        notifySavedCredentialsChanged()
      }
      onSuccess()
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "LOGIN_RATE_LIMITED") {
        setCooldown(caught.retryAfterSeconds ?? 60)
        setError(null)
      } else {
        setError(loginErrorMessage(caught))
      }
      setSubmitting(false)
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      {/* 本服务器已记住账号：点击即登录（含服务器信息） */}
      <SavedCredentialsPanel
        serverBaseUrl={serverBaseUrl}
        action="login"
        disabled={submitting || cooldown > 0}
        onLoginSuccess={handleQuickLoginSuccess}
      />
      <div className="relative py-1 text-center text-xs text-muted-foreground">
        <span className="relative z-10 bg-zinc-100 px-2 dark:bg-zinc-800/90">
          或手动登录
        </span>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="auth-identifier">用户名或邮箱</Label>
        <Input
          id="auth-identifier"
          autoComplete="username"
          autoFocus
          value={identifier}
          onChange={(event) => setIdentifier(event.target.value)}
          disabled={submitting}
          className="border-0 bg-background/70 shadow-none dark:bg-zinc-900/50"
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="auth-login-password">密码</Label>
        <Input
          id="auth-login-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={submitting}
          className="border-0 bg-background/70 shadow-none dark:bg-zinc-900/50"
        />
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
        <Checkbox
          checked={remember}
          onCheckedChange={(checked) => setRemember(checked)}
          disabled={submitting}
        />
        记住账号密码（含服务器）
      </label>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {cooldown > 0 && (
        <p className="text-sm text-destructive">
          登录尝试过多，请在 {cooldown} 秒后再试
        </p>
      )}
      <Button type="submit" disabled={submitting || cooldown > 0}>
        {submitting ? "登录中…" : "登录"}
      </Button>
      {onSwitchToSignup && (
        <p className="text-center text-sm text-muted-foreground">
          还没有账号？{" "}
          <button
            type="button"
            className="text-foreground underline underline-offset-4"
            onClick={onSwitchToSignup}
          >
            使用邀请注册
          </button>
        </p>
      )}
    </form>
  )
}
