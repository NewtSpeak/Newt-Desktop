// OAuth 设备授权页（用户端 Desktop / Web，非管理台）。
// 可先输入设备码（无需登录）；批准/拒绝需 aud=client 会话。

import { useCallback, useEffect, useState } from "react"
import { Link, useSearchParams } from "react-router"
import { Loader2Icon, ShieldCheckIcon } from "lucide-react"

import { ScopeChecklist } from "~/components/oauth/scope-checklist"
import { Button, buttonVariants } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { useAuthBootstrap } from "~/hooks/use-auth-bootstrap"
import { ApiError } from "~/lib/api/http"
import {
  approveDevice,
  denyDevice,
  getDeviceInfo,
  type DeviceInfo,
} from "~/lib/api/oauth"
import { getServerBaseUrl } from "~/lib/server-connection"
import { useAuthStore } from "~/stores/auth"
import { cn } from "~/lib/utils"

type Phase = "loading" | "form" | "ready" | "done" | "denied" | "error"

export default function OAuthDevicePage() {
  const [params] = useSearchParams()
  const initialCode = (params.get("user_code") ?? "").toUpperCase()
  const authStatus = useAuthBootstrap()
  const user = useAuthStore((s) => s.user)

  const [userCode, setUserCode] = useState(initialCode)
  const [info, setInfo] = useState<DeviceInfo | null>(null)
  const [phase, setPhase] = useState<Phase>(initialCode ? "loading" : "form")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [grantedScope, setGrantedScope] = useState("")

  const server = getServerBaseUrl()
  const onScopeChange = useCallback((s: string) => setGrantedScope(s), [])

  const load = useCallback(async (code: string) => {
    const trimmed = code.trim().toUpperCase()
    if (!trimmed) {
      setError("请输入设备码")
      setPhase("form")
      return
    }
    if (!getServerBaseUrl()) {
      setError("尚未连接服务器。请先在客户端添加服务器。")
      setPhase("form")
      return
    }
    setPhase("loading")
    setError(null)
    try {
      const data = await getDeviceInfo(trimmed)
      setInfo(data)
      setUserCode(data.user_code)
      if (data.status !== "pending") {
        setError(
          data.status === "approved" || data.status === "consumed"
            ? "该授权码已使用"
            : data.status === "denied"
              ? "该授权码已被拒绝"
              : "该授权码已失效",
        )
        setPhase("error")
        return
      }
      setPhase("ready")
    } catch (e) {
      setInfo(null)
      setError(e instanceof ApiError ? e.message : "无法加载授权请求")
      setPhase("error")
    }
  }, [])

  useEffect(() => {
    if (initialCode) void load(initialCode)
  }, [initialCode, load])

  const onSubmitCode = (event: React.FormEvent) => {
    event.preventDefault()
    void load(userCode)
  }

  const onApprove = async () => {
    if (!info) return
    if (!grantedScope.trim()) {
      setError("请至少选择一项权限")
      return
    }
    setBusy(true)
    setError(null)
    try {
      await approveDevice(info.user_code, grantedScope)
      setPhase("done")
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "授权失败")
    } finally {
      setBusy(false)
    }
  }

  const onDeny = async () => {
    if (!info) return
    setBusy(true)
    setError(null)
    try {
      await denyDevice(info.user_code)
      setPhase("denied")
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "操作失败")
    } finally {
      setBusy(false)
    }
  }

  const needLogin = authStatus === "unauthenticated"
  const booting = authStatus === "loading"
  // 输入码 / 加载 / 错误：不要求登录
  const showCodeFlow =
    !booting && (phase === "form" || phase === "loading" || phase === "error")
  // 同意页：需登录
  const showReady = !booting && phase === "ready" && info

  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-2xl border border-border/60 bg-card p-6 shadow-sm">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <ShieldCheckIcon className="size-5" />
          </div>
          <div>
            <h1
              className="text-lg font-semibold tracking-tight"
              data-testid="oauth-device-title"
            >
              授权 CLI / AI
            </h1>
            <p className="text-sm text-muted-foreground">
              NewtSpeak OAuth 设备授权
            </p>
          </div>
        </div>

        {server ? (
          <p className="mb-4 truncate text-xs text-muted-foreground">
            服务器：{server}
          </p>
        ) : (
          <p className="mb-4 text-sm text-amber-600 dark:text-amber-400">
            尚未连接服务器。可先输入设备码；继续前请添加服务器。
          </p>
        )}

        {booting && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" />
            正在恢复登录状态…
          </div>
        )}

        {showCodeFlow && phase === "form" && (
          <form onSubmit={onSubmitCode} className="space-y-3">
            <label className="block text-sm font-medium">输入设备码</label>
            <Input
              value={userCode}
              onChange={(e) => setUserCode(e.target.value.toUpperCase())}
              placeholder="XXXX-XXXX"
              className="font-mono tracking-widest"
              autoFocus
              data-testid="oauth-device-code-input"
            />
            {error && (
              <p className="text-sm text-destructive" role="alert" data-testid="oauth-device-form-error">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" data-testid="oauth-device-continue">
              继续
            </Button>
          </form>
        )}

        {showCodeFlow && phase === "loading" && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" />
            加载授权请求…
          </div>
        )}

        {showCodeFlow && phase === "error" && (
          <div className="space-y-3">
            <p className="text-sm text-destructive" role="alert" data-testid="oauth-device-error">
              {error ?? "出错了"}
            </p>
            <Button
              variant="outline"
              className="w-full"
              data-testid="oauth-device-retry"
              onClick={() => {
                setPhase("form")
                setError(null)
                setInfo(null)
              }}
            >
              重新输入设备码
            </Button>
          </div>
        )}

        {showReady && needLogin && (
          <div className="space-y-3 rounded-xl bg-muted/50 p-4 text-sm" data-testid="oauth-device-login-wall">
            <p>
              设备码 <span className="font-mono">{info.user_code}</span> 有效。
              请先登录再批准权限。
            </p>
            <p className="text-xs text-muted-foreground">
              {info.client_name || info.client_id} 请求访问
            </p>
            <Link
              to={`/?returnTo=${encodeURIComponent(`/oauth/device?user_code=${info.user_code}`)}`}
              className={cn(buttonVariants(), "w-full")}
              data-testid="oauth-device-go-login"
            >
              返回应用登录
            </Link>
          </div>
        )}

        {showReady && !needLogin && (
          <div className="space-y-4">
            {user && (
              <p className="text-sm text-muted-foreground">
                以 <span className="font-medium text-foreground">{user.username}</span>{" "}
                的身份授权
              </p>
            )}
            <div className="rounded-xl border border-border/50 p-4">
              <p className="font-medium">{info.client_name || info.client_id}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {info.description || "请求代表你操作 NewtSpeak"}
              </p>
              <p className="mt-3 font-mono text-lg tracking-widest">{info.user_code}</p>
            </div>
            <ScopeChecklist
              requestedScope={info.scope}
              onChange={onScopeChange}
            />
            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                disabled={busy}
                onClick={() => void onDeny()}
                data-testid="oauth-device-deny"
              >
                拒绝
              </Button>
              <Button
                className="flex-1"
                disabled={busy || !grantedScope.trim()}
                onClick={() => void onApprove()}
                data-testid="oauth-device-approve"
              >
                {busy ? (
                  <Loader2Icon className="size-4 animate-spin" />
                ) : (
                  "允许"
                )}
              </Button>
            </div>
          </div>
        )}

        {!booting && phase === "done" && (
          <div className="space-y-3 text-center">
            <p className="text-base font-medium text-emerald-600 dark:text-emerald-400">
              已授权
            </p>
            <p className="text-sm text-muted-foreground">
              可以返回终端或 AI 工具继续。此窗口可关闭。
            </p>
            <Link to="/" className={cn(buttonVariants({ variant: "secondary" }), "w-full")}>
              回到 NewtSpeak
            </Link>
          </div>
        )}

        {!booting && phase === "denied" && (
          <div className="space-y-3 text-center">
            <p className="text-base font-medium">已拒绝授权</p>
            <p className="text-sm text-muted-foreground">CLI 将无法访问你的账号。</p>
            <Link to="/" className={cn(buttonVariants({ variant: "secondary" }), "w-full")}>
              回到 NewtSpeak
            </Link>
          </div>
        )}
      </div>
    </main>
  )
}
