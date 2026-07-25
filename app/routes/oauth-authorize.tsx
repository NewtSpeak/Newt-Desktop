// OAuth Authorization Code + PKCE 授权页（Desktop / 用户 Web）。
// CLI 打开本页，用户可勾选缩减 scope，同意后跳转 loopback redirect_uri?code=&state=

import { useCallback, useState } from "react"
import { Link, useSearchParams } from "react-router"
import { Loader2Icon, ShieldCheckIcon } from "lucide-react"

import { ScopeChecklist } from "~/components/oauth/scope-checklist"
import { Button, buttonVariants } from "~/components/ui/button"
import { useAuthBootstrap } from "~/hooks/use-auth-bootstrap"
import { ApiError } from "~/lib/api/http"
import { approveAuthorize } from "~/lib/api/oauth"
import { getServerBaseUrl } from "~/lib/server-connection"
import { useAuthStore } from "~/stores/auth"
import { cn } from "~/lib/utils"

export default function OAuthAuthorizePage() {
  const [params] = useSearchParams()
  const authStatus = useAuthBootstrap()
  const user = useAuthStore((s) => s.user)

  const clientId = params.get("client_id") ?? "owl-cli"
  const redirectUri = params.get("redirect_uri") ?? ""
  const scope = params.get("scope") ?? "openid profile gapi.full offline_access"
  const challenge = params.get("code_challenge") ?? ""
  const method = params.get("code_challenge_method") ?? "S256"
  const state = params.get("state") ?? ""

  const server = getServerBaseUrl()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [grantedScope, setGrantedScope] = useState("")
  const onScopeChange = useCallback((s: string) => setGrantedScope(s), [])

  const missing =
    !redirectUri || !challenge
      ? "缺少 redirect_uri 或 code_challenge"
      : null

  const onApprove = async () => {
    if (missing) return
    if (!grantedScope.trim()) {
      setError("请至少选择一项权限")
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await approveAuthorize({
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: grantedScope,
        code_challenge: challenge,
        code_challenge_method: method,
        state: state || undefined,
      })
      window.location.href = res.redirect_uri
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "授权失败")
      setBusy(false)
    }
  }

  const onDeny = () => {
    try {
      const u = new URL(redirectUri)
      u.searchParams.set("error", "access_denied")
      if (state) u.searchParams.set("state", state)
      window.location.href = u.toString()
    } catch {
      setError("已拒绝授权")
    }
  }

  const needLogin = authStatus === "unauthenticated"
  const booting = authStatus === "loading"

  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-2xl border border-border/60 bg-card p-6 shadow-sm">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <ShieldCheckIcon className="size-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight" data-testid="oauth-authorize-title">
              授权 CLI / AI
            </h1>
            <p className="text-sm text-muted-foreground">OAuth PKCE · {clientId}</p>
          </div>
        </div>

        {server && (
          <p className="mb-4 truncate text-xs text-muted-foreground">服务器：{server}</p>
        )}

        {booting && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" />
            正在恢复登录状态…
          </div>
        )}

        {!booting && needLogin && (
          <div className="space-y-3 rounded-xl bg-muted/50 p-4 text-sm">
            <p>请先登录 OwlSpeak，再批准此请求。</p>
            <Link
              to={`/?returnTo=${encodeURIComponent(window.location.pathname + window.location.search)}`}
              className={cn(buttonVariants(), "w-full")}
            >
              返回应用登录
            </Link>
          </div>
        )}

        {!booting && !needLogin && (missing || !server) && (
          <p className="text-sm text-destructive" role="alert">
            {missing ?? "尚未连接服务器，请先在客户端添加服务器。"}
          </p>
        )}

        {!booting && !needLogin && !missing && server && (
          <div className="space-y-4">
            {user && (
              <p className="text-sm text-muted-foreground">
                以 <span className="font-medium text-foreground">{user.username}</span> 授权
              </p>
            )}
            <div className="rounded-xl border border-border/50 p-4 text-sm">
              <p className="font-medium">{clientId}</p>
              <p className="mt-1 break-all text-muted-foreground">
                回调：{redirectUri}
              </p>
            </div>
            <ScopeChecklist requestedScope={scope} onChange={onScopeChange} />
            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" disabled={busy} onClick={onDeny}>
                拒绝
              </Button>
              <Button
                className="flex-1"
                disabled={busy || !grantedScope.trim()}
                onClick={() => void onApprove()}
                data-testid="oauth-authorize-approve"
              >
                {busy ? <Loader2Icon className="size-4 animate-spin" /> : "允许"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
