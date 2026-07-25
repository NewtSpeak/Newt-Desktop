// 审计 / 操作日志查询与撤销（docs 18 §5.11 / auditapi + auditundo）。

import { api, qs } from "./http"

export type AuditUndoStatus =
  | "none"
  | "available"
  | "undone"
  | "blocked"
  | "irreversible"

export type AuditLogEntry = {
  id: string
  actor_id?: string | null
  actor_type: string
  actor_username?: string
  guild_id?: string | null
  guild_name?: string
  action: string
  action_label?: string
  target_type: string
  target_id: string
  target_summary?: string
  detail?: unknown
  created_at: string
  reversible?: boolean
  undo_status?: AuditUndoStatus
  undo_hint?: string
  undo_of_id?: string | null
  undone_by_id?: string | null
  undone_at?: string | null
}

export type AuditLogList = {
  items: AuditLogEntry[]
  next_cursor?: string
  has_more: boolean
}

export type ListAuditLogsQuery = {
  actor_id?: string
  /** action 前缀匹配，如 restriction. / rbac. / moderation. */
  action?: string
  target_type?: string
  undo_status?: AuditUndoStatus
  since?: string
  until?: string
  limit?: number
  before?: string
  include_state?: boolean
}

/** GET /guilds/:gid/audit-logs（需 VIEW_AUDIT_LOG） */
export const listGuildAuditLogs = (
  guildId: string,
  query: ListAuditLogsQuery = {},
) =>
  api<AuditLogList>(
    `/guilds/${guildId}/audit-logs${qs({
      actor_id: query.actor_id,
      action: query.action,
      target_type: query.target_type,
      undo_status: query.undo_status,
      since: query.since,
      until: query.until,
      limit: query.limit,
      before: query.before,
      include_state: query.include_state ? "1" : undefined,
    })}`,
  )

export type UndoAuditLogResult = {
  original: AuditLogEntry
  undo: AuditLogEntry
}

/** POST /guilds/:gid/audit-logs/:id/undo */
export const undoGuildAuditLog = (guildId: string, logId: string) =>
  api<UndoAuditLogResult>(`/guilds/${guildId}/audit-logs/${logId}/undo`, {
    method: "POST",
  })
