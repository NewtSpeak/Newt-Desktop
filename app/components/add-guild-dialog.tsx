// 「添加服务器」对话框：创建服务器 / 凭邀请码加入（支持粘贴完整邀请 URL 自动提取 code）。

import * as React from "react"
import { useNavigate } from "react-router"

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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs"
import { createGuild, joinInvite } from "~/lib/api/guilds"
import { ApiError } from "~/lib/api/http"
import {
  getServerBaseUrl,
  isSameServer,
  parseInviteLink,
} from "~/lib/server-connection"
import { useChannelsStore } from "~/stores/channels"
import { useGuildsStore } from "~/stores/guilds"
import { useUIStore } from "~/stores/ui"

/**
 * 从输入中提取邀请码：支持纯 code、完整社区邀请链接（分享链接/深链）或
 * "invite/CODE" 片段。完整链接会校验其指向的服务器与当前连接一致。
 */
export function extractInviteCode(
  input: string
): { code: string } | { error: string } {
  const raw = input.trim()
  if (!raw) return { error: "请输入邀请码或邀请链接" }
  const parsed = parseInviteLink(raw)
  if (parsed) {
    if (parsed.kind === "registration")
      return { error: "这是注册邀请链接，不是社区邀请链接" }
    const current = getServerBaseUrl()
    if (current && !isSameServer(current, parsed.serverBaseUrl))
      return { error: "该邀请属于其他服务器" }
    return { code: parsed.code }
  }
  // 非完整邀请链接：容忍纯 code、其他 URL 或 "invite/CODE" 这类片段，取最后一段
  let segments: string[]
  try {
    segments = new URL(raw).pathname.split("/").filter(Boolean)
  } catch {
    segments = raw.split("/").filter(Boolean)
  }
  const code = segments[segments.length - 1] ?? ""
  return code ? { code } : { error: "请输入邀请码或邀请链接" }
}

export function AddGuildDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const navigate = useNavigate()
  const [name, setName] = React.useState("")
  const [invite, setInvite] = React.useState("")
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const reset = () => {
    setName("")
    setInvite("")
    setError(null)
    setSubmitting(false)
  }

  const finish = async (guildId: string) => {
    // 刷新列表并着陆到默认欢迎频道 / 第一个可见文字频道
    await useGuildsStore.getState().fetchGuilds().catch(() => undefined)
    onOpenChange(false)
    reset()
    const { landInGuild } = await import("~/lib/land-in-guild")
    await landInGuild(guildId, navigate)
  }

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault()
    const trimmed = name.trim()
    if (trimmed.length < 2 || trimmed.length > 100) {
      setError("服务器名称长度需为 2-100 个字符")
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const guild = await createGuild(trimmed)
      await finish(guild.id)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "创建服务器失败，请稍后再试")
      setSubmitting(false)
    }
  }

  const handleJoin = async (event: React.FormEvent) => {
    event.preventDefault()
    const extracted = extractInviteCode(invite)
    if ("error" in extracted) {
      setError(extracted.error)
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const member = await joinInvite(extracted.code)
      await finish(member.guild_id)
    } catch (caught) {
      if (caught instanceof ApiError) {
        if (caught.isNotFound) setError("邀请不存在或已过期")
        else if (caught.code === "BANNED") setError("你已被该服务器封禁，无法加入")
        else setError(caught.message)
      } else {
        setError("加入服务器失败，请稍后再试")
      }
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
          <DialogTitle>添加服务器</DialogTitle>
          <DialogDescription>创建一个新服务器，或凭邀请码加入现有服务器</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="create" onValueChange={() => setError(null)}>
          <TabsList className="w-full">
            <TabsTrigger value="create">创建服务器</TabsTrigger>
            <TabsTrigger value="join">加入服务器</TabsTrigger>
          </TabsList>
          <TabsContent value="create">
            <form className="flex flex-col gap-4 pt-2" onSubmit={handleCreate}>
              <div className="flex flex-col gap-2">
                <Label htmlFor="guild-name">服务器名称</Label>
                <Input
                  id="guild-name"
                  placeholder="2-100 个字符"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  disabled={submitting}
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" disabled={submitting}>
                {submitting ? "创建中…" : "创建"}
              </Button>
            </form>
          </TabsContent>
          <TabsContent value="join">
            <form className="flex flex-col gap-4 pt-2" onSubmit={handleJoin}>
              <div className="flex flex-col gap-2">
                <Label htmlFor="invite-code">邀请码或邀请链接</Label>
                <Input
                  id="invite-code"
                  placeholder="例如 hTKzmak 或完整邀请链接"
                  value={invite}
                  onChange={(event) => setInvite(event.target.value)}
                  disabled={submitting}
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" disabled={submitting}>
                {submitting ? "加入中…" : "加入"}
              </Button>
            </form>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
