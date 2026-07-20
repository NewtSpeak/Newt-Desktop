// 「添加服务器 → 页内登录/注册」流程状态（未登录时的右侧主内容区）。
//
// 邀请链接在弹窗内解析并预检通过后，startAuth 把运行时服务器基址切到目标
// 服务器（不落盘），右侧渲染 ServerAuthView；登录/注册成功后由视图负责
// persistServerConnection + reset，取消则回退到已保存的基址。

import { create } from "zustand"

import {
  restoreSavedServerBaseUrl,
  setRuntimeServerBaseUrl,
} from "~/lib/server-connection"

export type PendingInvite =
  /** 注册邀请：注册时把 code 作为 invite_code 提交 */
  | { kind: "registration"; code: string }
  /** 社区邀请：注册时把 code 作为 guild_invite_code 提交，注册/登录成功后自动加入该社区 */
  | { kind: "guild"; code: string; guildName: string }

export type PendingServerAuth = {
  /** 目标服务器基址（含协议，无尾斜杠） */
  serverBaseUrl: string
  /** 预检响应里的服务器名（重登场景可能只是 host） */
  serverName: string
  /** 携带的邀请；null = 对已保存服务器重新登录（只提供登录） */
  invite: PendingInvite | null
}

type ConnectState = {
  pending: PendingServerAuth | null
  /** 预检通过后进入页内认证流程 */
  startAuth: (pending: PendingServerAuth) => void
  /** 用户取消认证：回退运行时基址并回到欢迎引导 */
  cancelAuth: () => void
  /** 认证成功后清空流程状态（基址持久化由视图完成） */
  reset: () => void
}

export const useConnectStore = create<ConnectState>()((set) => ({
  pending: null,

  startAuth: (pending) => {
    setRuntimeServerBaseUrl(pending.serverBaseUrl)
    set({ pending })
  },

  cancelAuth: () => {
    restoreSavedServerBaseUrl()
    set({ pending: null })
  },

  reset: () => set({ pending: null }),
}))
