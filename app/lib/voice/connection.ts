// 语音连接管理器（单例）：进出房编排 + 连接状态机 + 容错恢复 + 双 PC 热迁移
// （docs 09 / docs 13 C3 完整版）。
//
// 架构：链路单元 = VoiceLink（信令 + PC + audio，见 link.ts）。管理器持有
//   activeLink（当前收发）+ pendingLink（迁移中并行建立的新链路）。
//
// 热迁移时序（FR-04~08）：
//   VOICE_MIGRATING / VOICE_SERVER_UPDATE（顺序不做假设）→ 进入迁移态（UI 细条）
//   → 保持 activeLink 收发，创建 pendingLink（上行禁发）并行协商
//   → pendingLink 首个下行音频到达：activeLink 下行整体静音（接收侧切新，防双声）
//   → pendingLink PC connected：CUTOVER（旧上行 track.stop() → 新上行放行，禁止双发）
//     → 提升 pending 为 active、销毁旧链路（CLEANUP）→ ackVoiceMigration
//   → 8s 未连通：销毁 pendingLink、保持旧链路不动，等服务端换目标重发（不自行选点）。
//
// 其余容错：8 关闭码矩阵 + MIGRATED、指数退避（500ms×2 封顶 15s ±20%）、断网挂起
// （offline 暂停计时 / online 立即重试）、ICE restart 优先于重建（FR-15）、token
// exp−45s 刷新经 auth 帧在位重发（迁移事件的新 token 优先，丢弃在途刷新，FR-11/12）。

import { toast } from "sonner"

import { ApiError } from "~/lib/api/http"
import {
  ackVoiceMigration,
  joinVoice,
  leaveVoice,
  refreshVoiceToken,
  updateSelfVoiceState,
} from "~/lib/api/voice"
import type {
  VoiceCapsUpdatePayload,
  VoiceMigratedPayload,
  VoiceMigratingPayload,
  VoiceServerUpdatePayload,
  VoiceStateUpdatePayload,
} from "~/lib/gateway/events"
import {
  downlinkNsSoftLimit,
  downlinkWasmModel,
} from "~/lib/noise-suppression"
import { useAuthStore } from "~/stores/auth"
import { useSettingsStore } from "~/stores/settings"
import { inferChannelMode, useStageStore } from "~/stores/stage"
import {
  canPublishAudio,
  useVoiceStore,
  type VoiceSession,
} from "~/stores/voice"
import {
  VoiceLink,
  type VoiceLinkCallbacks,
  type VoiceLinkTarget,
} from "./link"
import { verror, vevent, vlog, vwarn } from "./log"
import type { ReadyPayload, VoiceCloseInfo } from "./signaling"

// 退避参数（docs 13 FR-20）
const BACKOFF_BASE_MS = 500
const BACKOFF_MULTIPLIER = 2
const BACKOFF_CAP_MS = 15_000
const BACKOFF_JITTER = 0.2
/** 单故障窗口内自动恢复次数上限（docs 09 §6.2） */
const MAX_RECOVERY_ATTEMPTS = 5
/** CONNECTED 稳定该时长后重置故障窗口计数 */
const STABLE_RESET_MS = 30_000
/** token 提前刷新：exp − 45s ± 10s 抖动 */
const REFRESH_LEAD_MS = 45_000
const REFRESH_JITTER_MS = 10_000
/** speaking 事件不含某用户后延迟熄灭，防闪烁 */
const SPEAKING_FADE_MS = 200
/** NODE_DRAINING / MIGRATED 后等待 VOICE_SERVER_UPDATE 的窗口（docs 13 FR-12） */
const DRAINING_WAIT_MS = 3_000
/** 迁移新链路建立超时：超时保持旧链路，等服务端换目标（FR-07，对齐 CONNECT ~8s） */
const MIGRATION_CONNECT_TIMEOUT_MS = 8_000
/** 单故障窗口内 ICE restart 尝试上限，超出转完整重连（FR-15） */
const MAX_ICE_RESTARTS = 2
/** ICE restart 后该时长未连通（卡 checking 等无事件态）转常规重连 */
const ICE_RESTART_WATCHDOG_MS = 5_000

/** 迁移全链路上下文（migration_id 贯穿日志，FR-05） */
type MigrationContext = {
  id: string | null
  /** 首个迁移信号（VOICE_MIGRATING 或 VOICE_SERVER_UPDATE）到达时刻 */
  startedAtMs: number
  /** 是否已收到 VOICE_SERVER_UPDATE（防止仅凭 VOICE_MIGRATING 就过早 ack） */
  sawServerUpdate: boolean
}

function capsList(caps: unknown): string[] {
  if (!Array.isArray(caps)) return []
  return caps.filter((item): item is string => typeof item === "string")
}

/** 解析 expires_at（unix 秒 / 毫秒 / ISO 串）；缺失时兜底解 JWT exp */
function parseExpiresAt(
  value: number | string | undefined,
  token: string
): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value > 1e12 ? value : value * 1000
  }
  if (typeof value === "string" && value) {
    const numeric = Number(value)
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric > 1e12 ? numeric : numeric * 1000
    }
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
  }
  try {
    const [, payload] = token.split(".")
    const claims = JSON.parse(
      atob(payload.replace(/-/g, "+").replace(/_/g, "/"))
    ) as {
      exp?: number
    }
    if (typeof claims.exp === "number") return claims.exp * 1000
  } catch {
    // token 不可解析时走保守刷新周期
  }
  return null
}

/** join / re-join 错误码 → 中文提示（docs 09 FR-04） */
export function joinErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case "CHANNEL_FULL":
        return "频道已满"
      case "CHANNEL_LOCKED":
        return "频道已上锁，请先输入访问密码"
      case "RESTRICTED":
        return "你已被限制加入该频道"
      case "MISSING_PERMISSIONS":
        return "无权加入该频道"
      case "NO_NODE_IN_POOL":
      case "NO_SFU_CAPACITY":
        return "语音服务繁忙，请稍后再试"
      case "NETWORK_ERROR":
        return "网络请求失败，请检查网络连接"
    }
    if (error.status === 404) return "频道不存在或不可见"
    if (error.status === 403) return "无权加入该频道"
  }
  return "加入语音失败，请稍后再试"
}

class VoiceConnectionManager {
  /** 当前接入目标（join 响应 / VOICE_SERVER_UPDATE / 刷新持续同步） */
  private info: VoiceLinkTarget | null = null
  /** 当前收发链路 */
  private activeLink: VoiceLink | null = null
  /** 迁移中并行建立的新链路（同一时刻最多两条 PC，FR-03） */
  private pendingLink: VoiceLink | null = null
  private pendingConnectTimer: ReturnType<typeof setTimeout> | null = null

  private migration: MigrationContext | null = null

  // token 刷新（定时器跟随 activeLink 的 expires_at；epoch 变化丢弃在途结果，FR-12）
  private refreshTimer: ReturnType<typeof setTimeout> | null = null
  private refreshFailCount = 0
  private refreshEpoch = 0

  // 恢复与退避
  private recoverTimer: ReturnType<typeof setTimeout> | null = null
  private recoveryAttempts = 0
  private stableTimer: ReturnType<typeof setTimeout> | null = null
  private drainingTimer: ReturnType<typeof setTimeout> | null = null
  private iceRestartAttempts = 0
  /** ICE restart 后的恢复观察：超时未连通转常规重连（restart 失败无新事件可依赖） */
  private iceRestartWatchdog: ReturnType<typeof setTimeout> | null = null

  // 断网挂起（FR-20：offline 暂停计时，online 立即重试）
  private online = typeof navigator === "undefined" ? true : navigator.onLine
  private suspendedAction: (() => Promise<void>) | null = null

  private prevMuteBeforeDeaf = false
  private micWarned = false

  /**
   * 正在观看的屏幕共享发布者白名单（协议 §2.1 kinds=["video"]）：
   * 链路 ready 后对白名单之外全员退订视频轨（默认不拉流），点观看才订阅。
   * 迁移/重连的新链路以此快照重放（视频退订全员 + 已观看白名单）。
   */
  private watchedVideo: Record<string, true> = {}

  // speaking 熄灭防闪：活跃集合 + 每用户 fade 定时器
  private speakingActive = new Set<string>()
  private speakingFadeTimers = new Map<string, ReturnType<typeof setTimeout>>()

  /** 按键说话：按住时 true；释放后经 pttReleaseDelayMs 关麦 */
  private pttHeld = false
  private pttReleaseTimer: ReturnType<typeof setTimeout> | null = null
  private pttKeyDown = false

  constructor() {
    if (typeof window !== "undefined") {
      window.addEventListener("online", () => this.handleOnline())
      window.addEventListener("offline", () => this.handleOffline())
      this.bindNoiseSettingsWatch()
      this.bindPttKeys()
    }
  }

  /** 应用焦点内 PTT（docs 16 FR-08）；全局热键待 Tauri 插件 */
  private bindPttKeys() {
    const matches = (event: KeyboardEvent | MouseEvent): boolean => {
      const code = useSettingsStore.getState().voice.pttKey || "KeyV"
      if (event instanceof KeyboardEvent) {
        // 输入框内不抢 PTT，避免打字冲突
        const t = event.target as HTMLElement | null
        if (
          t &&
          (t.tagName === "INPUT" ||
            t.tagName === "TEXTAREA" ||
            t.isContentEditable)
        ) {
          return false
        }
        return event.code === code
      }
      // Mouse4/5 = button 3/4
      if (code === "Mouse4") return event.button === 3
      if (code === "Mouse5") return event.button === 4
      return false
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (!matches(event) || event.repeat) return
      if (useSettingsStore.getState().voice.inputMode !== "push-to-talk") return
      if (!useVoiceStore.getState().session) return
      event.preventDefault()
      this.pttKeyDown = true
      this.setPttHeld(true)
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (!matches(event)) return
      this.pttKeyDown = false
      this.setPttHeld(false)
    }
    const onBlur = () => {
      if (!this.pttKeyDown && !this.pttHeld) return
      this.pttKeyDown = false
      this.setPttHeld(false)
    }
    const onMouseDown = (event: MouseEvent) => {
      if (!matches(event)) return
      if (useSettingsStore.getState().voice.inputMode !== "push-to-talk") return
      if (!useVoiceStore.getState().session) return
      event.preventDefault()
      this.setPttHeld(true)
    }
    const onMouseUp = (event: MouseEvent) => {
      if (!matches(event)) return
      this.setPttHeld(false)
    }
    window.addEventListener("keydown", onKeyDown, true)
    window.addEventListener("keyup", onKeyUp, true)
    window.addEventListener("blur", onBlur)
    window.addEventListener("mousedown", onMouseDown, true)
    window.addEventListener("mouseup", onMouseUp, true)
  }

  private setPttHeld(held: boolean) {
    if (this.pttReleaseTimer) {
      clearTimeout(this.pttReleaseTimer)
      this.pttReleaseTimer = null
    }
    if (held) {
      this.pttHeld = true
      this.applyMicState()
      return
    }
    const delay = Math.max(
      0,
      Math.min(2000, useSettingsStore.getState().voice.pttReleaseDelayMs ?? 0),
    )
    if (delay <= 0) {
      this.pttHeld = false
      this.applyMicState()
      return
    }
    this.pttReleaseTimer = setTimeout(() => {
      this.pttReleaseTimer = null
      this.pttHeld = false
      this.applyMicState()
    }, delay)
  }

  /**
   * 订阅降噪相关设置（docs 20）：ns 总开关 / nsModel / localNs 名单变化时
   * —— 无论来自本端 UI 还是他端 settings 同步（FR-R06 跨端）——
   * 重采上行链（模型热切，FR-S04）并重算下行链（FR-R05）。
   * AEC/AGC/设备等其余采集项仍由 UI 显式 applyVoiceSettings({reinitMic}) 触发。
   */
  private bindNoiseSettingsWatch() {
    let prev = useSettingsStore.getState().voice
    useSettingsStore.subscribe((state) => {
      const voice = state.voice
      if (voice === prev) return
      const uplinkChanged =
        voice.ns !== prev.ns || voice.nsModel !== prev.nsModel
      const strengthChanged =
        voice.nsStrengthByModel !== prev.nsStrengthByModel
      const dfnTuningChanged =
        voice.dfnAttenuationLimitDb !== prev.dfnAttenuationLimitDb ||
        voice.dfnPresenceGainDb !== prev.dfnPresenceGainDb
      const dtlnTuningChanged =
        voice.dtlnPresenceGainDb !== prev.dtlnPresenceGainDb ||
        voice.dtlnMakeupGainDb !== prev.dtlnMakeupGainDb
      const downlinkChanged =
        uplinkChanged ||
        strengthChanged ||
        voice.localNs !== prev.localNs ||
        voice.localNsModels !== prev.localNsModels
      const pttModeChanged =
        voice.inputMode !== prev.inputMode ||
        voice.pttKey !== prev.pttKey ||
        voice.pttReleaseDelayMs !== prev.pttReleaseDelayMs
      prev = voice
      if (pttModeChanged) {
        // 切回语音激活时清掉按住态，立刻按新模式重算闸门
        if (voice.inputMode !== "push-to-talk") {
          this.pttHeld = false
          if (this.pttReleaseTimer) {
            clearTimeout(this.pttReleaseTimer)
            this.pttReleaseTimer = null
          }
        }
        this.applyMicState()
      }
      if (uplinkChanged) {
        this.activeLink?.applyVoiceSettings({ reinitMic: true })
        this.pendingLink?.applyVoiceSettings({ reinitMic: true })
      } else {
        if (strengthChanged) {
          // 强度变更不重建链（FR-S06 即时生效）
          const strength =
            voice.nsStrengthByModel?.[voice.nsModel ?? "rnnoise"] ?? 100
          this.activeLink?.applyUplinkNsStrength(strength)
          this.pendingLink?.applyUplinkNsStrength(strength)
        }
        if (dfnTuningChanged) {
          const tuning = {
            attenuationLimitDb: voice.dfnAttenuationLimitDb,
            presenceGainDb: voice.dfnPresenceGainDb,
          }
          this.activeLink?.applyUplinkDfnTuning(tuning)
          this.pendingLink?.applyUplinkDfnTuning(tuning)
          this.activeLink?.applyDownlinkDfnTuning(tuning)
          this.pendingLink?.applyDownlinkDfnTuning(tuning)
        }
        if (dtlnTuningChanged) {
          const tuning = {
            presenceGainDb: voice.dtlnPresenceGainDb,
            makeupGainDb: voice.dtlnMakeupGainDb,
          }
          this.activeLink?.applyUplinkDtlnTuning(tuning)
          this.pendingLink?.applyUplinkDtlnTuning(tuning)
          this.activeLink?.applyDownlinkDtlnTuning(tuning)
          this.pendingLink?.applyDownlinkDtlnTuning(tuning)
        }
      }
      if (downlinkChanged) {
        this.activeLink?.refreshNoiseSuppression()
        this.pendingLink?.refreshNoiseSuppression()
      }
    })
  }

  // ---------------------------------------------------------------------------
  // 公开操作
  // ---------------------------------------------------------------------------

  /** 点击语音频道即加入；已在同服其他频道时 = 切频道（服务端自动先离开） */
  async join(guildId: string, channelId: string): Promise<void> {
    const store = useVoiceStore.getState()
    const existing = store.session
    if (
      existing &&
      existing.channelId === channelId &&
      existing.phase !== "recovering" &&
      existing.phase !== "suspended"
    ) {
      return // 已在该频道
    }

    // 继承当前静音偏好（未入会时也可能已按下闭麦）
    const selfMute = existing?.selfMute ?? false
    const selfDeaf = existing?.selfDeaf ?? false

    vlog("join 请求", {
      guildId,
      channelId,
      selfMute,
      selfDeaf,
      switching: Boolean(existing),
    })
    // 迁移中切频道：丢弃在途迁移状态（docs 13 §6）
    this.clearRecovery()
    this.abortPendingLink("join")
    this.migration = null
    // 切频道：观看白名单不跨频道保留
    this.watchedVideo = {}
    this.destroyActiveLink()

    useVoiceStore.getState().setSession({
      guildId,
      channelId,
      sessionId: null,
      phase: "joining",
      caps: [],
      selfMute,
      selfDeaf,
      serverMute: existing?.serverMute ?? false,
      serverDeaf: existing?.serverDeaf ?? false,
      migrating: false,
      listenOnly: false,
      recoveringSince: null,
      error: null,
    })

    const epoch = ++this.refreshEpoch
    let result
    try {
      result = await joinVoice({
        guild_id: guildId,
        channel_id: channelId,
        self_mute: selfMute,
        self_deaf: selfDeaf,
      })
    } catch (error) {
      verror("join 失败", error)
      if (this.refreshEpoch === epoch) {
        toast.error(joinErrorMessage(error))
        // 用户主动发起的 join 失败：回到之前状态（不自动重试）
        useVoiceStore.getState().setSession(null)
        this.info = null
      }
      return
    }
    if (this.refreshEpoch !== epoch) return // 期间用户又点了别的频道 / 已离开

    if (result.move) {
      vlog("切频道（服务端已自动离开旧频道）", {
        previous: result.previous_channel_id,
        force_reconnect: result.force_reconnect,
      })
    }

    this.info = {
      guildId,
      channelId,
      token: result.token,
      wssUrl: result.advertise_wss_url || result.sfu_endpoint,
      nodeId: result.node_id ?? null,
      roomId: result.room_id ?? null,
      sessionId: result.session_id ?? null,
      expiresAtMs: parseExpiresAt(result.expires_at, result.token),
    }
    useVoiceStore.getState().patchSession({
      caps: capsList(result.caps),
      sessionId: result.session_id ?? null,
    })
    await this.startActiveLink()
  }

  /** 断开按钮：REST leave + 完整本地清理（迁移中断开 = 服务端取消迁移 job） */
  async leave(): Promise<void> {
    const guildId =
      this.info?.guildId ?? useVoiceStore.getState().session?.guildId
    vlog("leave", { guildId })
    this.cleanupToIdle()
    if (!guildId) return
    try {
      await leaveVoice(guildId)
    } catch (error) {
      // 本地已关闭连接，SFU 会经 ICE 超时最终一致校正（docs 09 FR-06）
      vwarn("leaveVoice 上报失败（忽略）", error)
    }
  }

  /** 自我静音：本地立即停采（乐观 <50ms）+ REST 上报广播 */
  setMute(mute: boolean) {
    const session = useVoiceStore.getState().session
    if (!session) return
    // 闭听状态下不允许单独取消静音（deafen 必 mute，对标 Discord）
    if (session.selfDeaf && !mute) return
    useVoiceStore.getState().patchSession({ selfMute: mute })
    this.prevMuteBeforeDeaf = mute
    this.applyMicState()
    vlog("self_mute →", mute)
    void updateSelfVoiceState({
      guild_id: session.guildId,
      self_mute: mute,
    }).catch((error) => vwarn("self_mute 上报失败", error))
  }

  /** 自我闭听：停止播放全部下行 + 联动 mute；取消闭听恢复之前的 mute 状态 */
  setDeaf(deaf: boolean) {
    const session = useVoiceStore.getState().session
    if (!session) return
    let nextMute: boolean
    if (deaf) {
      this.prevMuteBeforeDeaf = session.selfMute
      nextMute = true
    } else {
      nextMute = this.prevMuteBeforeDeaf
    }
    useVoiceStore
      .getState()
      .patchSession({ selfDeaf: deaf, selfMute: nextMute })
    this.activeLink?.setDeafened(deaf)
    this.pendingLink?.setDeafened(deaf)
    this.applyMicState()
    vlog("self_deaf →", deaf, "self_mute →", nextMute)
    void updateSelfVoiceState({
      guild_id: session.guildId,
      self_mute: nextMute,
      self_deaf: deaf,
    }).catch((error) => vwarn("self_deaf 上报失败", error))
  }

  toggleMute() {
    const session = useVoiceStore.getState().session
    if (session) this.setMute(!session.selfMute)
  }

  toggleDeaf() {
    const session = useVoiceStore.getState().session
    if (session) this.setDeaf(!session.selfDeaf)
  }

  /** 本地静音某用户 = 真实退订（省带宽）；持久化，重连/迁移后重放 */
  setLocalMute(userId: string, muted: boolean) {
    useVoiceStore.getState().setLocalMuted(userId, muted)
    this.activeLink?.setLocalMute(userId, muted)
    this.pendingLink?.setLocalMute(userId, muted)
    vlog("本地静音", userId, "→", muted)
  }

  /**
   * 对某用户开/关「本地为其降噪」（docs 20 FR-R01/R06）：
   * 写 settings.voice.localNs（跨端同步，决议 R4）；下行链重算由
   * bindNoiseSettingsWatch 的订阅统一驱动。名单超上限时提示并拒绝。
   */
  setLocalNs(userId: string, enabled: boolean) {
    const ok = useSettingsStore.getState().setLocalNs(userId, enabled)
    if (!ok) {
      toast.error("本地降噪名单已达上限（500 人），请先清理")
      return
    }
    // FR-R09 / 决议 R6：同时降噪路数软上限（DFN 4 / 轻量 8，设置可覆盖）——仅提示不拦截
    if (enabled) {
      const voice = useSettingsStore.getState().voice
      const count = Object.keys(voice.localNs ?? {}).length
      const model =
        voice.localNsModels?.[userId] ??
        downlinkWasmModel(voice.nsModel ?? "rnnoise")
      const limit = voice.localNsMaxTracks ?? downlinkNsSoftLimit(model)
      if (count > limit) {
        toast.warning(
          `同时降噪人数较多（${count} 人，建议 ≤${limit}），可能影响性能`,
        )
      }
    }
    vlog("本地降噪", userId, "→", enabled)
  }

  /** 每用户本地音量（百分比 0–500）；持久化，重连/迁移后重放（FR-21） */
  setUserVolume(userId: string, percent: number) {
    useVoiceStore.getState().setUserVolume(userId, percent)
    this.activeLink?.setUserVolume(userId, percent)
    this.pendingLink?.setUserVolume(userId, percent)
    vlog("本地音量", userId, "→", percent)
  }

  // ---------------------------------------------------------------------------
  // 屏幕共享增量接口（docs 11；编排在 lib/voice/screen-share.ts）
  // ---------------------------------------------------------------------------

  /**
   * 观看端按需订阅某发布者的屏幕轨（协议 §2.1 subscribe kinds=["video"]）。
   * 与本地静音（audio 维度）互相独立：被本地静音的用户开播，点观看只订其视频。
   */
  startWatchingVideo(userId: string) {
    this.watchedVideo[userId] = true
    this.activeLink?.setVideoSubscription(userId, true)
    this.pendingLink?.setVideoSubscription(userId, true)
    vlog("观看视频订阅", userId)
  }

  /** 停止观看：退订该发布者的视频轨（unsubscribe kinds=["video"]） */
  stopWatchingVideo(userId: string) {
    if (!this.watchedVideo[userId]) return
    delete this.watchedVideo[userId]
    this.activeLink?.setVideoSubscription(userId, false)
    this.pendingLink?.setVideoSubscription(userId, false)
    vlog("停止观看，退订视频", userId)
  }

  /** 停止观看全部（离开语音频道视图 / 切频道时收口） */
  stopAllWatching() {
    for (const userId of Object.keys(this.watchedVideo)) {
      this.stopWatchingVideo(userId)
    }
  }

  /**
   * 屏幕共享发起前的 caps 收口（docs 11 BC.1 步骤 2）：
   * start 占坑成功后服务端已重算 caps，主动 refresh token 并经 auth 帧在位重发，
   * 返回新 caps（含 publish_screen 才允许继续发布）。失败返回 null。
   */
  async ensureScreenCaps(): Promise<string[] | null> {
    const session = useVoiceStore.getState().session
    if (!session) return null
    // 当前 caps 已含 publish_screen（如迁移后 token 保留）则无需刷新
    if (session.caps.includes("publish_screen")) return session.caps
    const info = this.info
    const link = this.activeLink
    if (!info || !link?.isSignalingOpen) return null
    const epoch = this.refreshEpoch
    try {
      const result = await refreshVoiceToken(info.guildId)
      if (epoch !== this.refreshEpoch || this.activeLink !== link || !this.info)
        return null
      this.info.token = result.token
      this.info.expiresAtMs = parseExpiresAt(result.expires_at, result.token)
      const caps = capsList(result.caps)
      this.applyCaps(caps)
      this.refreshFailCount = 0
      link.updateToken(result.token, this.info.expiresAtMs)
      this.scheduleTokenRefresh()
      return caps
    } catch (error) {
      vwarn("屏幕共享 token 刷新失败", error)
      return null
    }
  }

  /** 在当前链路上发布屏幕轨（addTrack + createOffer 重协商） */
  async publishScreenTrack(
    track: MediaStreamTrack,
    stream: MediaStream
  ): Promise<boolean> {
    const link = this.activeLink
    if (!link || !link.isSignalingOpen) return false
    try {
      return await link.publishScreen(track, stream)
    } catch (error) {
      verror("屏幕轨发布失败", error)
      return false
    }
  }

  /** 停止屏幕轨发布（removeTrack + 重协商，尽力而为） */
  async unpublishScreenTrack(): Promise<void> {
    await this.activeLink?.unpublishScreen()
  }

  /** 恢复循环耗尽 / 长时间未恢复时的手动重试入口（重置退避，FR-20） */
  retry() {
    const session = useVoiceStore.getState().session
    if (!session) return
    vlog("手动重试")
    this.recoveryAttempts = 0
    this.iceRestartAttempts = 0
    this.suspendedAction = null
    useVoiceStore.getState().patchSession({ error: null, phase: "recovering" })
    void this.fullRejoin()
  }

  // ---------------------------------------------------------------------------
  // Gateway 事件入口（gateway-bindings 接线）
  // ---------------------------------------------------------------------------

  handleVoiceStateUpdate(payload: VoiceStateUpdatePayload) {
    const selfId = useAuthStore.getState().user?.id
    if (!selfId || payload.user_id !== selfId) return

    // 管理员断开：关闭连接且不自动重连（docs 09 FR-30）
    if (payload.reason === "ADMIN_DISCONNECT") {
      vlog("收到 ADMIN_DISCONNECT")
      if (useVoiceStore.getState().session) {
        this.cleanupToIdle()
        toast.error("你已被管理员移出语音频道")
      }
      return
    }

    const session = useVoiceStore.getState().session
    if (!session) return
    if (payload.guild_id && payload.guild_id !== session.guildId) return

    // 服务端权威把我们移出语音（如他端顶替）：不自动重连。
    // 但进房/重进途中 join 会先 internalLeave（同频道重进也摘旧会话）并广播
    // channel_id=null——若此时当踢出处理会清掉 session，导致刷新后「进不去」。
    if (
      Object.prototype.hasOwnProperty.call(payload, "channel_id") &&
      !payload.channel_id &&
      payload.connected === false
    ) {
      const midConnect =
        session.phase === "joining" ||
        session.phase === "signaling" ||
        session.phase === "negotiating" ||
        session.phase === "recovering"
      if (midConnect) {
        vlog("忽略进房途中的 leave 事件（同频道重进/摘旧会话）", {
          phase: session.phase,
        })
        return
      }
      vlog("VOICE_STATE_UPDATE：服务端已将本端移出语音")
      this.cleanupToIdle()
      toast.info("语音连接已断开")
      return
    }

    const patch: Partial<VoiceSession> = {}
    if (typeof payload.server_mute === "boolean")
      patch.serverMute = payload.server_mute
    if (typeof payload.server_deaf === "boolean")
      patch.serverDeaf = payload.server_deaf
    // 被管理员移动频道：跟随更新（媒体面由 VOICE_SERVER_UPDATE / re-join 收敛）
    if (payload.channel_id && payload.channel_id !== session.channelId) {
      patch.channelId = payload.channel_id
      if (this.info) this.info.channelId = payload.channel_id
    }
    if (Object.keys(patch).length > 0) {
      useVoiceStore.getState().patchSession(patch)
      this.applyMicState()
    }
  }

  /**
   * 换节点指令（FR-04）：
   *   - 同节点 = token/参数在位更新（重发 auth，无需重建 PC）；
   *   - 旧链路已死 = 直接以新目标重建（无双 PC 意义）；
   *   - 否则 = 双 PC 热切（保持旧链路收发，并行建 pendingLink）。
   * 乱序/重复事件以最后收到者为准：在途 pendingLink 目标不同则中止重来（docs 13 §6）。
   */
  handleVoiceServerUpdate(payload: VoiceServerUpdatePayload) {
    const session = useVoiceStore.getState().session
    if (!session || payload.guild_id !== session.guildId) return
    vlog("VOICE_SERVER_UPDATE", {
      node_id: payload.node_id,
      migration_id: payload.migration_id,
    })
    this.clearDrainingWait()

    const endpoint =
      payload.advertise_wss_url || payload.sfu_endpoint || payload.endpoint
    if (!payload.token || !endpoint) {
      vwarn("VOICE_SERVER_UPDATE 缺 token/endpoint，转完整重进")
      this.recoverStart()
      this.scheduleRecovery(() => this.fullRejoin())
      return
    }
    if (payload.migration_id || this.migration)
      this.ensureMigration(payload.migration_id ?? null)
    if (this.migration) this.migration.sawServerUpdate = true

    // 同节点 = token/参数在位更新，无需重建（docs 13 §6）；迁移事件 token 优先（FR-11）
    if (
      this.info &&
      payload.node_id &&
      payload.node_id === this.info.nodeId &&
      this.activeLink?.isSignalingOpen
    ) {
      vlog("VOICE_SERVER_UPDATE 指向当前节点：auth 在位重发")
      this.abortPendingLink("retarget_same_node")
      this.refreshEpoch += 1 // 丢弃在途刷新结果
      this.info.token = payload.token
      this.info.expiresAtMs = parseExpiresAt(payload.expires_at, payload.token)
      if (payload.session_id) this.info.sessionId = payload.session_id
      if (payload.caps)
        useVoiceStore.getState().patchSession({ caps: capsList(payload.caps) })
      this.activeLink.updateToken(
        this.info.token,
        this.info.expiresAtMs,
        payload.session_id
      )
      this.scheduleTokenRefresh()
      this.finishMigration("same_node_auth")
      return
    }

    const target: VoiceLinkTarget = {
      guildId: session.guildId,
      channelId: payload.channel_id ?? session.channelId,
      token: payload.token,
      wssUrl: endpoint,
      nodeId: payload.node_id ?? null,
      roomId: this.info?.roomId ?? null,
      sessionId: payload.session_id ?? null,
      expiresAtMs: parseExpiresAt(payload.expires_at, payload.token),
    }
    if (payload.caps)
      useVoiceStore.getState().patchSession({ caps: capsList(payload.caps) })

    // 旧链路已死：无热切基础，直接以服务端指派的新目标重建
    if (!this.activeLink || !this.activeLink.isSignalingOpen) {
      vevent("migration_direct_rebuild", {
        migrationId: this.migration?.id,
        detail: { node_id: target.nodeId },
      })
      this.abortPendingLink("direct_rebuild")
      this.clearRecovery()
      this.info = target
      useVoiceStore.getState().patchSession({ migrating: true })
      void this.startActiveLink()
      return
    }

    // 双 PC 热切：旧链路保持收发，pendingLink 并行建立（上行禁发直到 CUTOVER）
    this.abortPendingLink("retarget")
    useVoiceStore.getState().patchSession({ migrating: true })
    vevent("migration_pending_start", {
      migrationId: this.migration?.id,
      detail: { from_node: this.info?.nodeId ?? null, to_node: target.nodeId },
    })
    const pending = new VoiceLink(
      target,
      {
        uplinkAllowed: false,
        micWanted: canPublishAudio(useVoiceStore.getState().session ?? session),
        deafened: session.selfDeaf,
        localMuted: useVoiceStore.getState().localMuted,
        // 新链路 ready 后重放视频剪枝：白名单外全员退订、观看中的保持订阅
        watchedVideo: this.watchedVideo,
        userVolumes: useVoiceStore.getState().userVolumes,
        migrationId: this.migration?.id,
      },
      this.linkCallbacks()
    )
    this.pendingLink = pending
    // FR-07：约 8s 未连通 → 放弃新链路、保持旧链路，等服务端换目标（不自行选点）
    this.pendingConnectTimer = setTimeout(() => {
      this.pendingConnectTimer = null
      if (this.pendingLink !== pending) return
      vevent("migration_connect_timeout", {
        migrationId: this.migration?.id,
        durationMs: Date.now() - pending.createdAt,
        detail: { node_id: target.nodeId },
      })
      this.abortPendingLink("connect_timeout")
      // migrating UI 保持，等待服务端重发 VOICE_SERVER_UPDATE
    }, MIGRATION_CONNECT_TIMEOUT_MS)
    void pending.start().catch((error) => {
      verror("pendingLink 启动失败", error)
      if (this.pendingLink === pending) this.abortPendingLink("start_failed")
    })
  }

  handleVoiceCapsUpdate(payload: VoiceCapsUpdatePayload) {
    const selfId = useAuthStore.getState().user?.id
    if (!selfId || payload.user_id !== selfId) return
    const session = useVoiceStore.getState().session
    if (!session || payload.guild_id !== session.guildId) return
    this.applyCaps(capsList(payload.caps))
  }

  handleVoiceMigrating(payload: VoiceMigratingPayload) {
    const selfId = useAuthStore.getState().user?.id
    if (!selfId || payload.user_id !== selfId) return
    const session = useVoiceStore.getState().session
    if (!session || payload.guild_id !== session.guildId) return
    vlog("VOICE_MIGRATING", payload.migration_id)
    this.ensureMigration(payload.migration_id)
    useVoiceStore.getState().patchSession({ migrating: true })
  }

  handleVoiceMigrated(payload: VoiceMigratedPayload) {
    const selfId = useAuthStore.getState().user?.id
    if (!selfId || payload.user_id !== selfId) return
    const session = useVoiceStore.getState().session
    if (!session || payload.guild_id !== session.guildId) return
    vlog("VOICE_MIGRATED", payload.migration_id)
    if (this.pendingLink) {
      // 新链路尚未连通：保持迁移态，待 CUTOVER 收口（FR-06 允许以新 PC 稳定为准）
      vlog("VOICE_MIGRATED 早于本地 CUTOVER，保持迁移态等待新链路连通")
      return
    }
    this.finishMigration("migrated_event")
  }

  // ---------------------------------------------------------------------------
  // VoiceLink 回调（按 link 身份区分 active / pending / 过期实例）
  // ---------------------------------------------------------------------------

  private linkCallbacks(): VoiceLinkCallbacks {
    return {
      onReady: (link, d) => this.handleLinkReady(link, d),
      onConnected: (link) => this.handleLinkConnected(link),
      onFirstRemoteAudio: (link) => this.handleLinkFirstRemoteAudio(link),
      onClosed: (link, info) => this.handleLinkClosed(link, info),
      onIceFailure: (link, state) => this.handleLinkIceFailure(link, state),
      onSelfSpeaking: (link, speaking) => {
        if (link !== this.activeLink) return
        useVoiceStore.getState().setSelfSpeaking(speaking)
      },
      onSpeaking: (link, userIds) => {
        if (link !== this.activeLink) return
        this.handleSpeaking(userIds)
      },
      onCapsUpdated: (link, caps) => {
        if (link !== this.activeLink) return
        this.applyCaps(caps)
      },
      onMicAvailability: (link, hasMic) => {
        if (link !== this.activeLink) return
        useVoiceStore.getState().patchSession({ listenOnly: !hasMic })
        this.applyMicState()
        if (!hasMic && !this.micWarned) {
          this.micWarned = true
          toast.warning("未获得麦克风权限，已以仅听模式加入语音")
        }
      },
      // 下行视频轨（屏幕共享观看端）：仅 activeLink 的轨进 store；
      // pendingLink 建立期到达的轨在 CUTOVER 提升时统一回灌（performCutover）
      onRemoteVideo: (link, userId, stream) => {
        if (link !== this.activeLink) return
        useStageStore.getState().setRemoteVideo(userId, stream)
      },
    }
  }

  private handleLinkReady(link: VoiceLink, d: ReadyPayload) {
    if (link === this.activeLink) {
      if (this.info) {
        this.info.sessionId = link.target.sessionId
        this.info.roomId = link.target.roomId
      }
      useVoiceStore.getState().patchSession({
        phase: "negotiating",
        sessionId: d.session_id ?? null,
      })
    }
    // pendingLink 的 ready 仅推进自身协商（sessionId 在 CUTOVER 提升时落库）
  }

  private handleLinkConnected(link: VoiceLink) {
    if (link === this.pendingLink) {
      this.performCutover()
      return
    }
    if (link !== this.activeLink) return

    vlog("媒体连通 CONNECTED")
    this.refreshFailCount = 0
    this.iceRestartAttempts = 0
    this.clearIceRestartWatchdog()
    useVoiceStore.getState().patchSession({
      phase: "connected",
      error: null,
      recoveringSince: null,
    })
    // 直接重建路径的迁移在此收口；双 PC 在途时保持迁移态。
    // 仅收到 VOICE_MIGRATING（还没有 VOICE_SERVER_UPDATE）时的旧链路自愈不算迁移完成，
    // 不 ack，等服务端继续推进。
    if (!this.pendingLink && this.migration?.sawServerUpdate) {
      this.finishMigration("direct_rebuild")
    }
    // 稳定运行一段时间后重置故障窗口
    if (this.stableTimer) clearTimeout(this.stableTimer)
    this.stableTimer = setTimeout(() => {
      this.recoveryAttempts = 0
      this.iceRestartAttempts = 0
    }, STABLE_RESET_MS)
  }

  /** 接收侧就绪：新链路首个下行音频到达 → 旧链路下行整体静音防双声（FR-04.4） */
  private handleLinkFirstRemoteAudio(link: VoiceLink) {
    if (link !== this.pendingLink || !this.activeLink) return
    this.activeLink.setPlaybackMuted(true)
    vevent("migration_recv_switch", {
      migrationId: this.migration?.id,
      durationMs: Date.now() - link.createdAt,
    })
  }

  /**
   * CUTOVER（FR-04.5/6）：pendingLink PC 连通 →
   *   1. 旧链路上行 track.stop()（先停旧，禁止双发；允许瞬间极短静音）；
   *   2. 新链路上行放行；3. 旧链路下行静音兜底；
   *   4. 提升 pending 为 active、token 刷新定时器切到新 expires_at；
   *   5. 销毁旧链路（CLEANUP，旧节点已死时 destroy 即尽力而为）；6. ack + 埋点。
   */
  private performCutover() {
    const pending = this.pendingLink
    if (!pending) return
    const old = this.activeLink
    const session = useVoiceStore.getState().session
    this.clearPendingConnectTimer()
    this.pendingLink = null

    vlog("CUTOVER 开始", {
      migration_id: this.migration?.id,
      new_sid: pending.target.sessionId,
    })
    old?.stopUplink()
    pending.allowUplink()
    old?.setPlaybackMuted(true)

    // 提升与清理
    this.activeLink = pending
    this.info = pending.target
    this.clearSpeaking()
    old?.destroy()
    // 旧链路视频流失效；新链路建立期已到达的视频轨回灌（观看中迁移不黑屏），
    // 其余由新链路后续 ontrack 落位
    useStageStore.getState().clearRemoteVideos()
    for (const [userId, stream] of pending.getVideoStreams()) {
      useStageStore.getState().setRemoteVideo(userId, stream)
    }

    // token 刷新定时器跟随新链路 expires_at；在途刷新结果作废（FR-12）
    this.refreshEpoch += 1
    this.refreshFailCount = 0
    this.scheduleTokenRefresh()

    useVoiceStore.getState().patchSession({
      phase: "connected",
      sessionId: pending.target.sessionId,
      listenOnly: !pending.hasMic,
      error: null,
      recoveringSince: null,
    })
    this.applyMicState()
    if (session) pending.setDeafened(session.selfDeaf)

    this.recoveryAttempts = 0
    this.iceRestartAttempts = 0
    if (this.stableTimer) clearTimeout(this.stableTimer)
    this.stableTimer = setTimeout(() => {
      this.recoveryAttempts = 0
      this.iceRestartAttempts = 0
    }, STABLE_RESET_MS)

    vevent("cutover", {
      migrationId: this.migration?.id,
      // CUTOVER 埋点口径：新链路创建 → 上行切换完成
      durationMs: Date.now() - pending.createdAt,
      detail: {
        new_node: pending.target.nodeId,
        new_sid: pending.target.sessionId,
      },
    })
    this.finishMigration("cutover")
  }

  private handleLinkClosed(link: VoiceLink, info: VoiceCloseInfo) {
    if (link === this.pendingLink) {
      // 新节点 CONNECT 期间死亡：保持旧链路，等服务端换目标重推（docs 13 §6）
      vevent("migration_pending_closed", {
        migrationId: this.migration?.id,
        closeCode: info.code,
      })
      this.abortPendingLink("pending_closed")
      return
    }
    if (link !== this.activeLink) return // 已销毁实例的迟到回调
    vlog("信令关闭", info)
    vevent("signaling_closed", {
      closeCode: info.code,
      migrationId: this.migration?.id,
    })
    if (!this.info || !useVoiceStore.getState().session) return

    // 迁移双 PC 在途时旧链路死亡：交给 pendingLink 接管，不另起恢复循环
    if (this.pendingLink) {
      vlog("旧链路在迁移中关闭，等待新链路接管")
      this.destroyActiveLink()
      const session = useVoiceStore.getState().session
      useVoiceStore.getState().patchSession({
        phase: "recovering",
        recoveringSince: session?.recoveringSince ?? Date.now(),
      })
      return
    }

    switch (info.code) {
      case "TOKEN_EXPIRED":
        // 静默 refresh 重连；连续 2 次失败转完整 re-join（doTokenRefresh 内部收口）
        this.recoverStart()
        this.scheduleRecovery(() => this.reconnectWithRefresh())
        return
      case "TOKEN_INVALID":
      case "WRONG_NODE":
      case "ROOM_MISMATCH":
        // 本地路由信息已脏：完整 re-join 拿全新 token/node
        this.recoverStart()
        this.scheduleRecovery(() => this.fullRejoin())
        return
      case "CAP_DENIED":
        // 不重试；提示无权并退出语音态
        this.cleanupToIdle()
        toast.error("无权加入该频道")
        return
      case "SESSION_REVOKED":
        // 不自动重连；等待 Gateway 事件（如 ADMIN_DISCONNECT）说明原因
        vlog("SESSION_REVOKED：清理本地语音态，等待 Gateway 事件")
        this.cleanupToIdle()
        return
      case "NODE_DRAINING":
      case "MIGRATED":
        // 不回原节点；等 VOICE_SERVER_UPDATE，超时主动完整重进（调度器会过滤 DRAINING 节点）。
        // MIGRATED = 旧会话被迁移收尾摘除：正常情况下新链路早已接管（上面 pendingLink
        // 分支）；走到这里说明本地热切失败但服务端已推进，同样等事件兜底重进。
        this.recoverStart()
        useVoiceStore.getState().patchSession({ migrating: true })
        this.clearDrainingWait()
        this.drainingTimer = setTimeout(() => {
          this.drainingTimer = null
          vlog(`${info.code} 等待 VOICE_SERVER_UPDATE 超时，主动完整重进`)
          this.scheduleRecovery(() => this.fullRejoin())
        }, DRAINING_WAIT_MS)
        return
      case "AUTH_TIMEOUT":
        // 立即重连并保证 auth 首帧优先
        this.recoverStart()
        this.scheduleRecovery(() => this.reconnectSameNode(), {
          immediate: true,
        })
        return
      default:
        // LINK_DEAD / UNKNOWN：退避重连同节点，多次失败升级为完整重进
        this.recoverStart()
        this.scheduleRecovery(() =>
          this.recoveryAttempts >= 3
            ? this.fullRejoin()
            : this.reconnectSameNode()
        )
    }
  }

  /**
   * ICE 故障（FR-14/15）：信令仍活着时优先 ICE restart（限次），失败/耗尽转重连；
   * pendingLink 的 ICE 故障 = 新节点不可达，放弃并等服务端换目标。
   */
  private handleLinkIceFailure(link: VoiceLink, state: RTCIceConnectionState) {
    if (link === this.pendingLink) {
      vwarn("pendingLink ICE 故障，放弃新链路等服务端换目标", state)
      vevent("migration_pending_closed", {
        migrationId: this.migration?.id,
        closeCode: "ICE_FAILURE",
      })
      this.abortPendingLink("ice_failure")
      return
    }
    if (link !== this.activeLink) return
    vwarn("ICE 故障", state)

    if (link.isSignalingOpen && this.iceRestartAttempts < MAX_ICE_RESTARTS) {
      void this.tryIceRestart("ice_failure").then((ok) => {
        if (!ok) this.fallbackRecovery()
      })
      return
    }
    this.fallbackRecovery()
  }

  /** ICE restart 失败 / 次数耗尽后的常规恢复路径 */
  private fallbackRecovery() {
    if (!this.info || !useVoiceStore.getState().session) return
    this.recoverStart()
    this.scheduleRecovery(() =>
      this.recoveryAttempts >= 3 ? this.fullRejoin() : this.reconnectSameNode()
    )
  }

  /** 网络路径变化 / ICE 故障但信令存活：在现有会话上做 ICE restart（FR-15） */
  private async tryIceRestart(reason: string): Promise<boolean> {
    const link = this.activeLink
    if (!link || !link.isSignalingOpen) return false
    this.iceRestartAttempts += 1
    vevent("ice_restart", {
      migrationId: this.migration?.id,
      detail: { reason, attempt: this.iceRestartAttempts },
    })
    const sent = await link.restartIce()
    if (!sent) {
      vwarn("ICE restart 未能发出（PC/信令不可用）")
      return false
    }
    // 看门狗：restart 后可能长期卡 checking（不触发 failed 事件），限时未连通转重连
    this.clearIceRestartWatchdog()
    this.iceRestartWatchdog = setTimeout(() => {
      this.iceRestartWatchdog = null
      if (this.activeLink !== link || link.isMediaConnected) return
      vwarn("ICE restart 超时未恢复，转常规重连")
      this.fallbackRecovery()
    }, ICE_RESTART_WATCHDOG_MS)
    return true
  }

  private clearIceRestartWatchdog() {
    if (this.iceRestartWatchdog) {
      clearTimeout(this.iceRestartWatchdog)
      this.iceRestartWatchdog = null
    }
  }

  // ---------------------------------------------------------------------------
  // 链路建立与迁移收口
  // ---------------------------------------------------------------------------

  /** 用当前 this.info 建立 activeLink（join / 重连 / 换节点直接重建共用） */
  private async startActiveLink(): Promise<void> {
    const info = this.info
    if (!info || !useVoiceStore.getState().session) return
    this.destroyActiveLink()
    useVoiceStore.getState().patchSession({ phase: "signaling" })

    const session = useVoiceStore.getState().session
    const link = new VoiceLink(
      info,
      {
        uplinkAllowed: true,
        micWanted: session ? canPublishAudio(session) : false,
        deafened: session?.selfDeaf ?? false,
        localMuted: useVoiceStore.getState().localMuted,
        // ready 后重放视频剪枝：白名单外全员退订、观看中的保持订阅
        watchedVideo: this.watchedVideo,
        userVolumes: useVoiceStore.getState().userVolumes,
        migrationId: this.migration?.id,
      },
      this.linkCallbacks()
    )
    this.activeLink = link
    this.refreshEpoch += 1
    await link.start()
    if (this.activeLink !== link) return
    this.scheduleTokenRefresh()
  }

  /** 记录迁移上下文（VOICE_MIGRATING 与 VOICE_SERVER_UPDATE 任一先到均可，FR-06） */
  private ensureMigration(id: string | null) {
    if (!this.migration) {
      this.migration = { id, startedAtMs: Date.now(), sawServerUpdate: false }
      vevent("migration_start", { migrationId: id })
      return
    }
    if (id && this.migration.id !== id) {
      // 新一轮迁移覆盖旧的（乱序/换目标场景以最新为准）
      this.migration.id = id
    }
  }

  /** 迁移收口：ack + 端到端埋点 + 清迁移 UI */
  private finishMigration(source: string) {
    const migration = this.migration
    useVoiceStore.getState().patchSession({ migrating: false })
    if (!migration) return
    this.migration = null
    vevent("migration_complete", {
      migrationId: migration.id,
      durationMs: Date.now() - migration.startedAtMs,
      detail: { source },
    })
    if (migration.id) {
      vlog("ackVoiceMigration", migration.id)
      void ackVoiceMigration(migration.id).catch((error) =>
        vwarn("迁移 ack 失败", error)
      )
    }
  }

  /** 放弃在途 pendingLink（超时/失败/换目标/离开）；旧链路不受影响 */
  private abortPendingLink(reason: string) {
    this.clearPendingConnectTimer()
    if (!this.pendingLink) return
    vlog("放弃 pendingLink", { reason })
    this.pendingLink.destroy()
    this.pendingLink = null
  }

  private clearPendingConnectTimer() {
    if (this.pendingConnectTimer) {
      clearTimeout(this.pendingConnectTimer)
      this.pendingConnectTimer = null
    }
  }

  // ---------------------------------------------------------------------------
  // caps / 说话指示 / 麦克风
  // ---------------------------------------------------------------------------

  private applyCaps(caps: string[]) {
    const session = useVoiceStore.getState().session
    if (!session) return
    const hadPublish = session.caps.includes("publish_audio")
    const hasPublish = caps.includes("publish_audio")
    useVoiceStore.getState().patchSession({ caps })
    this.applyMicState()
    vlog("caps 更新", caps)
    // 舞台模式下 publish_audio 随上/下台增减是常态，专属提示由 stage_role 事件驱动
    // （docs 10 AD.5：抱下 ≠ 静音，两者渲染必须区分），此处不再叠加静音 toast。
    const stage = useStageStore.getState().byChannel[session.channelId]
    const isStage = stage?.instanceKnown
      ? stage.mode === "STAGE"
      : inferChannelMode(
          useVoiceStore.getState().byChannel[session.channelId]
        ) === "STAGE"
    if (isStage) return
    if (hadPublish && !hasPublish) {
      toast.error("你已被服务器静音")
    } else if (!hadPublish && hasPublish && session.caps.length > 0) {
      // 恢复权限仅提示，不自动开麦（FR-26）
      toast.info("你已被解除静音")
    }
  }

  /**
   * 恢复说话收口：
   * self_mute=false ∧ server_mute=false ∧ caps 含 publish_audio
   * ∧（非 PTT 模式 或 正在按住 PTT 键）
   */
  private applyMicState() {
    const session = useVoiceStore.getState().session
    if (!session) return
    let wanted = canPublishAudio(session)
    if (wanted) {
      const voice = useSettingsStore.getState().voice
      if (voice.inputMode === "push-to-talk" && !this.pttHeld) {
        wanted = false
      }
    }
    this.activeLink?.setMicWanted(wanted)
    // pendingLink 同步意愿（上行闸门仍关，CUTOVER 放行时即为正确状态）
    this.pendingLink?.setMicWanted(wanted)
  }

  private handleSpeaking(userIds: string[]) {
    const incoming = new Set(userIds)
    for (const id of userIds) {
      const timer = this.speakingFadeTimers.get(id)
      if (timer) {
        clearTimeout(timer)
        this.speakingFadeTimers.delete(id)
      }
      this.speakingActive.add(id)
    }
    for (const id of this.speakingActive) {
      if (incoming.has(id) || this.speakingFadeTimers.has(id)) continue
      this.speakingFadeTimers.set(
        id,
        setTimeout(() => {
          this.speakingFadeTimers.delete(id)
          this.speakingActive.delete(id)
          useVoiceStore.getState().setSpeakingUserIds([...this.speakingActive])
        }, SPEAKING_FADE_MS)
      )
    }
    useVoiceStore.getState().setSpeakingUserIds([...this.speakingActive])
  }

  private clearSpeaking() {
    for (const timer of this.speakingFadeTimers.values()) clearTimeout(timer)
    this.speakingFadeTimers.clear()
    this.speakingActive.clear()
    useVoiceStore.getState().setSpeakingUserIds([])
    useVoiceStore.getState().setSelfSpeaking(false)
  }

  // ---------------------------------------------------------------------------
  // Token 刷新（exp − 45s ± 10s，auth 帧在位重发；定时器跟随 activeLink）
  // ---------------------------------------------------------------------------

  private scheduleTokenRefresh() {
    if (this.refreshTimer) clearTimeout(this.refreshTimer)
    const info = this.info
    if (!info) return
    // 缺 exp 时按 TTL 3 分钟的保守周期刷新
    const jitter = Math.random() * REFRESH_JITTER_MS * 2 - REFRESH_JITTER_MS
    const delay = info.expiresAtMs
      ? Math.max(
          5_000,
          info.expiresAtMs - Date.now() - REFRESH_LEAD_MS + jitter
        )
      : 90_000
    vlog("token 刷新已排期", Math.round(delay / 1000), "s 后")
    this.refreshTimer = setTimeout(() => {
      void this.doTokenRefresh()
    }, delay)
  }

  private async doTokenRefresh(): Promise<void> {
    const info = this.info
    const link = this.activeLink
    if (!info || !link) return
    const epoch = this.refreshEpoch
    try {
      const result = await refreshVoiceToken(info.guildId)
      // 刷新与迁移竞争：期间发生迁移/重建则丢弃在途刷新结果（FR-11/12）
      if (
        epoch !== this.refreshEpoch ||
        this.activeLink !== link ||
        !this.info
      ) {
        vlog("token 刷新结果作废（期间发生迁移/链路重建）")
        return
      }
      vlog("token 刷新成功，auth 在位重发")
      this.info.token = result.token
      this.info.expiresAtMs = parseExpiresAt(result.expires_at, result.token)
      this.applyCaps(capsList(result.caps))
      this.refreshFailCount = 0
      link.updateToken(result.token, this.info.expiresAtMs)
      this.scheduleTokenRefresh()
    } catch (error) {
      if (epoch !== this.refreshEpoch || this.activeLink !== link || !this.info)
        return
      // 403 = caps 已无 join，按被踢处理（等 Gateway 事件说明具体原因）
      if (error instanceof ApiError && error.status === 403) {
        verror("token 刷新 403：已无语音权限，退出语音", error)
        this.cleanupToIdle()
        toast.error("你已被移出语音频道")
        return
      }
      this.refreshFailCount += 1
      vwarn(`token 刷新失败（第 ${this.refreshFailCount} 次）`, error)
      if (this.refreshFailCount >= 2) {
        this.recoverStart()
        this.scheduleRecovery(() => this.fullRejoin())
      } else {
        this.refreshTimer = setTimeout(() => void this.doTokenRefresh(), 5_000)
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 恢复 / 退避 / 断网挂起
  // ---------------------------------------------------------------------------

  /** 进入 RECOVERING：关掉当前链路，保留 UI 会话（绝不回未连接态，FR-19） */
  private recoverStart() {
    const session = useVoiceStore.getState().session
    useVoiceStore.getState().patchSession({
      phase: "recovering",
      error: null,
      recoveringSince: session?.recoveringSince ?? Date.now(),
    })
    this.destroyActiveLink()
  }

  /**
   * 退避调度一次恢复动作；单故障窗口 ≤5 次，耗尽后停止并给手动重试入口。
   * 断网（offline）时挂起不计次，online 事件立即执行（FR-20）。
   */
  private scheduleRecovery(
    action: () => Promise<void>,
    opts?: { immediate?: boolean }
  ) {
    if (this.recoverTimer) return // 已有恢复动作在途
    if (!this.online) {
      this.suspendRecovery(action)
      return
    }
    if (this.recoveryAttempts >= MAX_RECOVERY_ATTEMPTS) {
      vwarn("恢复次数耗尽，停止自动重试")
      useVoiceStore.getState().patchSession({
        phase: "recovering",
        migrating: false,
        error: "语音连接失败，请重试",
      })
      return
    }
    this.recoveryAttempts += 1
    const base = Math.min(
      BACKOFF_CAP_MS,
      BACKOFF_BASE_MS * BACKOFF_MULTIPLIER ** (this.recoveryAttempts - 1)
    )
    const jitter = 1 - BACKOFF_JITTER + Math.random() * BACKOFF_JITTER * 2
    const delay = opts?.immediate ? 0 : Math.round(base * jitter)
    vlog(`恢复动作已排期（第 ${this.recoveryAttempts} 次，${delay}ms 后）`)
    this.recoverTimer = setTimeout(() => {
      this.recoverTimer = null
      if (!this.online) {
        this.suspendRecovery(action)
        return
      }
      void action().catch((error) => {
        verror("恢复动作失败", error)
        if (!this.info || !useVoiceStore.getState().session) return
        this.scheduleRecovery(() => this.fullRejoin())
      })
    }, delay)
  }

  /** 断网挂起：暂停退避计时，动作暂存等 online 立即执行（FR-20 / SUSPENDED 态） */
  private suspendRecovery(action: () => Promise<void>) {
    this.suspendedAction = action
    useVoiceStore.getState().patchSession({ phase: "suspended" })
    vevent("suspend")
    vlog("本机离线，恢复动作挂起等待网络")
  }

  private handleOffline() {
    this.online = false
    const session = useVoiceStore.getState().session
    if (!session) return
    vlog("offline 事件")
    // 退避计时中：取消定时器转挂起（动作在 scheduleRecovery 的 timer 回调里兜底转挂起，
    // 这里主动提前转，避免白等一轮退避）
    if (this.recoverTimer) {
      clearTimeout(this.recoverTimer)
      this.recoverTimer = null
      if (session.phase === "recovering") {
        this.suspendRecovery(() => this.fullRejoin())
      }
    }
  }

  private handleOnline() {
    this.online = true
    const session = useVoiceStore.getState().session
    if (!session) return
    vevent("resume")

    const action = this.suspendedAction
    if (action) {
      // 挂起的恢复动作：网络恢复立即重试（不计入退避次数）
      this.suspendedAction = null
      useVoiceStore.getState().patchSession({ phase: "recovering" })
      void action().catch((error) => {
        verror("网络恢复后的恢复动作失败", error)
        if (!this.info || !useVoiceStore.getState().session) return
        this.scheduleRecovery(() => this.fullRejoin())
      })
      return
    }
    // 会话仍在但网络路径可能已变化：优先 ICE restart 而非重建（FR-15）
    if (session.phase === "connected" && this.activeLink?.isSignalingOpen) {
      void this.tryIceRestart("online_event")
    }
  }

  /** 用现有 token 重连同节点（AUTH_TIMEOUT / 链路抖动） */
  private async reconnectSameNode(): Promise<void> {
    if (!this.info || !useVoiceStore.getState().session) return
    vlog("重连同节点", this.info.wssUrl)
    await this.startActiveLink()
  }

  /** TOKEN_EXPIRED：先 refresh 再重连同节点 */
  private async reconnectWithRefresh(): Promise<void> {
    const info = this.info
    if (!info || !useVoiceStore.getState().session) return
    try {
      const result = await refreshVoiceToken(info.guildId)
      if (!this.info) return
      this.info.token = result.token
      this.info.expiresAtMs = parseExpiresAt(result.expires_at, result.token)
      useVoiceStore.getState().patchSession({ caps: capsList(result.caps) })
      this.refreshFailCount = 0
      await this.startActiveLink()
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        this.cleanupToIdle()
        toast.error("你已被移出语音频道")
        return
      }
      this.refreshFailCount += 1
      vwarn("重连前 refresh 失败", error)
      if (this.refreshFailCount >= 2) {
        this.scheduleRecovery(() => this.fullRejoin())
      } else {
        this.scheduleRecovery(() => this.reconnectWithRefresh())
      }
    }
  }

  /** 完整重进（FR-19）：重新 POST /voice/join 拿全新 token/node（UI 保持「频道内 + 重连中」） */
  private async fullRejoin(): Promise<void> {
    const session = useVoiceStore.getState().session
    if (!session) return
    vlog("完整重进 re-join", session.channelId)
    vevent("full_rejoin", { migrationId: this.migration?.id })
    this.abortPendingLink("full_rejoin")
    try {
      const result = await joinVoice({
        guild_id: session.guildId,
        channel_id: session.channelId,
        self_mute: session.selfMute,
        self_deaf: session.selfDeaf,
      })
      if (!useVoiceStore.getState().session) return
      this.info = {
        guildId: session.guildId,
        channelId: session.channelId,
        token: result.token,
        wssUrl: result.advertise_wss_url || result.sfu_endpoint,
        nodeId: result.node_id ?? null,
        roomId: result.room_id ?? null,
        sessionId: result.session_id ?? null,
        expiresAtMs: parseExpiresAt(result.expires_at, result.token),
      }
      this.refreshFailCount = 0
      useVoiceStore.getState().patchSession({ caps: capsList(result.caps) })
      await this.startActiveLink()
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        // 权限类失败不再自动重试
        this.cleanupToIdle()
        toast.error(joinErrorMessage(error))
        return
      }
      vwarn("re-join 失败", error)
      this.scheduleRecovery(() => this.fullRejoin())
    }
  }

  // ---------------------------------------------------------------------------
  // 清理
  // ---------------------------------------------------------------------------

  /**
   * 销毁 activeLink（destroy 顺序见 VoiceLink.destroy）+ 停 token 刷新与稳定计时；
   * 保留 store 会话、恢复计数与 pendingLink（重连/迁移路径复用）。
   */
  private destroyActiveLink() {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer)
      this.refreshTimer = null
    }
    if (this.stableTimer) {
      clearTimeout(this.stableTimer)
      this.stableTimer = null
    }
    this.clearIceRestartWatchdog()
    this.refreshEpoch += 1 // 在途刷新结果作废
    if (this.activeLink) {
      this.activeLink.destroy()
      this.activeLink = null
    }
    this.clearSpeaking()
    // 旧链路的下行视频流已随 PC 关闭失效；新链路 ontrack 会重新落位
    useStageStore.getState().clearRemoteVideos()
  }

  private clearRecovery() {
    if (this.recoverTimer) {
      clearTimeout(this.recoverTimer)
      this.recoverTimer = null
    }
    this.clearDrainingWait()
    this.recoveryAttempts = 0
    this.iceRestartAttempts = 0
    this.suspendedAction = null
  }

  private clearDrainingWait() {
    if (this.drainingTimer) {
      clearTimeout(this.drainingTimer)
      this.drainingTimer = null
    }
  }

  /** 连接诊断：RTT / 电平 / 上下行流量（语音面板状态浮窗） */
  async getDiagnostics() {
    if (!this.activeLink || this.activeLink.isDestroyed) {
      return {
        rttMs: null as number | null,
        inputLevel: 0,
        bitrateUpBps: 0,
        bitrateDownBps: 0,
        bytesSent: 0,
        bytesReceived: 0,
        streams: [] as import("./webrtc").VoiceStreamStat[],
        connectionState: null as string | null,
        iceState: null as string | null,
        nsUplinkModel: null as string | null,
        nsDownlinkCount: 0,
      }
    }
    return this.activeLink.getDiagnostics()
  }

  /** 运行中同步设置：输入增益 / 主输出音量 / 输出设备 / 重采麦克风 → 已接入的 SFU 链路 */
  applyVoiceSettings(patch: {
    inputVolume?: number
    outputVolume?: number
    outputDeviceId?: string | null
    reinitMic?: boolean
  }) {
    this.activeLink?.applyVoiceSettings(patch)
    this.pendingLink?.applyVoiceSettings(patch)
  }

  /** 完整退出语音态（用户离开 / 被踢 / 不可恢复错误）：双链路与全部定时器清理 */
  private cleanupToIdle() {
    this.abortPendingLink("cleanup")
    this.destroyActiveLink()
    this.clearRecovery()
    this.refreshFailCount = 0
    this.migration = null
    this.micWarned = false
    this.prevMuteBeforeDeaf = false
    this.watchedVideo = {}
    this.info = null
    useVoiceStore.getState().setSession(null)
  }
}

/** 全局单例（gateway-bindings 与 UI 共用） */
export const voiceConnection = new VoiceConnectionManager()
