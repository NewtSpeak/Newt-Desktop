// 服管侧语音资源：节点池 + 入场语音包库（docs 18 §5.8/§5.9）。

import { api } from "./http"

// ---------------------------------------------------------------------------
// 节点池 GET/PUT /guilds/:gid/node-pool（需 MANAGE_GUILD）
// ---------------------------------------------------------------------------

export type PoolNode = {
  id: string
  display_name: string
  status: string
  /** 节点标签 map（区域/用途等） */
  labels?: Record<string, string>
  online: boolean
}

export type GuildNodePool = {
  guild_id: string
  fallback_to_default: boolean
  candidates: PoolNode[]
  selected: PoolNode[]
}

export const getGuildNodePool = (guildId: string) =>
  api<GuildNodePool>(`/guilds/${guildId}/node-pool`)

/** 从授权候选中勾选生效节点 */
export const putGuildNodePool = (
  guildId: string,
  input: { node_ids: string[]; fallback_to_default?: boolean },
) =>
  api<GuildNodePool>(`/guilds/${guildId}/node-pool`, {
    method: "PUT",
    body: JSON.stringify(input),
  })

// ---------------------------------------------------------------------------
// 入场语音包库 /guilds/:gid/voice-packs
// ---------------------------------------------------------------------------

export type VoicePack = {
  id: string
  guild_id: string
  name: string
  audio_url: string
  duration_ms: number
  size_bytes: number
  kind: "STANDARD" | "RARE" | string
  allowed_role_ids: string[]
  enabled: boolean
  created_by: string
  created_at?: string
  updated_at?: string
  available?: boolean
  selected?: boolean
}

export const listVoicePacks = (guildId: string) =>
  api<{ voice_packs?: VoicePack[] }>(`/guilds/${guildId}/voice-packs`).then(
    (raw) => raw.voice_packs ?? [],
  )

export const createVoicePack = (
  guildId: string,
  input: {
    name: string
    kind?: string
    allowed_role_ids?: string[]
    enabled?: boolean
    duration_ms?: number
  },
) =>
  api<VoicePack>(`/guilds/${guildId}/voice-packs`, {
    method: "POST",
    body: JSON.stringify(input),
  })

export const patchVoicePack = (
  guildId: string,
  packId: string,
  patch: {
    name?: string
    kind?: string
    allowed_role_ids?: string[]
    enabled?: boolean
    duration_ms?: number
  },
) =>
  api<VoicePack>(`/guilds/${guildId}/voice-packs/${packId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  })

export const deleteVoicePack = (guildId: string, packId: string) =>
  api<void>(`/guilds/${guildId}/voice-packs/${packId}`, { method: "DELETE" })

/** 上传音频（multipart file，≤500KB，ogg/mp3） */
export const uploadVoicePackAudio = (
  guildId: string,
  packId: string,
  file: File,
  durationMs?: number,
) => {
  const form = new FormData()
  form.append("file", file)
  if (durationMs != null && durationMs > 0) {
    form.append("duration_ms", String(durationMs))
  }
  return api<VoicePack>(
    `/guilds/${guildId}/voice-packs/${packId}/audio`,
    { method: "POST", body: form },
  )
}

/** 成员选用语音包 */
export const selectVoicePack = (guildId: string, packId: string) =>
  api<{ selected: boolean; pack_id?: string }>(
    `/guilds/${guildId}/voice-packs/${packId}/select`,
    { method: "PUT" },
  )

/** 查询本人选中的语音包 */
export const getMyVoicePackSelection = (guildId: string) =>
  api<{ selection: VoicePack | null }>(
    `/guilds/${guildId}/voice-packs/@me`,
  ).then((raw) => raw.selection)

/** 取消选包 */
export const clearMyVoicePackSelection = (guildId: string) =>
  api<{ selected: boolean }>(`/guilds/${guildId}/voice-packs/@me`, {
    method: "DELETE",
  })
