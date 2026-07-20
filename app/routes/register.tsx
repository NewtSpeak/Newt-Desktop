// 注册页（docs 01）：字段校验与服务端一致（用户名 2-32、密码 8-128），
// 注册成功即持有会话直接进入主界面。

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

function validate(username: string, email: string, password: string, confirm: string): string | null {
  if (username.length < 2 || username.length > 32) return "用户名长度需为 2-32 个字符"
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "请输入有效的邮箱地址"
  if (password.length < 8 || password.length > 128) return "密码长度需为 8-128 个字符"
  if (password !== confirm) return "两次输入的密码不一致"
  return null
}

function signupErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return "注册失败，请稍后再试"
  switch (error.code) {
    case "SIGNUP_DISABLED":
      return "注册暂未开放"
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

export default function RegisterPage() {
  const status = useAuthBootstrap()
  const navigate = useNavigate()
  const signup = useAuthStore((state) => state.signup)

  const [username, setUsername] = React.useState("")
  const [email, setEmail] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [confirm, setConfirm] = React.useState("")
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  if (status === "authenticated") return <Navigate to="/" replace />

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (submitting) return
    const trimmedUsername = username.trim()
    const trimmedEmail = email.trim()
    const invalid = validate(trimmedUsername, trimmedEmail, password, confirm)
    if (invalid) {
      setError(invalid)
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await signup({ username: trimmedUsername, email: trimmedEmail, password })
      navigate("/", { replace: true })
    } catch (caught) {
      setError(signupErrorMessage(caught))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthPage>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>注册 OwlSpeak</CardTitle>
          <CardDescription>创建账号，注册成功后自动登录</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
            <div className="flex flex-col gap-2">
              <Label htmlFor="username">用户名</Label>
              <Input
                id="username"
                autoComplete="username"
                autoFocus
                placeholder="2-32 个字符"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                disabled={submitting}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">邮箱</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={submitting}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">密码</Label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                placeholder="8-128 个字符"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={submitting}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="confirm">确认密码</Label>
              <Input
                id="confirm"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                disabled={submitting}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={submitting}>
              {submitting ? "注册中…" : "注册"}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              已有账号？{" "}
              <Link to="/login" className="text-foreground underline underline-offset-4">
                登录
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </AuthPage>
  )
}
