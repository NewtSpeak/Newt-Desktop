// 设置各分栏的子目录（与 GroupLabel / 内容锚点 id 一一对应）

import type { SettingsSection } from "~/stores/settings"

export type SettingsTocItem = {
  id: string
  label: string
}

/** DOM id 前缀，避免与页面其它元素冲突 */
export const SETTINGS_ANCHOR_PREFIX = "settings-anchor-"

export function settingsAnchorDomId(id: string): string {
  return `${SETTINGS_ANCHOR_PREFIX}${id}`
}

/** 每个主菜单进入后展示的子菜单（跳转右侧内容锚点） */
export const SECTION_TOC: Record<SettingsSection, SettingsTocItem[]> = {
  account: [
    { id: "account-info", label: "账号信息" },
    { id: "account-manage", label: "账号管理" },
    { id: "account-session", label: "会话" },
  ],
  profile: [
    { id: "profile-text", label: "文字资料" },
    { id: "profile-avatar", label: "头像" },
    { id: "profile-banner", label: "横幅" },
  ],
  privacy: [
    { id: "privacy-friend", label: "好友请求" },
    { id: "privacy-dm", label: "私信来源" },
    { id: "privacy-filter", label: "请求箱与资料" },
    { id: "privacy-block", label: "屏蔽列表" },
    { id: "privacy-server", label: "每服务器" },
  ],
  applications: [
    { id: "apps-list", label: "活跃授权" },
    { id: "apps-revoke-all", label: "全部吊销" },
  ],
  voice: [
    { id: "voice-devices", label: "设备" },
    { id: "voice-mic-test", label: "麦克风测试" },
    { id: "voice-volume", label: "音量" },
    { id: "voice-pack", label: "入场音效" },
    { id: "voice-input-mode", label: "输入模式" },
    { id: "voice-processing", label: "音频处理" },
    { id: "voice-dfn", label: "DeepFilterNet 调参" },
  ],
  notifications: [
    { id: "notify-global", label: "全局默认" },
    { id: "notify-sounds", label: "提示音" },
    { id: "notify-system", label: "系统通知" },
    { id: "notify-guild", label: "每服务器覆盖" },
    { id: "notify-channel", label: "每频道覆盖" },
  ],
  appearance: [
    { id: "appearance-theme", label: "主题" },
    { id: "appearance-font", label: "字体大小" },
    { id: "appearance-density", label: "消息显示密度" },
  ],
  keybinds: [
    { id: "keybinds-ptt", label: "按键说话" },
    { id: "keybinds-nav", label: "导航与搜索" },
    { id: "keybinds-message", label: "消息" },
    { id: "keybinds-voice", label: "语音" },
  ],
  stickers: [
    { id: "stickers-create", label: "创建包" },
    { id: "stickers-owned", label: "我创建的包" },
    { id: "stickers-library", label: "已安装" },
  ],
  about: [{ id: "about-oss", label: "开源信息" }],
}
