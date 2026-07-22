// 服务器设置 · 角色编辑器（docs 18 §5.2 / docs 04 FR-01–07）
// 左列表（拖拽排序）+ 右编辑（显示 / 权限 / 成员）。
// 层级与防提权：本地灰置 + 服务端 403 裁决。

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import {
  EyeIcon,
  GripVerticalIcon,
  LockIcon,
  PaletteIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react"
import { toast } from "sonner"

import {
  RoleStyleEditor,
  roleStyleToIconResolved,
  roleStyleToResolved,
} from "~/components/guild-settings/role-style-editor"
import { RoleStyleDot, StyledDisplayName } from "~/components/styled-name"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { Switch } from "~/components/ui/switch"
import {
  assignMemberRole,
  createRole,
  deleteRole,
  parseRoleStyle,
  removeMemberRole,
  reorderRoles,
  updateRole,
  updateRoleStyle,
  type RoleStyle,
} from "~/lib/api/guilds"
import { ApiError } from "~/lib/api/http"
import type { GuildMember, Role } from "~/lib/api/types"
import { useChannelsStore } from "~/stores/channels"
import { useUIStore } from "~/stores/ui"
import { useViewAsStore, viewAsFromRole } from "~/stores/view-as"
import {
  PERMISSION_GROUPS,
  PERMISSION_METAS,
  maskHas,
  maskToggle,
  permissionsToJsonNumber,
} from "~/lib/permission-labels"
import {
  Permissions,
  hasPermission,
} from "~/lib/permissions"
import { cn } from "~/lib/utils"
import { useAuthStore } from "~/stores/auth"
import { useMembersStore } from "~/stores/members"
import {
  rolePermissionMask,
  useRolesStore,
} from "~/stores/roles"

// Zustand selector 必须返回稳定引用（避免 ?? [] 每次新建导致无限重渲染）
const EMPTY_ROLES: Role[] = []
const EMPTY_MEMBERS: GuildMember[] = []

type TabId = "display" | "permissions" | "members"

const PRESET_COLORS = [
  "#ed4245",
  "#e67e22",
  "#f1c40f",
  "#2ecc71",
  "#1abc9c",
  "#3498db",
  "#9b59b6",
  "#e91e63",
  "#95a5a6",
  "#607d8b",
]

function memberLabel(m: GuildMember): string {
  return m.nickname?.trim() || m.display_name?.trim() || m.username
}

/** 操作者最高角色 position（无额外角色 = 0） */
function selfHighestPosition(
  selfMember: GuildMember | undefined,
  roles: Role[],
): number {
  if (!selfMember) return 0
  let max = 0
  for (const role of roles) {
    if (role.is_everyone) continue
    if (selfMember.role_ids.includes(role.id) && role.position > max) {
      max = role.position
    }
  }
  return max
}

function canEditRole(
  role: Role,
  opts: { isOwner: boolean; isAdmin: boolean; highest: number },
): boolean {
  if (opts.isOwner || opts.isAdmin) return true
  if (role.is_everyone) return false
  return opts.highest > role.position
}

function canDragRole(
  role: Role,
  opts: { isOwner: boolean; isAdmin: boolean; highest: number },
): boolean {
  if (role.is_everyone || role.managed) return false
  return canEditRole(role, opts)
}

function SortableRoleRow({
  role,
  selected,
  locked,
  draggable,
  onSelect,
}: {
  role: Role
  selected: boolean
  locked: boolean
  draggable: boolean
  onSelect: () => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: role.id, disabled: !draggable })

  const parsedStyle = parseRoleStyle(role.style)
  const nameStyle = parsedStyle.type
    ? roleStyleToResolved(parsedStyle)
    : role.color
      ? {
          kind: "solid" as const,
          colors: [role.color],
          angle: 90,
          shape: "circle",
          animated: false,
          speed: 4,
          primaryColor: role.color,
        }
      : null
  const iconStyle = parsedStyle.type
    ? roleStyleToIconResolved(parsedStyle)
    : nameStyle

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={cn(
        "flex items-center gap-1 rounded-xl px-1.5 py-1.5 text-sm text-foreground",
        // touch-none：避免触控滚动抢占 dnd-kit 拖拽
        draggable && "touch-none",
        selected
          ? "bg-black/[0.06] font-medium dark:bg-white/[0.1]"
          : "hover:bg-black/[0.04] dark:hover:bg-white/[0.06]",
        isDragging && "z-10 opacity-70 shadow-md ring-1 ring-black/5",
        locked && "opacity-70",
      )}
    >
      <button
        type="button"
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded text-foreground/45",
          draggable
            ? "cursor-grab touch-none active:cursor-grabbing"
            : "cursor-default opacity-40",
        )}
        // 勿用 disabled：部分浏览器会阻断 pointer 事件导致无法拖
        aria-disabled={!draggable}
        aria-label="拖拽排序"
        {...(draggable ? { ...attributes, ...listeners } : {})}
        onClick={(event) => {
          // 防止拖动手柄点击冒泡选中
          event.stopPropagation()
        }}
      >
        {locked && !draggable ? (
          <LockIcon className="size-3.5" />
        ) : (
          <GripVerticalIcon className="size-3.5" />
        )}
      </button>
      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        <RoleStyleDot
          style={iconStyle}
          fallbackColor={role.color}
          className="size-3"
        />
        <StyledDisplayName
          name={role.name}
          style={nameStyle}
          className="truncate text-sm font-normal"
        />
        {role.managed && (
          <span className="shrink-0 text-[10px] text-foreground/45">内置</span>
        )}
      </button>
    </div>
  )
}

export function RolesSection({
  guildId,
  perms,
  isOwner,
  dirty,
  setDirty,
}: {
  guildId: string
  perms: bigint
  isOwner: boolean
  dirty: boolean
  setDirty: (next: boolean) => void
}) {
  const roles = useRolesStore((s) => s.byGuild[guildId] ?? EMPTY_ROLES)
  const members = useMembersStore((s) => s.byGuild[guildId] ?? EMPTY_MEMBERS)
  const selfId = useAuthStore((s) => s.user?.id)
  const selfMember = members.find((m) => m.user_id === selfId)

  const isAdmin = hasPermission(perms, Permissions.ADMINISTRATOR)
  const highest = selfHighestPosition(selfMember, roles)
  const hierarchy = useMemo(
    () => ({ isOwner, isAdmin, highest }),
    [isOwner, isAdmin, highest],
  )

  // 视觉顺序：position 高 → 低；@everyone 永远垫底
  const visualRoles = useMemo(() => {
    const everyone = roles.filter((r) => r.is_everyone)
    const rest = roles
      .filter((r) => !r.is_everyone)
      .slice()
      .sort((a, b) => b.position - a.position || a.id.localeCompare(b.id))
    return [...rest, ...everyone]
  }, [roles])

  /** 可拖拽子集（排序算法用） */
  const sortableIds = useMemo(
    () => visualRoles.filter((r) => canDragRole(r, hierarchy)).map((r) => r.id),
    [visualRoles, hierarchy],
  )
  /** SortableContext 必须包含所有 useSortable 的 id，否则拖拽失效 */
  const allRoleIds = useMemo(
    () => visualRoles.map((r) => r.id),
    [visualRoles],
  )

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [tab, setTab] = useState<TabId>("display")
  const [creating, setCreating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [reordering, setReordering] = useState(false)

  // 草稿
  const [name, setName] = useState("")
  const [color, setColor] = useState("")
  const [hoist, setHoist] = useState(false)
  const [mentionable, setMentionable] = useState(false)
  const [permMask, setPermMask] = useState(0n)

  const selected = roles.find((r) => r.id === selectedId) ?? null

  // 默认选中第一个可编辑或列表首项
  useEffect(() => {
    if (!roles.length) {
      setSelectedId(null)
      return
    }
    if (selectedId && roles.some((r) => r.id === selectedId)) return
    const preferred =
      visualRoles.find((r) => canEditRole(r, hierarchy) && !r.is_everyone) ??
      visualRoles[0]
    setSelectedId(preferred?.id ?? null)
  }, [roles, selectedId, visualRoles, hierarchy])

  // 选中变化 / 远端刷新且未脏：灌入草稿
  useEffect(() => {
    if (!selected || dirty) return
    setName(selected.name)
    setColor(selected.color ?? "")
    setHoist(!!selected.hoist)
    setMentionable(!!selected.mentionable)
    setPermMask(rolePermissionMask(selected))
  }, [selected, dirty])

  const editable = selected
    ? canEditRole(selected, hierarchy)
    : false
  const permsLocked = selected?.managed === true
  const grantCeiling =
    isOwner || isAdmin ? ~0n : perms // 可授予的位不超过自身

  const markDirtyFrom = useCallback(
    (next: {
      name?: string
      color?: string
      hoist?: boolean
      mentionable?: boolean
      permMask?: bigint
    }) => {
      if (!selected) return
      const n = next.name ?? name
      const c = next.color ?? color
      const h = next.hoist ?? hoist
      const m = next.mentionable ?? mentionable
      const p = next.permMask ?? permMask
      const baseMask = rolePermissionMask(selected)
      setDirty(
        n !== selected.name ||
          c !== (selected.color ?? "") ||
          h !== !!selected.hoist ||
          m !== !!selected.mentionable ||
          p !== baseMask,
      )
    },
    [selected, name, color, hoist, mentionable, permMask, setDirty],
  )

  const resetDraft = () => {
    if (!selected) return
    setName(selected.name)
    setColor(selected.color ?? "")
    setHoist(!!selected.hoist)
    setMentionable(!!selected.mentionable)
    setPermMask(rolePermissionMask(selected))
    setDirty(false)
  }

  const save = async () => {
    if (!selected) return
    const trimmed = name.trim()
    if (!trimmed || trimmed.length > 100) {
      toast.error("角色名需 1–100 字符")
      return
    }
    if (color && !/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color)) {
      toast.error("颜色需为 #RGB 或 #RRGGBB")
      return
    }
    setSaving(true)
    try {
      const updated = await updateRole(guildId, selected.id, {
        name: trimmed,
        permissions: permissionsToJsonNumber(permMask),
        position: selected.is_everyone ? 0 : selected.position,
        color,
        hoist,
        mentionable,
      })
      // 乐观对齐本地缓存（Gateway 也会重拉）
      const list = useRolesStore.getState().byGuild[guildId] ?? []
      useRolesStore.setState({
        byGuild: {
          ...useRolesStore.getState().byGuild,
          [guildId]: list.map((r) => (r.id === updated.id ? updated : r)),
        },
      })
      setDirty(false)
      toast.success("角色已保存")
    } catch (error) {
      toast.error(
        error instanceof ApiError
          ? error.message
          : "保存失败",
      )
    } finally {
      setSaving(false)
    }
  }

  const onCreate = async () => {
    setCreating(true)
    try {
      // 插入到自身最高角色之下（docs 04 FR-02）；所有者取当前最大 + 1
      const maxPos = roles.reduce(
        (acc, r) => (r.is_everyone ? acc : Math.max(acc, r.position)),
        0,
      )
      let position = 1
      if (isOwner || isAdmin) {
        position = Math.max(1, maxPos + 1)
      } else {
        position = Math.max(1, highest - 1)
      }
      const created = await createRole(guildId, {
        name: "新角色",
        permissions: 0,
        position,
        color: PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)],
        hoist: false,
        mentionable: false,
      })
      await useRolesStore.getState().fetchRoles(guildId)
      setSelectedId(created.id)
      setTab("display")
      setDirty(false)
      toast.success("已创建角色")
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : "创建失败",
      )
    } finally {
      setCreating(false)
    }
  }

  const onDelete = async () => {
    if (!selected || selected.is_everyone || selected.managed) return
    const ok = window.confirm(
      `确定删除角色「${selected.name}」？持有该角色的成员将失去它。`,
    )
    if (!ok) return
    try {
      await deleteRole(guildId, selected.id)
      setDirty(false)
      setSelectedId(null)
      await useRolesStore.getState().fetchRoles(guildId)
      toast.success("角色已删除")
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : "删除失败",
      )
    }
  }

  const sensors = useSensors(
    useSensor(PointerSensor, {
      // 略大于点击距离，避免误触；与频道树一致
      activationConstraint: { distance: 8 },
    }),
  )

  const onDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    if (!sortableIds.includes(String(active.id)) || !sortableIds.includes(String(over.id))) {
      return
    }

    // 在可拖子集中换位，再映射回完整视觉列表
    const oldIndex = sortableIds.indexOf(String(active.id))
    const newIndex = sortableIds.indexOf(String(over.id))
    if (oldIndex < 0 || newIndex < 0) return
    const nextSortable = arrayMove(sortableIds, oldIndex, newIndex)

    // 用原 position 槽位（升序）重新分配给新顺序（高→低对应高 position）
    const movable = visualRoles.filter((r) => canDragRole(r, hierarchy))
    const slots = movable
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((r) => r.position)
    const items = nextSortable.map((id, i) => ({
      id,
      // nextSortable 是高→低，i=0 应得最高槽
      position: slots[slots.length - 1 - i] ?? 1,
    }))

    // 乐观更新本地
    const byId = new Map(roles.map((r) => [r.id, r]))
    const optimistic = roles.map((r) => {
      const hit = items.find((it) => it.id === r.id)
      return hit ? { ...r, position: hit.position } : r
    })
    useRolesStore.setState({
      byGuild: {
        ...useRolesStore.getState().byGuild,
        [guildId]: optimistic,
      },
    })

    setReordering(true)
    try {
      await reorderRoles(guildId, items)
    } catch (error) {
      // 回滚
      useRolesStore.setState({
        byGuild: {
          ...useRolesStore.getState().byGuild,
          [guildId]: Array.from(byId.values()),
        },
      })
      toast.error(
        error instanceof ApiError ? error.message : "排序失败",
      )
    } finally {
      setReordering(false)
      // 与服务端对齐
      void useRolesStore.getState().fetchRoles(guildId)
    }
  }

  // 成员 tab：该角色下的成员
  const roleMembers = useMemo(() => {
    if (!selected || selected.is_everyone) return members
    return members.filter((m) => m.role_ids.includes(selected.id))
  }, [members, selected])

  const [memberQuery, setMemberQuery] = useState("")
  const filteredRoleMembers = useMemo(() => {
    const q = memberQuery.trim().toLowerCase()
    if (!q) return roleMembers
    return roleMembers.filter((m) =>
      [m.nickname, m.display_name, m.username]
        .filter(Boolean)
        .some((n) => n!.toLowerCase().includes(q)),
    )
  }, [roleMembers, memberQuery])

  // 可添加的成员（不在该角色、且可被治理）
  const addableMembers = useMemo(() => {
    if (!selected || selected.is_everyone || selected.managed) return []
    if (!editable) return []
    return members.filter((m) => !m.role_ids.includes(selected.id) && !m.is_owner)
  }, [members, selected, editable])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">角色</h2>
        <Button
          size="sm"
          disabled={creating || (!isOwner && !isAdmin && highest < 2)}
          onClick={() => void onCreate()}
        >
          <PlusIcon className="size-4" />
          创建角色
        </Button>
      </div>

      <div className="flex min-h-[28rem] gap-4 rounded-xl border">
        {/* 左列表 */}
        <div className="flex w-52 shrink-0 flex-col border-r p-2">
          <p className="mb-1 px-1.5 text-[10px] font-semibold tracking-wider text-foreground/45 uppercase">
            角色 · {roles.length}
          </p>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={(e) => void onDragEnd(e)}
          >
            <SortableContext
              items={allRoleIds}
              strategy={verticalListSortingStrategy}
            >
              <div
                className={cn(
                  "flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto",
                  reordering && "pointer-events-none opacity-70",
                )}
              >
                {visualRoles.map((role) => {
                  const drag = canDragRole(role, hierarchy)
                  const edit = canEditRole(role, hierarchy)
                  return (
                    <SortableRoleRow
                      key={role.id}
                      role={role}
                      selected={role.id === selectedId}
                      locked={!edit}
                      draggable={drag}
                      onSelect={() => {
                        if (dirty && role.id !== selectedId) {
                          const ok = window.confirm(
                            "有未保存的更改，切换角色将放弃，继续吗？",
                          )
                          if (!ok) return
                          setDirty(false)
                        }
                        setSelectedId(role.id)
                      }}
                    />
                  )
                })}
              </div>
            </SortableContext>
          </DndContext>
        </div>

        {/* 右编辑 */}
        <div className="flex min-w-0 flex-1 flex-col p-4">
          {!selected ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              选择或创建一个角色
            </p>
          ) : (
            <>
              <div className="mb-4 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <span className="flex min-w-0 items-center gap-2">
                    <RoleStyleDot
                      style={
                        parseRoleStyle(selected.style).type
                          ? roleStyleToIconResolved(
                              parseRoleStyle(selected.style),
                            )
                          : selected.color
                            ? {
                                kind: "solid",
                                colors: [selected.color],
                                angle: 90,
                                shape: "circle",
                                animated: false,
                                speed: 4,
                                primaryColor: selected.color,
                              }
                            : null
                      }
                      fallbackColor={selected.color}
                      className="size-3.5"
                    />
                    <StyledDisplayName
                      name={selected.name}
                      style={
                        parseRoleStyle(selected.style).type
                          ? roleStyleToResolved(parseRoleStyle(selected.style))
                          : selected.color
                            ? {
                                kind: "solid",
                                colors: [selected.color],
                                angle: 90,
                                shape: "circle",
                                animated: false,
                                speed: 4,
                                primaryColor: selected.color,
                              }
                            : null
                      }
                      className="truncate text-base font-semibold"
                    />
                  </span>
                  {!editable && (
                    <p className="text-xs text-muted-foreground">
                      层级不足，此角色只读
                    </p>
                  )}
                  {selected.managed && (
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      内置管理员角色：权限与层级已锁定，可改名称与显示
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    title="以该角色视角预览频道列表（docs 04）"
                    onClick={() => {
                      const channelIds = (
                        useChannelsStore.getState().byGuild[guildId] ?? []
                      ).map((c) => c.id)
                      void useViewAsStore
                        .getState()
                        .start(guildId, viewAsFromRole(selected), channelIds)
                        .then(() => {
                          useUIStore.getState().closeGuildAdmin()
                          toast.success(
                            `正在以「${selected.is_everyone ? "@everyone" : selected.name}」视角查看`,
                          )
                        })
                    }}
                  >
                    <EyeIcon className="size-4" />
                    以身份查看
                  </Button>
                  {editable && !selected.is_everyone && !selected.managed && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      onClick={() => void onDelete()}
                    >
                      <Trash2Icon className="size-4" />
                      删除
                    </Button>
                  )}
                </div>
              </div>

              {/* tabs */}
              <div className="mb-4 flex gap-1 border-b">
                {(
                  [
                    ["display", "显示"],
                    ["permissions", "权限"],
                    ["members", "成员"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setTab(id)}
                    className={cn(
                      "px-3 py-1.5 text-sm transition-colors",
                      tab === id
                        ? "border-b-2 border-primary font-medium text-foreground"
                        : "text-foreground/55 hover:text-foreground",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {tab === "display" && (
                <div className="flex flex-col gap-4">
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-muted-foreground">
                      角色名称
                    </span>
                    <Input
                      value={name}
                      maxLength={100}
                      disabled={!editable}
                      onChange={(e) => {
                        setName(e.target.value)
                        markDirtyFrom({ name: e.target.value })
                      }}
                    />
                  </label>
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-muted-foreground">
                      角色颜色
                    </span>
                    <div className="flex flex-wrap items-center gap-2">
                      {PRESET_COLORS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          disabled={!editable}
                          aria-label={c}
                          onClick={() => {
                            setColor(c)
                            markDirtyFrom({ color: c })
                          }}
                          className={cn(
                            "size-7 rounded-full border-2",
                            color.toLowerCase() === c
                              ? "border-foreground"
                              : "border-transparent",
                          )}
                          style={{ backgroundColor: c }}
                        />
                      ))}
                      <Input
                        value={color}
                        placeholder="#RRGGBB"
                        maxLength={7}
                        disabled={!editable}
                        className="w-28"
                        onChange={(e) => {
                          setColor(e.target.value)
                          markDirtyFrom({ color: e.target.value })
                        }}
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={!editable || !color}
                        onClick={() => {
                          setColor("")
                          markDirtyFrom({ color: "" })
                        }}
                      >
                        清除
                      </Button>
                    </div>
                  </div>
                  <label className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
                    <div>
                      <p className="text-sm">在成员列表中单独显示</p>
                      <p className="text-xs text-muted-foreground">
                        开启后，拥有此角色的成员会按角色分组显示
                      </p>
                    </div>
                    <Switch
                      checked={hoist}
                      disabled={!editable}
                      onCheckedChange={(checked) => {
                        setHoist(checked)
                        markDirtyFrom({ hoist: checked })
                      }}
                    />
                  </label>
                  <label className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
                    <div>
                      <p className="text-sm">允许任何人 @提及此角色</p>
                      <p className="text-xs text-muted-foreground">
                        关闭后仅持有「提及 @everyone」权限者可 @
                      </p>
                    </div>
                    <Switch
                      checked={mentionable}
                      disabled={!editable}
                      onCheckedChange={(checked) => {
                        setMentionable(checked)
                        markDirtyFrom({ mentionable: checked })
                      }}
                    />
                  </label>

                  {/* 用户名样式：纯色 / 线性 / 径向渐变（独立保存） */}
                  <RoleNameStyleSection
                    key={`style-${selected.id}`}
                    guildId={guildId}
                    role={selected}
                    editable={editable}
                    previewName={name.trim() || selected.name}
                  />
                </div>
              )}

              {tab === "permissions" && (
                <div className="flex flex-col gap-5 overflow-y-auto pr-1">
                  {permsLocked && (
                    <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                      内置角色的权限位已锁定，不可修改。
                    </p>
                  )}
                  {PERMISSION_GROUPS.map((group) => {
                    const items = PERMISSION_METAS.filter(
                      (m) => m.group === group.id,
                    )
                    if (!items.length) return null
                    return (
                      <div key={group.id} className="flex flex-col gap-2">
                        <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                          {group.label}
                        </p>
                        <div className="flex flex-col divide-y rounded-lg border">
                          {items.map((meta) => {
                            const on = maskHas(permMask, meta.bit)
                            const canGrantBit =
                              isOwner ||
                              isAdmin ||
                              maskHas(grantCeiling, meta.bit)
                            const disabled =
                              !editable || permsLocked || !canGrantBit
                            return (
                              <label
                                key={meta.name}
                                className={cn(
                                  "flex items-start justify-between gap-3 px-3 py-2.5",
                                  meta.danger && "bg-destructive/5",
                                  disabled && "opacity-60",
                                )}
                                title={
                                  !canGrantBit
                                    ? "你不能授予自己没有的权限"
                                    : undefined
                                }
                              >
                                <div className="min-w-0">
                                  <p
                                    className={cn(
                                      "text-sm",
                                      meta.danger && "font-medium text-destructive",
                                    )}
                                  >
                                    {meta.label}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {meta.description}
                                  </p>
                                </div>
                                <Switch
                                  checked={on}
                                  disabled={disabled}
                                  onCheckedChange={(checked) => {
                                    const next = maskToggle(
                                      permMask,
                                      meta.bit,
                                      checked,
                                    )
                                    setPermMask(next)
                                    markDirtyFrom({ permMask: next })
                                  }}
                                />
                              </label>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {tab === "members" && (
                <div className="flex flex-col gap-3">
                  {selected.is_everyone ? (
                    <p className="text-sm text-muted-foreground">
                      @everyone 自动包含全部成员（{members.length} 人），无需手工绑定。
                    </p>
                  ) : (
                    <>
                      <div className="flex gap-2">
                        <Input
                          value={memberQuery}
                          placeholder="搜索已有此角色的成员"
                          onChange={(e) => setMemberQuery(e.target.value)}
                        />
                      </div>
                      {editable && addableMembers.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          <select
                            className="h-9 max-w-xs rounded-md border bg-transparent px-2 text-sm"
                            defaultValue=""
                            onChange={(e) => {
                              const memberId = e.target.value
                              e.target.value = ""
                              if (!memberId || !selected) return
                              const member = members.find((m) => m.id === memberId)
                              if (!member) return
                              void assignMemberRole(guildId, member.id, selected.id)
                                .then(() => {
                                  useMembersStore.getState().upsertMember(guildId, {
                                    ...member,
                                    role_ids: [
                                      ...member.role_ids,
                                      selected.id,
                                    ],
                                  })
                                  toast.success(`已将角色授予 ${memberLabel(member)}`)
                                })
                                .catch((error) =>
                                  toast.error(
                                    error instanceof ApiError
                                      ? error.message
                                      : "分配失败",
                                  ),
                                )
                            }}
                          >
                            <option value="" disabled>
                              添加成员…
                            </option>
                            {addableMembers.map((m) => (
                              <option key={m.id} value={m.id}>
                                {memberLabel(m)}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                      <div className="flex flex-col divide-y rounded-lg border">
                        {filteredRoleMembers.map((m) => (
                          <div
                            key={m.user_id}
                            className="flex items-center justify-between gap-2 px-3 py-2"
                          >
                            <div className="min-w-0">
                              <p className="truncate text-sm">{memberLabel(m)}</p>
                              <p className="truncate text-xs text-muted-foreground">
                                @{m.username}
                              </p>
                            </div>
                            {editable &&
                              !selected.managed &&
                              !m.is_owner &&
                              m.user_id !== selfId && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() =>
                                    void removeMemberRole(
                                      guildId,
                                      m.id,
                                      selected.id,
                                    )
                                      .then(() => {
                                        useMembersStore.getState().upsertMember(
                                          guildId,
                                          {
                                            ...m,
                                            role_ids: m.role_ids.filter(
                                              (id) => id !== selected.id,
                                            ),
                                          },
                                        )
                                        toast.success(
                                          `已移除 ${memberLabel(m)} 的此角色`,
                                        )
                                      })
                                      .catch((error) =>
                                        toast.error(
                                          error instanceof ApiError
                                            ? error.message
                                            : "移除失败",
                                        ),
                                      )
                                  }
                                >
                                  移除
                                </Button>
                              )}
                          </div>
                        ))}
                        {filteredRoleMembers.length === 0 && (
                          <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                            暂无成员持有此角色
                          </p>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}

              {dirty && editable && (
                <div className="sticky bottom-0 mt-4 flex items-center justify-between rounded-xl border bg-card px-4 py-3 shadow-lg">
                  <span className="text-sm">小心 — 你有未保存的更改！</span>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={saving}
                      onClick={resetDraft}
                    >
                      重置
                    </Button>
                    <Button
                      size="sm"
                      disabled={saving}
                      onClick={() => void save()}
                    >
                      保存修改
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/** 角色用户名样式（独立 PUT /style，与角色基础字段保存分离） */
function RoleNameStyleSection({
  guildId,
  role,
  editable,
  previewName,
}: {
  guildId: string
  role: Role
  editable: boolean
  previewName: string
}) {
  const [style, setStyle] = useState<RoleStyle>(() => parseRoleStyle(role.style))
  const [saving, setSaving] = useState(false)
  const baseline = useMemo(() => parseRoleStyle(role.style), [role.style])
  const dirty = JSON.stringify(style) !== JSON.stringify(baseline)

  // 远端 role.style 更新且本地未改时同步
  useEffect(() => {
    if (dirty) return
    setStyle(parseRoleStyle(role.style))
  }, [role.id, role.style, dirty])

  const onSave = async () => {
    setSaving(true)
    try {
      const updated = await updateRoleStyle(guildId, role.id, style)
      const list = useRolesStore.getState().byGuild[guildId] ?? []
      useRolesStore.setState({
        byGuild: {
          ...useRolesStore.getState().byGuild,
          [guildId]: list.map((r) => (r.id === updated.id ? updated : r)),
        },
      })
      setStyle(parseRoleStyle(updated.style))
      toast.success("用户名样式已保存")
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : "样式保存失败",
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <fieldset className="rounded-xl border p-4">
      <legend className="flex items-center gap-2 px-1.5">
        <PaletteIcon className="size-3.5 text-muted-foreground" />
        <span className="text-sm font-semibold">用户名样式</span>
        <span className="text-xs text-muted-foreground">
          持有此角色的成员按此渲染名字（最高位角色优先）
        </span>
      </legend>
      <div className="flex flex-col gap-4">
        <RoleStyleEditor
          value={style}
          onChange={setStyle}
          previewText={previewName}
          disabled={!editable}
          guildId={guildId}
          roleId={role.id}
        />
        <div className="flex justify-end gap-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={!editable || !dirty || saving}
            onClick={() => setStyle(baseline)}
          >
            重置
          </Button>
          <Button
            size="sm"
            disabled={!editable || !dirty || saving}
            onClick={() => void onSave()}
          >
            {saving ? "保存中…" : "保存样式"}
          </Button>
        </div>
      </div>
    </fieldset>
  )
}
