// 登录页（docs 01）：单 identifier（用户名或邮箱）+ 密码。

import * as React from "react"
import { Link, Navigate, useNavigate } from "react-router"

import { AuthPage } from "~/components/auth-page"
import { Button } from "~/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { useAuthBootstrap } from "~/hooks/use-auth-bootstrap"
import { ApiError } from "~/lib/api/http"
import { useAuthStore } from "~/stores/auth"

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

export default function LoginPage() {
  const status = useAuthBootstrap()
  const navigate = useNavigate()
  const login = useAuthStore((state) => state.login)

  const [identifier, setIdentifier] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [cooldown, setCooldown] = React.useState(0)

  // 429 冷却倒计时
  React.useEffect(() => {
    if (cooldown <= 0) return
    const timer = setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1_000)
    return () => clearInterval(timer)
  }, [cooldown > 0])

  if (status === "authenticated") return <Navigate to="/" replace />

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
      navigate("/", { replace: true })
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "LOGIN_RATE_LIMITED") {
        setCooldown(caught.retryAfterSeconds ?? 60)
        setError(null)
      } else {
        setError(loginErrorMessage(caught))
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthPage>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>登录 OwlSpeak</CardTitle>
          <CardDescription>使用用户名或邮箱登录</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
            <div className="flex flex-col gap-2">
              <Label htmlFor="identifier">用户名或邮箱</Label>
              <Input
                id="identifier"
                autoComplete="username"
                autoFocus
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                disabled={submitting}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">密码</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={submitting}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            {cooldown > 0 && (
              <p className="text-sm text-destructive">
                登录尝试过多，请在 {cooldown} 秒后再试
              </p>
            )}
            <Button type="submit" disabled={submitting || cooldown > 0}>
              {submitting ? "登录中…" : "登录"}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              还没有账号？{" "}
              <Link to="/register" className="text-foreground underline underline-offset-4">
                注册
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </AuthPage>
  )
}
