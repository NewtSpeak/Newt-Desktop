// 上锁频道访问密码弹窗

import { useEffect, useState } from "react"
import { KeyRoundIcon, LockIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "~/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog"
import { Input } from "~/components/ui/input"
import { ApiError } from "~/lib/api/http"
import { useChannelsStore } from "~/stores/channels"
import { useChannelUnlocksStore } from "~/stores/channel-unlocks"

export function ChannelUnlockDialog() {
  const channelId = useChannelUnlocksStore((s) => s.pendingChannelId)
  const close = useChannelUnlocksStore((s) => s.closeUnlockDialog)
  const submit = useChannelUnlocksStore((s) => s.submitPassword)

  const channel = useChannelsStore((s) => {
    if (!channelId) return undefined
    for (const list of Object.values(s.byGuild)) {
      const hit = list.find((c) => c.id === channelId)
      if (hit) return hit
    }
    return undefined
  })

  const [password, setPassword] = useState("")
  const [pending, setPending] = useState(false)

  useEffect(() => {
    if (channelId) {
      setPassword("")
      setPending(false)
    }
  }, [channelId])

  if (!channelId) return null

  const onSubmit = async () => {
    if (!password) {
      toast.error("请输入频道密码")
      return
    }
    setPending(true)
    try {
      await submit(password)
      toast.success("频道已解锁")
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : "解锁失败，请检查密码",
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close()
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LockIcon className="size-4 text-muted-foreground" />
            频道已上锁
          </DialogTitle>
          <DialogDescription>
            {channel
              ? `「${channel.name}」需要访问密码才能进入`
              : "该频道需要访问密码才能进入"}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            void onSubmit()
          }}
        >
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              访问密码
            </span>
            <Input
              type="password"
              autoFocus
              value={password}
              maxLength={64}
              placeholder="输入频道密码"
              disabled={pending}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={close}
            >
              取消
            </Button>
            <Button type="submit" disabled={pending || !password}>
              <KeyRoundIcon className="size-4" />
              {pending ? "验证中…" : "解锁"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
