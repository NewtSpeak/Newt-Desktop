// 仅开发用：无登录展示 scope 预设，供 e2e / 手工验收。
// 生产构建仍可访问但不链接入口；不调用后端。

import { ScopeChecklist } from "~/components/oauth/scope-checklist"
import { useState } from "react"

const DEMO_SCOPE =
  "openid profile offline_access gapi.full gapi.read gapi.guilds.manage platform.read platform.admin"

export default function OAuthScopeDemoPage() {
  const [scope, setScope] = useState("")
  return (
    <main className="mx-auto max-w-md space-y-4 p-6" data-testid="oauth-scope-demo">
      <h1 className="text-lg font-semibold">OAuth scope 预设演示</h1>
      <p className="text-sm text-muted-foreground">
        开发/e2e 页面，不提交授权。
      </p>
      <ScopeChecklist requestedScope={DEMO_SCOPE} onChange={setScope} />
      <p className="break-all font-mono text-xs text-muted-foreground" data-testid="oauth-scope-demo-value">
        {scope || "(empty)"}
      </p>
    </main>
  )
}
