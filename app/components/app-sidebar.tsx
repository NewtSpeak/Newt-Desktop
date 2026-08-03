import * as React from "react"
import { useLocation, useNavigate } from "react-router"
import { HomeIcon, PlusIcon } from "lucide-react"

import { AddGuildDialog } from "~/components/add-guild-dialog"
import { NavUser } from "~/components/nav-user"
import { ServerRailItem } from "~/components/server-rail"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "~/components/ui/sidebar"
import { dragWindowOnMouseDown } from "~/lib/window-drag"
import { useIsMacDesktop } from "~/lib/platform"
import {
  closestCenter,
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"

import { isFriendsLocation } from "~/lib/friends-route"
import { isShopLocation } from "~/lib/shop-route"
import { isStickersLocation } from "~/lib/stickers-route"
import { cn } from "~/lib/utils"
import { useGuildsStore } from "~/stores/guilds"
import { useSettingsStore } from "~/stores/settings"
import { useUIStore } from "~/stores/ui"

/** 服务器条目的可拖拽外壳（拖拽启动阈值 6px，不影响点击/右键） */
function SortableRailShell({
  id,
  children,
}: {
  id: string
  children: React.ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(isDragging && "z-20 opacity-70")}
      {...attributes}
      {...listeners}
    >
      {children}
    </div>
  )
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const isMacDesktop = useIsMacDesktop()
  const navigate = useNavigate()
  const location = useLocation()
  const guilds = useGuildsStore((state) => state.guilds)
  const selectedGuildId = useUIStore((state) => state.selectedGuildId)
  const [addOpen, setAddOpen] = React.useState(false)
  const isFriendsRoute = isFriendsLocation(location)
  const isStickersRoute = isStickersLocation(location)
  const isShopRoute = isShopLocation(location)

  // 服务器栏个人排序（docs 17 FR-23）：guildOrder 优先，未收录的按加入时间排末尾
  const guildOrder = useSettingsStore((state) => state.guildOrder)
  const orderedGuilds = React.useMemo(() => {
    if (guildOrder.length === 0) return guilds
    const rank = new Map(guildOrder.map((id, index) => [id, index]))
    return [...guilds].sort((a, b) => {
      const ra = rank.get(a.id) ?? Number.MAX_SAFE_INTEGER
      const rb = rank.get(b.id) ?? Number.MAX_SAFE_INTEGER
      if (ra !== rb) return ra - rb
      // 同 id 不同账号：稳定按 account_id 排
      return (a.account_id ?? "").localeCompare(b.account_id ?? "")
    })
  }, [guilds, guildOrder])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  )
  const railKey = (guild: { id: string; account_id?: string }) =>
    `${guild.account_id ?? ""}:${guild.id}`

  const onDragEnd = React.useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (!over || active.id === over.id) return
      const keys = orderedGuilds.map(railKey)
      const from = keys.indexOf(String(active.id))
      const to = keys.indexOf(String(over.id))
      if (from < 0 || to < 0) return
      const reordered = arrayMove(orderedGuilds, from, to)
      // 排序仍按 guild.id（个人设置）；同 id 多账号条目顺序随之变化
      useSettingsStore.getState().setGuildOrder(reordered.map((g) => g.id))
    },
    [orderedGuilds],
  )

  /** 回到私信落地页（空白主内容 + 左侧私信列表） */
  const goHome = () => {
    useUIStore.getState().selectGuild(null)
    navigate("/")
  }

  return (
    <Sidebar
      collapsible="icon"
      onMouseDown={dragWindowOnMouseDown}
      {...props}
    >
      {/* Home + 加号固定在顶部，不随服务器列表滚动。
          左右对称间距：icon 模式下 px 统一，条目居中（不再为左侧未读条预留空隙）。
          私信未读角标已移至右上角信封。 */}
      <SidebarHeader
        className={cn(
          "shrink-0 gap-1 border-b border-sidebar-border/50 group-data-[collapsible=icon]:px-1",
          // Windows/App 不额外规避顶部红绿灯；macOS 匹配 --app-top-inset 32px 避免盖住交通灯
          !isMacDesktop && "pt-1.5",
          isMacDesktop && "pt-8",
        )}
      >
        {/* 使用品牌 PNG：icon.svg 为黑底单色且坐标系易在同步时坏掉，深色侧栏/Win WebView 上会「消失」 */}
        <img
          src="/app-icon.png"
          alt="NewtSpeak"
          width={36}
          height={36}
          draggable={false}
          className="mx-auto size-9 shrink-0 rounded-lg object-cover select-none"
        />

        <SidebarMenu>
          <SidebarMenuItem className="relative flex justify-center">
            <SidebarMenuButton
              tooltip="主页"
              aria-label="主页"
              isActive={
                !isFriendsRoute &&
                !isStickersRoute &&
                !isShopRoute &&
                (selectedGuildId == null || selectedGuildId === "@me")
              }
              onClick={goHome}
              className="justify-center rounded-lg"
            >
              <HomeIcon className="size-4" />
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem className="flex justify-center">
            <SidebarMenuButton
              tooltip="添加服务器"
              aria-label="添加服务器"
              onClick={() => setAddOpen(true)}
              className="bg-sidebar-accent text-sidebar-accent-foreground justify-center rounded-lg"
            >
              <PlusIcon className="size-4" />
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      {/* 仅服务器列表可滚动；icon 模式下默认 overflow-hidden 会挡住滚动，需显式覆盖。
          底部 NavUser 在 SidebarFooter 中，不随列表滚动。 */}
      <SidebarContent
        className={cn(
          "min-h-0 flex-1 overflow-x-hidden overflow-y-auto",
          // 覆盖 sidebar.tsx 中 group-data-[collapsible=icon]:overflow-hidden
          "group-data-[collapsible=icon]:overflow-x-hidden group-data-[collapsible=icon]:overflow-y-auto",
        )}
      >
        <SidebarGroup className="min-h-0 group-data-[collapsible=icon]:px-1">
          <SidebarMenu>
            {/* 拖拽排序（docs 17 FR-23）：仅本人可见，经 settings-sync 跨端同步 */}
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={onDragEnd}
            >
              <SortableContext
                items={orderedGuilds.map(railKey)}
                strategy={verticalListSortingStrategy}
              >
                {orderedGuilds.map((guild) => (
                  <SortableRailShell
                    key={railKey(guild)}
                    id={railKey(guild)}
                  >
                    <ServerRailItem
                      guildId={guild.id}
                      accountId={guild.account_id}
                    />
                  </SortableRailShell>
                ))}
              </SortableContext>
            </DndContext>
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="shrink-0 border-t border-sidebar-border/50 group-data-[collapsible=icon]:px-1">
        <NavUser />
      </SidebarFooter>
      <AddGuildDialog open={addOpen} onOpenChange={setAddOpen} />
    </Sidebar>
  )
}
