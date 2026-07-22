// 审计日志查询（docs 18 §5.11 / auditapi）。

import { api, qs } from "./http"

export type AuditLogEntry = {
  id: string
  actor_id?: string | null
  actor_type: string
  actor_username?: string
  guild_id?: string | null
  guild_name?: string
  action: string
  target_type: string
  target_id: string
  target_summary?: string
  detail?: unknown
  created_at: string
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
  since?: string
  until?: string
  limit?: number
  before?: string
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
      since: query.since,
      until: query.until,
      limit: query.limit,
      before: query.before,
    })}`,
  )
