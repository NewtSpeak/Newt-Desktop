// 「通过邀请链接添加服务器」对话框（未连接任何服务器时左侧「+」的入口）：
// 解析邀请链接（注册邀请或社区邀请）→ 免登录预检 → 关闭弹窗，右侧进入
// 该服务器的页内登录/注册流程；社区邀请在认证成功后还会自动加入对应社区。
//
// 与已登录后的 add-guild-dialog（创建/加入 guild）是两回事：这里的邀请链接
// 用于连接服务器并开通账号。

import * as React from "react"

import { Button } from "~/components/ui/button"
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
  looksLikeBareInviteCode,
  parseInviteLink,
} from "~/lib/server-connection"
import { useConnectStore } from "~/stores/connect"

function precheckErrorMessage(
  error: unknown,
  kind: "registration" | "guild"
): string {
  if (!(error instanceof ApiError)) return "校验邀请失败，请稍后再试"
  if (error.status === 404)
    return kind === "guild"
      ? "邀请不存在或已失效"
      : "邀请无效，请确认链接是否完整"
  if (error.status === 410)
    return "邀请已过期、用尽或被撤销，请向服务器管理员索取新的邀请"
  if (error.code === "NETWORK_ERROR")
    return "无法连接该服务器，请检查链接或网络"
  return error.message || "校验邀请失败，请稍后再试"
}

function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host
  } catch {
    return baseUrl
  }
}

export function AddServerDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [link, setLink] = React.useState("")
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const reset = () => {
    setLink("")
    setError(null)
    setSubmitting(false)
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (submitting) return
    const parsed = parseInviteLink(link)
    if (!parsed) {
      if (looksLikeBareInviteCode(link)) {
        setError(
          "只有邀请码无法定位服务器，请粘贴完整链接（形如 https://服务器地址/invite/邀请码）"
        )
      } else {
        setError("无法识别的邀请链接，请粘贴完整的注册邀请链接或社区邀请链接")
      }
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      if (parsed.kind === "registration") {
        const info = await precheckRegistrationInvite(
          parsed.serverBaseUrl,
          parsed.code
        )
        useConnectStore.getState().startAuth({
          serverBaseUrl: parsed.serverBaseUrl,
          serverName: info.server_name,
          invite: { kind: "registration", code: info.code },
        })
      } else {
        const info = await precheckGuildInvite(parsed.serverBaseUrl, parsed.code)
        useConnectStore.getState().startAuth({
          serverBaseUrl: parsed.serverBaseUrl,
          serverName: info.portal.app_name || hostOf(parsed.serverBaseUrl),
          invite: {
            kind: "guild",
            code: info.code,
            guildName: info.guild.name,
          },
        })
      }
      onOpenChange(false)
      reset()
    } catch (caught) {
      setError(precheckErrorMessage(caught, parsed.kind))
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) reset()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>通过邀请链接添加服务器</DialogTitle>
          <DialogDescription>
            粘贴注册邀请链接或社区邀请链接，连接到该服务器并开通账号
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4 pt-2" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="server-invite-link">邀请链接</Label>
            <Input
              id="server-invite-link"
              autoFocus
              placeholder="https://example.com/register/xxxx、…/invite/xxxx 或 owlspeak:// 链接"
              value={link}
              onChange={(event) => setLink(event.target.value)}
              disabled={submitting}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={submitting}>
            {submitting ? "校验中…" : "继续"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
