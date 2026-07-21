// Ctrl/Cmd+K 快速切换器（docs 06 FR-01/27/28/29）：
// 本地即时匹配 store 里可见的频道/成员/服务器；前缀语法 # 文字频道、! 语音频道、
// @ 成员、* 服务器；↑↓ 选择、Enter 跳转；底部「搜索消息」入口进入消息搜索面板。

import { useMemo, useState } from "react"
import { useNavigate } from "react-router"
import { HashIcon, SearchIcon, ServerIcon, UserIcon, Volume2Icon } from "lucide-react"

import {
  Command,
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "~/components/ui/command"
import type { ChannelType } from "~/lib/api/types"
import { useChannelsStore } from "~/stores/channels"
import { useGuildsStore } from "~/stores/guilds"
import { useMembersStore } from "~/stores/members"
import { useSearchStore } from "~/stores/search"
import { useSettingsStore } from "~/stores/settings"
import { useUIStore } from "~/stores/ui"

const MAX_RESULTS = 10

type SwitcherItem =
  | { kind: "channel"; id: string; name: string; guildId: string; channelType: ChannelType }
  | { kind: "member"; id: string; name: string }
  | { kind: "guild"; id: string; name: string }

/** 匹配评分：精确 0 < 前缀 1 < 词中包含 2；不匹配 null（FR-28 简化版） */
function matchScore(name: string, query: string): number | null {
  const lower = name.toLowerCase()
  if (lower === query) return 0
  if (lower.startsWith(query)) return 1
  if (lower.includes(query)) return 2
  return null
}

export function QuickSwitcher({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const navigate = useNavigate()
  const guilds = useGuildsStore((state) => state.guilds)
  const channelsByGuild = useChannelsStore((state) => state.byGuild)
  const membersByGuild = useMembersStore((state) => state.byGuild)
  const [query, setInput] = useState("")

  const { prefix, term } = useMemo(() => {
    const first = query.trim().charAt(0)
    if (first === "#" || first === "!" || first === "@" || first === "*") {
      return { prefix: first, term: query.trim().slice(1).toLowerCase() }
    }
    return { prefix: "", term: query.trim().toLowerCase() }
  }, [query])

  const matched = useMemo(() => {
    if (!term && !prefix) return []
    const scored: { item: SwitcherItem; score: number }[] = []

    const pushIf = (item: SwitcherItem) => {
      if (!term) {
        scored.push({ item, score: 2 })
        return
      }
      const score = matchScore(item.name, term)
      if (score !== null) scored.push({ item, score })
    }

    if (prefix === "" || prefix === "#" || prefix === "!") {
      const wantType: ChannelType | null =
        prefix === "#" ? "TEXT" : prefix === "!" ? "VOICE" : null
      for (const [guildId, channels] of Object.entries(channelsByGuild)) {
        for (const channel of channels) {
          if (wantType && channel.type !== wantType) continue
          pushIf({
            kind: "channel",
            id: channel.id,
            name: channel.name,
            guildId,
            channelType: channel.type,
          })
        }
      }
    }
    if (prefix === "" || prefix === "@") {
      const seen = new Set<string>()
      for (const members of Object.values(membersByGuild)) {
        for (const member of members) {
          if (seen.has(member.user_id)) continue
          seen.add(member.user_id)
          pushIf({
            kind: "member",
            id: member.user_id,
            name: member.nickname?.trim() || member.display_name?.trim() || member.username,
          })
        }
      }
    }
    if (prefix === "" || prefix === "*") {
      for (const guild of guilds) {
        pushIf({ kind: "guild", id: guild.id, name: guild.name })
      }
    }

    return scored
      .sort((a, b) => a.score - b.score || a.item.name.localeCompare(b.item.name))
      .slice(0, MAX_RESULTS)
      .map((entry) => entry.item)
  }, [prefix, term, channelsByGuild, membersByGuild, guilds])

  const guildNameOf = (guildId: string) =>
    guilds.find((guild) => guild.id === guildId)?.name ?? ""

  const handleSelect = (item: SwitcherItem) => {
    onOpenChange(false)
    setInput("")
    if (item.kind === "channel") {
      if (item.channelType === "TEXT") {
        navigate(`/channels/${item.guildId}/${item.id}`)
      } else {
        // 语音频道无独立路由：选中所在服务器（加入语音由频道列表负责）
        useUIStore.getState().selectGuild(item.guildId)
        navigate("/")
      }
    } else if (item.kind === "guild") {
      useUIStore.getState().selectGuild(item.id)
      navigate("/")
    }
    // 成员：成员卡片未实装，仅关闭浮层
  }

  /** 底部消息搜索入口：携带当前输入进入右侧搜索面板并立即执行 */
  const searchTerm = query.trim()
  const handleSearchMessages = () => {
    onOpenChange(false)
    if (useSettingsStore.getState().panelOpen) useSettingsStore.getState().closePanel()
    useSearchStore.getState().openPanel(searchTerm)
    void useSearchStore.getState().submit()
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) setInput("")
      }}
      title="快速切换器"
      description="跳转到频道、成员或服务器"
      className="sm:max-w-lg"
    >
      <Command shouldFilter={false}>
        <CommandInput
          placeholder="跳转到频道 / 成员 / 服务器…"
          value={query}
          onValueChange={setInput}
        />
        <CommandList>
          {matched.length > 0 && (
            <CommandGroup>
              {matched.map((item) => (
                <CommandItem
                  key={`${item.kind}-${item.id}`}
                  value={`${item.kind}-${item.id}`}
                  onSelect={() => handleSelect(item)}
                >
                  {item.kind === "channel" &&
                    (item.channelType === "TEXT" ? (
                      <HashIcon className="text-muted-foreground" />
                    ) : (
                      <Volume2Icon className="text-muted-foreground" />
                    ))}
                  {item.kind === "member" && <UserIcon className="text-muted-foreground" />}
                  {item.kind === "guild" && <ServerIcon className="text-muted-foreground" />}
                  <span className="truncate">{item.name}</span>
                  {item.kind === "channel" && (
                    <span className="ml-auto truncate text-xs text-muted-foreground">
                      {guildNameOf(item.guildId)}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {searchTerm && (
            <>
              {matched.length > 0 && <CommandSeparator />}
              <CommandGroup>
                <CommandItem value="__search-messages__" onSelect={handleSearchMessages}>
                  <SearchIcon className="text-muted-foreground" />
                  <span className="truncate">
                    搜索消息：<span className="font-semibold">{searchTerm}</span>
                  </span>
                </CommandItem>
              </CommandGroup>
            </>
          )}
          {!searchTerm && matched.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              输入以搜索频道、成员或服务器
            </p>
          )}
        </CommandList>
        {/* 前缀语法提示（UX-09） */}
        <div className="border-t px-4 py-2 text-xs text-muted-foreground select-none">
          <kbd className="rounded bg-muted px-1"># </kbd> 文字频道 ·{" "}
          <kbd className="rounded bg-muted px-1">!</kbd> 语音频道 ·{" "}
          <kbd className="rounded bg-muted px-1">@</kbd> 成员 ·{" "}
          <kbd className="rounded bg-muted px-1">*</kbd> 服务器
        </div>
      </Command>
    </CommandDialog>
  )
}
