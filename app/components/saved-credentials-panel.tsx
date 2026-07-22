// 已记住账号密码列表：含服务器信息；支持一键登录 / 填入，以及编辑、删除。

import * as React from "react"
import {
  CheckIcon,
  Loader2Icon,
  PencilIcon,
  ServerIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import {
  credentialServerHost,
  credentialServerLabel,
  loginWithSavedCredential,
} from "~/lib/quick-login"
import {
  deleteSavedCredential,
  listSavedCredentials,
  listSavedCredentialsForServer,
  updateSavedCredential,
  type SavedCredential,
} from "~/lib/saved-credentials"
import { cn } from "~/lib/utils"

export function SavedCredentialsPanel({
  /** 限定某一服务器；不传则列出全部已记住账号（含服务器信息） */
  serverBaseUrl,
  selectedId = null,
  /** fill=仅填入表单；login=点击即登录（默认） */
  action = "login",
  onSelect,
  onLoginSuccess,
  onListChange,
  disabled = false,
  className,
  /** 外层是否用灰色卡片样式 */
  asCard = false,
}: {
  serverBaseUrl?: string
  selectedId?: string | null
  action?: "fill" | "login"
  onSelect?: (credential: SavedCredential) => void
  onLoginSuccess?: () => void | Promise<void>
  onListChange?: (list: SavedCredential[]) => void
  disabled?: boolean
  className?: string
  asCard?: boolean
}) {
  const [list, setList] = React.useState<SavedCredential[]>([])
  const [loading, setLoading] = React.useState(true)
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [editIdentifier, setEditIdentifier] = React.useState("")
  const [editPassword, setEditPassword] = React.useState("")
  const [busyId, setBusyId] = React.useState<string | null>(null)

  const onListChangeRef = React.useRef(onListChange)
  onListChangeRef.current = onListChange

  const reload = React.useCallback(async () => {
    setLoading(true)
    try {
      const next = serverBaseUrl
        ? await listSavedCredentialsForServer(serverBaseUrl)
        : await listSavedCredentials()
      setList(next)
      onListChangeRef.current?.(next)
    } finally {
      setLoading(false)
    }
  }, [serverBaseUrl])

  React.useEffect(() => {
    void reload()
  }, [reload])

  React.useEffect(() => {
    const handler = () => void reload()
    window.addEventListener("owl:saved-credentials-changed", handler)
    return () =>
      window.removeEventListener("owl:saved-credentials-changed", handler)
  }, [reload])

  const startEdit = (item: SavedCredential, event: React.MouseEvent) => {
    event.stopPropagation()
    setEditingId(item.id)
    setEditIdentifier(item.identifier)
    setEditPassword(item.password)
  }

  const cancelEdit = (event?: React.MouseEvent) => {
    event?.stopPropagation()
    setEditingId(null)
    setEditIdentifier("")
    setEditPassword("")
  }

  const saveEdit = async (id: string, event: React.MouseEvent) => {
    event.stopPropagation()
    if (!editIdentifier.trim() || !editPassword) {
      toast.error("账号和密码不能为空")
      return
    }
    setBusyId(id)
    try {
      await updateSavedCredential(id, {
        identifier: editIdentifier.trim(),
        password: editPassword,
      })
      toast.success("已更新记住的账号")
      setEditingId(null)
      await reload()
      window.dispatchEvent(new Event("owl:saved-credentials-changed"))
    } catch {
      toast.error("更新失败")
    } finally {
      setBusyId(null)
    }
  }

  const remove = async (id: string, event: React.MouseEvent) => {
    event.stopPropagation()
    const ok = window.confirm("确定删除这条记住的账号密码？")
    if (!ok) return
    setBusyId(id)
    try {
      await deleteSavedCredential(id)
      toast.success("已删除")
      if (editingId === id) cancelEdit()
      await reload()
      window.dispatchEvent(new Event("owl:saved-credentials-changed"))
    } catch {
      toast.error("删除失败")
    } finally {
      setBusyId(null)
    }
  }

  const handleActivate = async (item: SavedCredential) => {
    if (disabled || busyId) return
    if (action === "fill") {
      onSelect?.(item)
      return
    }
    setBusyId(item.id)
    try {
      await loginWithSavedCredential(item)
      toast.success(`已登录 ${item.identifier}`)
      await onLoginSuccess?.()
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "登录失败，请检查网络或密码",
      )
    } finally {
      setBusyId(null)
    }
  }

  const showAllServers = !serverBaseUrl

  if (loading) {
    return (
      <p className={cn("text-xs text-muted-foreground", className)}>
        正在加载已记住的账号…
      </p>
    )
  }

  if (list.length === 0) {
    if (!asCard) return null
    return (
      <div
        className={cn(
          "rounded-2xl bg-zinc-100 px-6 py-5 text-center shadow-none dark:bg-zinc-800/90",
          className,
        )}
      >
        <p className="text-sm text-muted-foreground">
          暂无已记住的账号。登录时勾选「记住账号密码」后将显示在此，支持一键登录。
        </p>
      </div>
    )
  }

  const listBody = (
    <>
      <p className="mb-2 text-xs font-medium text-muted-foreground">
        {action === "login"
          ? "已记住的账号（点击即可登录，可编辑或删除）"
          : "已记住的账号（点击填入，可编辑或删除）"}
      </p>
      <ul
        className={cn(
          "flex max-h-64 flex-col gap-1 overflow-y-auto rounded-xl bg-zinc-200/50 p-1 dark:bg-zinc-900/40",
          asCard && "max-h-80",
        )}
      >
        {list.map((item) => {
          const isSelected = selectedId === item.id
          const isEditing = editingId === item.id
          const busy = busyId === item.id
          const serverLabel = credentialServerLabel(item)
          const serverHost = credentialServerHost(item)
          return (
            <li key={item.id}>
              {isEditing ? (
                <div className="flex flex-col gap-2 rounded-lg bg-zinc-100 p-2 dark:bg-zinc-800/80">
                  <p className="truncate text-[11px] text-muted-foreground">
                    <ServerIcon className="mr-0.5 inline size-3 align-text-bottom" />
                    {serverLabel}
                    {serverLabel !== serverHost ? ` · ${serverHost}` : ""}
                  </p>
                  <div className="space-y-1">
                    <Label htmlFor={`edit-id-${item.id}`} className="text-xs">
                      账号
                    </Label>
                    <Input
                      id={`edit-id-${item.id}`}
                      value={editIdentifier}
                      onChange={(e) => setEditIdentifier(e.target.value)}
                      disabled={busy}
                      className="h-8 border-0 bg-background/80 shadow-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`edit-pw-${item.id}`} className="text-xs">
                      密码
                    </Label>
                    <Input
                      id={`edit-pw-${item.id}`}
                      type="password"
                      value={editPassword}
                      onChange={(e) => setEditPassword(e.target.value)}
                      disabled={busy}
                      className="h-8 border-0 bg-background/80 shadow-none"
                    />
                  </div>
                  <div className="flex justify-end gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={cancelEdit}
                    >
                      <XIcon className="size-3.5" />
                      取消
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={busy}
                      onClick={(e) => void saveEdit(item.id, e)}
                    >
                      <CheckIcon className="size-3.5" />
                      保存
                    </Button>
                  </div>
                </div>
              ) : (
                <div
                  className={cn(
                    "flex items-center gap-1 rounded-lg px-1.5 py-1",
                    isSelected && "bg-primary/10",
                  )}
                >
                  <button
                    type="button"
                    disabled={busy || disabled}
                    onClick={() => void handleActivate(item)}
                    className="min-w-0 flex-1 rounded-md px-2 py-1.5 text-left outline-none transition-colors hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50 dark:hover:bg-zinc-800/80"
                  >
                    <span className="flex items-center gap-1.5">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {item.identifier}
                      </span>
                      {busy && action === "login" ? (
                        <Loader2Icon className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
                      ) : action === "login" ? (
                        <span className="shrink-0 text-[11px] font-medium text-primary">
                          登录
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-0.5 flex min-w-0 items-center gap-1 truncate text-[11px] text-muted-foreground">
                      <ServerIcon className="size-3 shrink-0 opacity-70" />
                      <span className="truncate">
                        {showAllServers || serverLabel !== serverHost
                          ? `${serverLabel}${serverLabel !== serverHost ? ` · ${serverHost}` : ""}`
                          : serverHost}
                      </span>
                    </span>
                  </button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    title="编辑账号密码"
                    disabled={busy || disabled}
                    className="size-7 shrink-0 text-muted-foreground"
                    onClick={(e) => startEdit(item, e)}
                  >
                    <PencilIcon className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    title="删除"
                    disabled={busy || disabled}
                    className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={(e) => void remove(item.id, e)}
                  >
                    <Trash2Icon className="size-3.5" />
                  </Button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </>
  )

  if (asCard) {
    return (
      <div
        className={cn(
          "w-full max-w-md rounded-2xl bg-zinc-100 px-5 py-4 shadow-none dark:bg-zinc-800/90",
          className,
        )}
      >
        {listBody}
      </div>
    )
  }

  return <div className={cn("flex flex-col", className)}>{listBody}</div>
}

/** 登录成功后通知列表刷新 */
export function notifySavedCredentialsChanged() {
  if (typeof window === "undefined") return
  window.dispatchEvent(new Event("owl:saved-credentials-changed"))
}
