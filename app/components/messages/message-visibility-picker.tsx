// 消息可见范围选择：身份组 Tab + 用户多选 Tab（Portal Popover，避免被 composer overflow 裁切）

import { useEffect, useMemo, useState } from "react"
import {
  CheckIcon,
  EyeIcon,
  LockIcon,
  ShieldIcon,
  UsersIcon,
} from "lucide-react"

import type { GuildMember, Role } from "~/lib/api/types"
import {
  nameInitials,
  resolveProfileAssetUrl,
} from "~/lib/user-display"
import { cn } from "~/lib/utils"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "~/components/ui/tabs"

const MAX_VISIBLE_USERS = 20

export type MessageVisibilityPickerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  roles: Role[]
  members: GuildMember[]
  visibleRoleIds: string[]
  visibleUserIds: string[]
  onToggleRole: (roleId: string) => void
  onToggleUser: (userId: string) => void
  onClear: () => void
  /** 频道有默认可见身份组时的提示 */
  channelDefaultRoleCount?: number
  label: string
  /** 触发按钮 title（完整说明） */
  title?: string
  hasRestricted: boolean
  resolveName?: (userId: string) => string
}

export function MessageVisibilityPicker({
  open,
  onOpenChange,
  roles,
  members,
  visibleRoleIds,
  visibleUserIds,
  onToggleRole,
  onToggleUser,
  onClear,
  channelDefaultRoleCount = 0,
  label,
  title,
  hasRestricted,
  resolveName,
}: MessageVisibilityPickerProps) {
  const [tab, setTab] = useState<"roles" | "users">("roles")
  const [memberQuery, setMemberQuery] = useState("")

  useEffect(() => {
    if (!open) {
      setMemberQuery("")
      // 保持上次 tab，便于连续操作；仅清空搜索
    }
  }, [open])

  const selectableRoles = useMemo(
    () =>
      roles
        .filter((role) => !role.is_everyone)
        .slice()
        .sort((a, b) => b.position - a.position),
    [roles],
  )

  const selectableMembers = useMemo(() => {
    const q = memberQuery.trim().toLowerCase()
    const list = members
      .slice()
      .sort((a, b) =>
        (a.nickname || a.display_name || a.username).localeCompare(
          b.nickname || b.display_name || b.username,
          "zh",
        ),
      )
    if (!q) return list
    return list.filter((member) => {
      const name = (
        member.nickname ||
        member.display_name ||
        member.username ||
        ""
      ).toLowerCase()
      return (
        name.includes(q) ||
        member.username.toLowerCase().includes(q) ||
        member.user_id.includes(q)
      )
    })
  }, [members, memberQuery])

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) setMemberQuery("")
      }}
    >
      <PopoverTrigger
        type="button"
        title={
          title ||
          "选择谁能看到这条消息（可按服务器身份组 / 指定用户限定）"
        }
        className={cn(
          "inline-flex max-w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors",
          hasRestricted
            ? "bg-amber-500/15 text-amber-800 hover:bg-amber-500/20 dark:text-amber-200"
            : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
        )}
      >
        {hasRestricted ? (
          <LockIcon className="size-3.5 shrink-0" aria-hidden />
        ) : (
          <EyeIcon className="size-3.5 shrink-0" aria-hidden />
        )}
        <span className="truncate">可见：{label}</span>
      </PopoverTrigger>

      <PopoverContent
        side="top"
        align="end"
        sideOffset={8}
        // 覆盖默认 p-4/gap-4，保证 Tab 布局完整可见
        className="!w-80 !max-w-[min(20rem,calc(100vw-1.5rem))] !gap-0 !rounded-xl !p-0 shadow-xl"
      >
        <div className="flex flex-col">
          <div className="border-b border-border/50 px-3 py-2">
            <p className="text-[11px] leading-snug text-muted-foreground">
              仅自己与勾选范围可见；版主（管理消息）仍可审核
              {channelDefaultRoleCount > 0 ? "；不选则使用频道默认" : ""}
              。身份组与用户可同时勾选。
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              onClear()
              onOpenChange(false)
            }}
            className={cn(
              "flex w-full items-center gap-2 border-b border-border/50 px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted/50",
              !hasRestricted && "bg-muted/70",
            )}
          >
            <EyeIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="flex-1 font-medium">所有人（公开）</span>
            {!hasRestricted && (
              <CheckIcon className="size-3.5 text-primary" />
            )}
          </button>

          <Tabs
            value={tab}
            onValueChange={(value) => {
              if (value === "roles" || value === "users") setTab(value)
            }}
            className="gap-0"
          >
            <div className="border-b border-border/50 px-2 py-2">
              <TabsList
                variant="default"
                className="grid h-9 w-full grid-cols-2 rounded-lg p-0.5"
              >
                <TabsTrigger
                  value="roles"
                  className="rounded-md text-xs data-active:bg-background data-active:text-foreground data-active:shadow-sm"
                >
                  <ShieldIcon className="size-3.5" aria-hidden />
                  身份组
                  {visibleRoleIds.length > 0
                    ? ` · ${visibleRoleIds.length}`
                    : ""}
                </TabsTrigger>
                <TabsTrigger
                  value="users"
                  className="rounded-md text-xs data-active:bg-background data-active:text-foreground data-active:shadow-sm"
                >
                  <UsersIcon className="size-3.5" aria-hidden />
                  用户
                  {visibleUserIds.length > 0
                    ? ` · ${visibleUserIds.length}`
                    : ""}
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent
              value="roles"
              className="m-0 max-h-56 overflow-y-auto overscroll-contain p-1 outline-none"
            >
              {selectableRoles.length === 0 ? (
                <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                  暂无可选身份组
                </p>
              ) : (
                selectableRoles.map((role) => {
                  const selected = visibleRoleIds.includes(role.id)
                  return (
                    <button
                      key={role.id}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onClick={() => onToggleRole(role.id)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted/60",
                        selected && "bg-muted",
                      )}
                    >
                      <span
                        className="size-2.5 shrink-0 rounded-full"
                        style={{
                          backgroundColor:
                            role.color || "var(--muted-foreground)",
                        }}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {role.name}
                      </span>
                      {selected && (
                        <CheckIcon className="size-3.5 shrink-0 text-primary" />
                      )}
                    </button>
                  )
                })
              )}
            </TabsContent>

            <TabsContent
              value="users"
              className="m-0 flex max-h-56 flex-col overflow-hidden p-0 outline-none"
            >
              <div className="shrink-0 border-b border-border/40 px-2 py-1.5">
                <input
                  type="search"
                  value={memberQuery}
                  onChange={(event) => setMemberQuery(event.target.value)}
                  placeholder="搜索成员昵称 / 用户名…"
                  className="h-8 w-full rounded-md border border-border/50 bg-background px-2.5 text-xs outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
                  autoComplete="off"
                />
                {visibleUserIds.length >= MAX_VISIBLE_USERS && (
                  <p className="mt-1 text-[10px] text-amber-700 dark:text-amber-300">
                    已达 {MAX_VISIBLE_USERS} 人上限
                  </p>
                )}
                {visibleUserIds.length > 0 && (
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    已选 {visibleUserIds.length} 人
                    {visibleUserIds.length <= 3
                      ? `：${visibleUserIds
                          .map((id) => {
                            const m = members.find((x) => x.user_id === id)
                            return (
                              m?.nickname ||
                              m?.display_name ||
                              m?.username ||
                              resolveName?.(id) ||
                              id.slice(0, 6)
                            )
                          })
                          .join("、")}`
                      : ""}
                  </p>
                )}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1">
                {selectableMembers.length === 0 ? (
                  <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                    {members.length === 0
                      ? "成员列表为空，请确认已加入服务器"
                      : "无匹配成员"}
                  </p>
                ) : (
                  selectableMembers.map((member) => {
                    const selected = visibleUserIds.includes(member.user_id)
                    const name =
                      member.nickname ||
                      member.display_name ||
                      member.username
                    const avatar = resolveProfileAssetUrl(member.avatar_url)
                    return (
                      <button
                        key={member.user_id}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        disabled={
                          !selected &&
                          visibleUserIds.length >= MAX_VISIBLE_USERS
                        }
                        onClick={() => onToggleUser(member.user_id)}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-40",
                          selected && "bg-muted",
                        )}
                      >
                        {avatar ? (
                          <img
                            src={avatar}
                            alt=""
                            className="size-6 shrink-0 rounded-full object-cover"
                          />
                        ) : (
                          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium">
                            {nameInitials(name)}
                          </span>
                        )}
                        <span className="min-w-0 flex-1 truncate font-medium">
                          {name}
                        </span>
                        <span className="max-w-[5.5rem] shrink-0 truncate text-[10px] text-muted-foreground">
                          @{member.username}
                        </span>
                        {selected && (
                          <CheckIcon className="size-3.5 shrink-0 text-primary" />
                        )}
                      </button>
                    )
                  })
                )}
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </PopoverContent>
    </Popover>
  )
}
