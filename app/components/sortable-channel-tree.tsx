// 可拖拽频道树（类别 + 频道）：管理员 MANAGE_CHANNELS 时可拖排序，
// 释放后 PATCH /guilds/:id/channels 持久化，经 CHANNEL_UPDATE 实时同步。
//
// 设计要点：非拖拽时直接由 store 派生树，不维护会与 useEffect 互踢的本地 order state，
// 避免 Maximum update depth exceeded。

import { useCallback, useMemo, useRef, useState } from "react"
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core"
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { toast } from "sonner"

import {
  CategoryHeader,
  TextChannelItem,
  VoiceChannelItem,
} from "~/components/channel-list-items"
import { reorderChannels } from "~/lib/api/guilds"
import { ApiError } from "~/lib/api/http"
import type { Channel } from "~/lib/api/types"
import {
  buildChannelTree,
  buildReorderPayload,
  moveInList,
  treeToContainers,
  type ChannelTreeNode,
} from "~/lib/channel-tree"
import { hasPermission, Permissions } from "~/lib/permissions"
import { cn } from "~/lib/utils"
import { useAuthStore } from "~/stores/auth"
import { useChannelsStore } from "~/stores/channels"
import { useMembersStore } from "~/stores/members"
import { memberGuildPermissions, useRolesStore } from "~/stores/roles"

const EMPTY_CHANNELS: Channel[] = []
const EMPTY_IDS: string[] = []

const pointerSensorOptions = { activationConstraint: { distance: 6 } }

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.message) return error.message
  return fallback
}

type Containers = {
  rootOrder: string[]
  childrenByCategory: Record<string, string[]>
}

function SortableShell({
  id,
  disabled,
  children,
}: {
  id: string
  disabled?: boolean
  children: React.ReactNode
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled })

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      // 整卡可拖：listeners 绑在外壳上；PointerSensor distance:6 保证点击/右键菜单仍可用
      className={cn(
        "relative w-full touch-none",
        !disabled && "cursor-grab active:cursor-grabbing",
        isDragging && "z-20 opacity-60",
      )}
      {...(disabled ? {} : { ...attributes, ...listeners })}
    >
      {children}
    </div>
  )
}

function buildDisplayTree(
  rootOrder: string[],
  childrenByCategory: Record<string, string[]>,
  channelById: Map<string, Channel>,
): ChannelTreeNode[] {
  const nodes: ChannelTreeNode[] = []
  for (const id of rootOrder) {
    const channel = channelById.get(id)
    if (!channel) continue
    if (channel.type === "CATEGORY") {
      const kids = (childrenByCategory[id] ?? EMPTY_IDS)
        .map((cid) => channelById.get(cid))
        .filter((c): c is Channel => Boolean(c))
      nodes.push({ kind: "category", channel, children: kids })
    } else {
      nodes.push({ kind: "channel", channel })
    }
  }
  return nodes
}

export function SortableChannelTree({ guildId }: { guildId: string }) {
  const channels = useChannelsStore(
    (s) => s.byGuild[guildId] ?? EMPTY_CHANNELS,
  )
  const selfId = useAuthStore((s) => s.user?.id)
  const systemAdmin = useAuthStore((s) => s.user?.system_admin)
  const self = useMembersStore((s) =>
    s.byGuild[guildId]?.find((m) => m.user_id === selfId),
  )
  const roles = useRolesStore((s) => s.byGuild[guildId])

  const canReorder = useMemo(() => {
    if (systemAdmin || self?.is_owner) return true
    return hasPermission(
      memberGuildPermissions(self, roles),
      Permissions.MANAGE_CHANNELS,
    )
  }, [systemAdmin, self, roles])

  const tree = useMemo(() => buildChannelTree(channels), [channels])
  const baseContainers = useMemo(() => treeToContainers(tree), [tree])

  const channelById = useMemo(() => {
    const map = new Map<string, Channel>()
    for (const c of channels) map.set(c.id, c)
    return map
  }, [channels])

  // 仅拖拽期间使用本地覆盖；平时完全由 store 派生 → 无 useEffect 同步
  const [dragOverride, setDragOverride] = useState<Containers | null>(null)
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null)
  const [saving, setSaving] = useState(false)
  /** 折叠的类别 id 集合（本地 UI 状态，不落库） */
  const [collapsedIds, setCollapsedIds] = useState<Record<string, boolean>>({})

  const containers: Containers = dragOverride ?? baseContainers
  const containersRef = useRef(containers)
  containersRef.current = containers

  const sensors = useSensors(useSensor(PointerSensor, pointerSensorOptions))

  const findContainer = useCallback(
    (
      id: string,
      root = containersRef.current.rootOrder,
      children = containersRef.current.childrenByCategory,
    ): string | null => {
      if (root.includes(id)) return "root"
      for (const [catId, kids] of Object.entries(children)) {
        if (kids.includes(id)) return catId
      }
      // 类别标题也可作为容器 id
      if (children[id] !== undefined || channelById.get(id)?.type === "CATEGORY") {
        return id
      }
      return null
    },
    [channelById],
  )

  const commit = useCallback(
    async (next: Containers) => {
      const items = buildReorderPayload(
        next.rootOrder,
        next.childrenByCategory,
        channelById,
      )
      if (items.length === 0) return
      const prev = useChannelsStore.getState().byGuild[guildId] ?? []
      useChannelsStore.getState().applyReorder(guildId, items)
      setSaving(true)
      try {
        await reorderChannels(guildId, items)
      } catch (error) {
        useChannelsStore.getState().setChannels(guildId, prev)
        toast.error(errorMessage(error, "保存排序失败，已恢复原顺序"))
      } finally {
        setSaving(false)
      }
    },
    [channelById, guildId],
  )

  const onDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id)
    // 开始拖拽时拍快照，之后只改本地覆盖
    setDragOverride({
      rootOrder: [...baseContainers.rootOrder],
      childrenByCategory: Object.fromEntries(
        Object.entries(baseContainers.childrenByCategory).map(([k, v]) => [
          k,
          [...v],
        ]),
      ),
    })
  }

  const onDragOver = (event: DragOverEvent) => {
    const { active, over } = event
    if (!over || !dragOverride) return
    const activeStr = String(active.id)
    const overStr = String(over.id)
    if (activeStr === overStr) return

    const { rootOrder: root, childrenByCategory: children } =
      containersRef.current
    const activeContainer = findContainer(activeStr, root, children)
    let overContainer = findContainer(overStr, root, children)

    const overChannel = channelById.get(overStr)
    if (overChannel?.type === "CATEGORY") overContainer = overStr

    if (!activeContainer || !overContainer) return
    if (activeContainer === overContainer) return

    const activeChannel = channelById.get(activeStr)
    if (!activeChannel || activeChannel.type === "CATEGORY") return

    let nextRoot = root.filter((id) => id !== activeStr)
    const nextChildren: Record<string, string[]> = {}
    for (const [k, v] of Object.entries(children)) {
      nextChildren[k] = v.filter((id) => id !== activeStr)
    }
    // 确保目标类别有条目
    if (overContainer !== "root" && !nextChildren[overContainer]) {
      nextChildren[overContainer] = []
    }

    if (overContainer === "root") {
      const overIndex = nextRoot.indexOf(overStr)
      nextRoot = nextRoot.slice()
      nextRoot.splice(overIndex < 0 ? nextRoot.length : overIndex, 0, activeStr)
    } else {
      const list = (nextChildren[overContainer] ?? []).slice()
      if (overStr === overContainer) {
        list.push(activeStr)
      } else {
        const overIndex = list.indexOf(overStr)
        list.splice(overIndex < 0 ? list.length : overIndex, 0, activeStr)
      }
      nextChildren[overContainer] = list
    }

    const next = { rootOrder: nextRoot, childrenByCategory: nextChildren }
    containersRef.current = next
    setDragOverride(next)
  }

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    setActiveId(null)

    const snapshot = containersRef.current
    setDragOverride(null)

    if (!over || !dragOverride) return

    const activeStr = String(active.id)
    const overStr = String(over.id)

    let nextRoot = snapshot.rootOrder
    let nextChildren = snapshot.childrenByCategory

    const activeContainer = findContainer(activeStr, nextRoot, nextChildren)
    let overContainer = findContainer(overStr, nextRoot, nextChildren)
    if (channelById.get(overStr)?.type === "CATEGORY") overContainer = overStr

    if (
      activeContainer &&
      overContainer &&
      activeContainer === overContainer &&
      activeStr !== overStr
    ) {
      if (activeContainer === "root") {
        nextRoot = moveInList(nextRoot, activeStr, overStr)
      } else {
        nextChildren = {
          ...nextChildren,
          [activeContainer]: moveInList(
            nextChildren[activeContainer] ?? [],
            activeStr,
            overStr,
          ),
        }
      }
    }

    void commit({ rootOrder: nextRoot, childrenByCategory: nextChildren })
  }

  const onDragCancel = () => {
    setActiveId(null)
    setDragOverride(null)
  }

  const displayTree = useMemo(
    () =>
      buildDisplayTree(
        containers.rootOrder,
        containers.childrenByCategory,
        channelById,
      ),
    [containers, channelById],
  )

  const activeChannel = activeId
    ? channelById.get(String(activeId))
    : undefined

  if (channels.length === 0) return null

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={canReorder ? onDragStart : undefined}
      onDragOver={canReorder ? onDragOver : undefined}
      onDragEnd={canReorder ? onDragEnd : undefined}
      onDragCancel={canReorder ? onDragCancel : undefined}
    >
      <SortableContext
        items={containers.rootOrder}
        strategy={verticalListSortingStrategy}
      >
        <div
          className={cn(
            "flex w-full flex-col gap-0.5",
            saving && "opacity-80",
          )}
        >
          {displayTree.map((node) => {
            if (node.kind === "category") {
              const childIds =
                containers.childrenByCategory[node.channel.id] ?? EMPTY_IDS
              const collapsed = Boolean(collapsedIds[node.channel.id])
              return (
                <div
                  key={node.channel.id}
                  className="flex w-full flex-col gap-0.5"
                >
                  <SortableShell id={node.channel.id} disabled={!canReorder}>
                    <CategoryHeader
                      guildId={guildId}
                      categoryId={node.channel.id}
                      name={node.channel.name}
                      collapsed={collapsed}
                      canManageChannels={canReorder}
                      onToggleCollapse={() =>
                        setCollapsedIds((prev) => ({
                          ...prev,
                          [node.channel.id]: !prev[node.channel.id],
                        }))
                      }
                    />
                  </SortableShell>
                  {!collapsed && (
                    <SortableContext
                      items={childIds}
                      strategy={verticalListSortingStrategy}
                    >
                      <div className="flex w-full flex-col gap-0.5">
                        {node.children.map((channel) => (
                          <SortableShell
                            key={channel.id}
                            id={channel.id}
                            disabled={!canReorder}
                          >
                            {channel.type === "VOICE" ? (
                              <VoiceChannelItem
                                channel={channel}
                                guildId={guildId}
                              />
                            ) : (
                              <TextChannelItem
                                channel={channel}
                                guildId={guildId}
                              />
                            )}
                          </SortableShell>
                        ))}
                      </div>
                    </SortableContext>
                  )}
                </div>
              )
            }
            return (
              <SortableShell
                key={node.channel.id}
                id={node.channel.id}
                disabled={!canReorder}
              >
                {node.channel.type === "VOICE" ? (
                  <VoiceChannelItem
                    channel={node.channel}
                    guildId={guildId}
                  />
                ) : (
                  <TextChannelItem channel={node.channel} guildId={guildId} />
                )}
              </SortableShell>
            )
          })}
        </div>
      </SortableContext>
      <DragOverlay>
        {activeChannel ? (
          <div className="rounded-md border bg-card px-3 py-1.5 text-sm shadow-lg">
            {activeChannel.name}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
