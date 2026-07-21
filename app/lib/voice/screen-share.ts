// 屏幕共享发布端编排（docs 11 §5.3 客户端状态机）：
//
//   IDLE ──start()──► REQUESTING（POST screen/start 占坑 RESERVED）
//        ──► 刷新 token（ensureScreenCaps：refreshVoiceToken + auth 在位重发，
//             等 caps 含 publish_screen）
//        ──► CAPTURING（getDisplayMedia 按质量档约束采集）
//        ──► PUBLISHING（PC addTrack + createOffer 重协商）
//        ──► LIVE（SCREEN_SHARE_START 事件为业务权威，本地乐观置 live）
//
// 任何一步失败必须调 stopScreenShare 释放 RESERVED 占坑（docs 11 FR-05）。
// 采集 track onended（用户从系统 UI 停止）→ 自动 stop 收尾（FR-06）。
// 被动停止（SCREEN_SHARE_STOP / 抱下 / caps 回收 / 离开语音）→ handleRemoteStop。
//
// WKWebView 下 getDisplayMedia 可能不可用：isSupported() 为 false 时入口直接提示
// 「当前环境不支持屏幕采集」，其余代码路径照常保留。

import { toast } from "sonner"

import { startScreenShare, stopScreenShare } from "~/lib/api/stage"
import { ApiError } from "~/lib/api/http"
import type { ScreenQuality } from "~/lib/api/types"
import { useAuthStore } from "~/stores/auth"
import { useStageStore } from "~/stores/stage"
import { useVoiceStore } from "~/stores/voice"
import { voiceConnection } from "./connection"
import { verror, vlog, vwarn } from "./log"
import { screenErrorMessage, screenStopReasonMessage } from "./stage-errors"

/** 质量档 → getDisplayMedia 约束（docs 11 FR-03/BA.1；帧率 5–30） */
const QUALITY_CONSTRAINTS: Record<
  ScreenQuality,
  { width: number; height: number; frameRate: number }
> = {
  "480p": { width: 854, height: 480, frameRate: 15 },
  "720p": { width: 1280, height: 720, frameRate: 30 },
  "1080p": { width: 1920, height: 1080, frameRate: 30 },
}

export const SCREEN_QUALITIES: ScreenQuality[] = ["480p", "720p", "1080p"]

class ScreenShareManager {
  private track: MediaStreamTrack | null = null
  private stream: MediaStream | null = null
  /** 每次 start/stop 递增；异步步骤返回后校验，防止过期流程继续推进 */
  private epoch = 0
  private lastSessionId: string | null = null
  /** 防 caps 暂缺误杀：connected 后延迟复核 publish_screen */
  private capsWatchTimer: ReturnType<typeof setTimeout> | null = null
  private resumeInFlight = false

  constructor() {
    // 会话联动（docs 11 FR-11/FR-12/BB）：
    //   - 离开语音 / 切频道 → 共享随之终止；
    //   - LIVE 中 caps 被回收 publish_screen → 延迟确认后再停（重连瞬间 caps 常暂缺）；
    //   - 重连/迁移回到 connected 且本地轨仍活 → 自动 ensureCaps + 重发轨；
    //   - 回到 connected 且本地无采集 → 清理服务端孤儿 ScreenSlot。
    let prevPhase: string | null | undefined
    useVoiceStore.subscribe((state) => {
      const session = state.session
      const phase = session?.phase ?? null
      const selfScreen = useStageStore.getState().selfScreen

      // 回到 connected：优先续传；无本地轨再清孤儿坑
      if (
        phase === "connected" &&
        prevPhase !== "connected" &&
        session?.channelId
      ) {
        if (
          selfScreen?.phase === "live" &&
          this.hasLiveCapture() &&
          selfScreen.channelId === session.channelId
        ) {
          void this.resumePublish("reconnect")
        } else if (!this.hasLiveCapture()) {
          void this.releaseOrphanServerSlot(session.channelId)
        }
      }
      prevPhase = phase

      if (!selfScreen) {
        this.clearCapsWatch()
        this.lastSessionId = session?.sessionId ?? null
        return
      }
      if (!session || session.channelId !== selfScreen.channelId) {
        vlog("screen-share: 已离开语音频道，本地收口共享")
        this.teardown({ notifyServer: false })
        return
      }

      // 重连/协商途中 caps 常暂无 publish_screen，切勿立刻 teardown
      if (
        selfScreen.phase === "live" &&
        session.phase === "connected" &&
        session.caps.length > 0 &&
        !session.caps.includes("publish_screen")
      ) {
        this.scheduleCapsLossCheck(session.channelId)
      } else {
        this.clearCapsWatch()
      }

      // 热迁移 / sessionId 变化：新链路重发（与 reconnect 路径互补）
      if (
        selfScreen.phase === "live" &&
        session.phase === "connected" &&
        session.sessionId &&
        this.lastSessionId &&
        session.sessionId !== this.lastSessionId &&
        this.hasLiveCapture()
      ) {
        vlog("screen-share: sessionId 变化，重发屏幕轨")
        void this.resumePublish("session-switch")
      }
      this.lastSessionId = session.sessionId ?? this.lastSessionId
    })
  }

  private hasLiveCapture(): boolean {
    return Boolean(
      this.stream && this.track && this.track.readyState === "live",
    )
  }

  private clearCapsWatch() {
    if (this.capsWatchTimer) {
      clearTimeout(this.capsWatchTimer)
      this.capsWatchTimer = null
    }
  }

  /**
   * connected 后 caps 仍无 publish_screen 时延迟复核：
   * 重连瞬间 join token 可能尚未带上屏共享 cap，过早 teardown 会导致「断线不能续」。
   */
  private scheduleCapsLossCheck(channelId: string) {
    if (this.capsWatchTimer) return
    this.capsWatchTimer = setTimeout(() => {
      this.capsWatchTimer = null
      const selfScreen = useStageStore.getState().selfScreen
      const session = useVoiceStore.getState().session
      if (!selfScreen || selfScreen.phase !== "live") return
      if (!session || session.channelId !== channelId) return
      if (session.phase !== "connected") return
      if (session.caps.includes("publish_screen")) return
      // 再尝试一次 ensure + 续传
      void this.resumePublish("caps-missing").then((ok) => {
        if (ok) return
        vlog("screen-share: caps 确认已回收 publish_screen，停止发布")
        this.teardown({ notifyServer: false })
      })
    }, 2_500)
  }

  /**
   * 断线重连 / 热迁移后恢复发布（docs 11 §5.4 BB.4）。
   * 本地轨仍活则 ensureCaps（必要时重新占坑）+ publishScreenTrack。
   */
  private async resumePublish(
    reason: string,
  ): Promise<boolean> {
    if (this.resumeInFlight) return false
    if (!this.hasLiveCapture() || !this.track || !this.stream) return false
    const selfScreen = useStageStore.getState().selfScreen
    const session = useVoiceStore.getState().session
    if (!selfScreen || selfScreen.phase !== "live") return false
    if (
      !session ||
      session.phase !== "connected" ||
      session.channelId !== selfScreen.channelId
    ) {
      return false
    }

    this.resumeInFlight = true
    const epoch = this.epoch
    try {
      vlog("screen-share: 尝试恢复发布", reason)
      // 恢复本地预览（destroyActiveLink 会 clearRemoteVideos）
      this.publishLocalPreview(this.stream)

      let caps = session.caps
      if (!caps.includes("publish_screen")) {
        const refreshed = await voiceConnection.ensureScreenCaps()
        caps = refreshed ?? useVoiceStore.getState().session?.caps ?? []
      }
      // 槽位仍在但 token 未带 cap：重新占坑一次（幂等处理 ALREADY_ACTIVE）
      if (!caps.includes("publish_screen")) {
        try {
          await this.reserveScreenSlot(
            selfScreen.channelId,
            selfScreen.quality,
          )
          const again = await voiceConnection.ensureScreenCaps()
          caps = again ?? useVoiceStore.getState().session?.caps ?? []
        } catch (error) {
          vwarn("screen-share: 恢复时重新占坑失败", error)
        }
      }
      if (this.epoch !== epoch || !this.hasLiveCapture()) return false
      if (!caps.includes("publish_screen")) {
        vwarn("screen-share: 恢复失败，仍无 publish_screen")
        return false
      }

      const published = await voiceConnection.publishScreenTrack(
        this.track,
        this.stream,
      )
      if (this.epoch !== epoch) return false
      if (published) {
        this.lastSessionId =
          useVoiceStore.getState().session?.sessionId ?? this.lastSessionId
        vlog("screen-share: 恢复发布成功", reason)
        return true
      }
      vwarn("screen-share: 恢复发布失败", reason)
      return false
    } finally {
      this.resumeInFlight = false
    }
  }

  /** WKWebView 等环境 getDisplayMedia 支持度探测 */
  isSupported(): boolean {
    return (
      typeof navigator !== "undefined" &&
      typeof navigator.mediaDevices?.getDisplayMedia === "function"
    )
  }

  /**
   * 发起共享（严格按 docs 11 BC.1 时序）。调用方保证已连接语音。
   * 失败路径均已内部 toast + 释放占坑。
   */
  async start(channelId: string, quality: ScreenQuality): Promise<void> {
    const session = useVoiceStore.getState().session
    if (
      !session ||
      session.channelId !== channelId ||
      session.phase !== "connected"
    ) {
      toast.error("请先连接语音后再共享屏幕")
      return
    }
    const existing = useStageStore.getState().selfScreen
    if (existing && existing.phase !== "idle") return // 每用户 1 路（AX.4）
    if (!this.isSupported()) {
      toast.error("当前环境不支持屏幕采集")
      return
    }

    const epoch = ++this.epoch
    const setPhase = (
      phase: "requesting" | "capturing" | "publishing" | "live"
    ) => useStageStore.getState().setSelfScreen({ channelId, quality, phase })

    // 1. REST 占坑（RESERVED）
    // 刷新后服务端可能仍保留 ScreenSlot（断线宽限约 60s），本地已无采集；
    // 遇 SCREEN_ALREADY_ACTIVE 时先幂等 stop 再重试一次 start。
    setPhase("requesting")
    try {
      await this.reserveScreenSlot(channelId, quality)
    } catch (error) {
      verror("screen/start 失败", error)
      if (this.epoch === epoch) {
        const quota =
          useStageStore.getState().quotaByGuild[session.guildId] ?? null
        toast.error(screenErrorMessage(error, quota))
        useStageStore.getState().setSelfScreen(null)
      }
      return
    }
    if (this.epoch !== epoch) {
      void this.releaseReservation(channelId)
      return
    }

    // 2. 先刷一次 caps（占坑后服务端应重算）；采集可能较久，发布前会再刷
    let caps = await voiceConnection.ensureScreenCaps()
    if (this.epoch !== epoch) {
      void this.releaseReservation(channelId)
      return
    }
    if (!caps || !caps.includes("publish_screen")) {
      vwarn("screen-share: 刷新后 caps 不含 publish_screen", caps)
      toast.error("屏幕共享授权失败，请稍后再试")
      await this.releaseReservation(channelId)
      if (this.epoch === epoch) useStageStore.getState().setSelfScreen(null)
      return
    }

    // 3. 采集：用 max 约束而非 ideal，避免「共享整个屏幕」时分辨率/帧率 ideal 过严导致
    //    部分平台（尤其整屏）在后续 applyConstraints / 协商时报错。
    setPhase("capturing")
    let stream: MediaStream
    try {
      stream = await this.captureDisplay(quality)
    } catch (error) {
      vwarn("getDisplayMedia 失败/取消", error)
      if (this.epoch === epoch) {
        toast.error(
          "屏幕采集已取消或被系统拒绝，如需共享请在系统设置中授权「屏幕录制」",
        )
        useStageStore.getState().setSelfScreen(null)
      }
      await this.releaseReservation(channelId)
      return
    }
    const track = stream.getVideoTracks()[0] ?? null
    if (this.epoch !== epoch || !track) {
      stream.getTracks().forEach((item) => item.stop())
      await this.releaseReservation(channelId)
      if (this.epoch === epoch) useStageStore.getState().setSelfScreen(null)
      return
    }
    // 屏幕内容以文本/静态为主：允许编码器降帧保清晰度（docs 11 FR-23）
    try {
      track.contentHint = "detail"
    } catch {
      // 平台不支持时忽略
    }
    this.track = track
    this.stream = stream
    // 发布端本地预览：SFU 通常不会回环自己的屏幕轨，写入 remoteVideos 供 UI 立即显示
    this.publishLocalPreview(stream)
    // 用户从系统 UI（浏览器/系统级停止按钮）结束共享 → 自动收尾（FR-06）
    track.onended = () => {
      vlog("screen-share: 采集 track onended，自动停止")
      void this.stop()
    }

    // 4. 采集可能耗时较长：发布前再 ensure caps（防 RESERVED 后 token 过期/未带 cap）
    setPhase("publishing")
    caps = (await voiceConnection.ensureScreenCaps()) ?? caps
    if (this.epoch !== epoch) {
      this.stopCapture()
      void this.releaseReservation(channelId)
      return
    }
    if (!caps.includes("publish_screen")) {
      toast.error("屏幕共享授权已失效，请重新发起")
      this.stopCapture()
      await this.releaseReservation(channelId)
      if (this.epoch === epoch) useStageStore.getState().setSelfScreen(null)
      return
    }

    // 5. PC addTrack + createOffer 重协商（内部带 stable 等待与一次重试）
    const published = await voiceConnection.publishScreenTrack(track, stream)
    if (this.epoch !== epoch) return
    if (!published) {
      verror("screen-share: publishScreenTrack 返回 false")
      toast.error(
        "屏幕画面发布失败，请确认已连接语音后重试（整屏共享可再试一次）",
      )
      this.stopCapture()
      await this.releaseReservation(channelId)
      useStageStore.getState().setSelfScreen(null)
      return
    }

    // 6. 本地乐观置 LIVE；RESERVED→ACTIVE 与 SCREEN_SHARE_START 广播由服务端收口
    this.lastSessionId = useVoiceStore.getState().session?.sessionId ?? null
    setPhase("live")
    toast.success("屏幕共享已开始")
  }

  /**
   * 采集屏幕/窗口。优先带质量上限；失败则回退无约束 getDisplayMedia
   *（部分环境对整屏 + 严格 ideal 约束会直接失败）。
   */
  private async captureDisplay(quality: ScreenQuality): Promise<MediaStream> {
    const q = QUALITY_CONSTRAINTS[quality]
    try {
      return await navigator.mediaDevices.getDisplayMedia({
        video: {
          // 用 max 而非 ideal，减少「共享整个屏幕」被约束拒绝的概率
          width: { max: q.width },
          height: { max: q.height },
          frameRate: { max: q.frameRate },
        },
        audio: false,
      })
    } catch (firstError) {
      vwarn("getDisplayMedia 带约束失败，回退无约束采集", firstError)
      return await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      })
    }
  }

  /** 当前本端采集流（供观看 UI 在本人共享时做本地预览） */
  getLocalStream(): MediaStream | null {
    return this.stream
  }

  /** 本人主动停止（面板按钮 / track onended）：REST stop + 移除本地轨 */
  async stop(): Promise<void> {
    const selfScreen = useStageStore.getState().selfScreen
    if (!selfScreen || selfScreen.phase === "stopping") return
    this.epoch += 1
    useStageStore.getState().setSelfScreen({ ...selfScreen, phase: "stopping" })
    this.stopCapture()
    await voiceConnection.unpublishScreenTrack().catch(() => undefined)
    try {
      await stopScreenShare(selfScreen.channelId)
    } catch (error) {
      // 幂等接口；失败时服务端会按 track ended / 超时最终一致释放
      vwarn("screen/stop 上报失败（忽略）", error)
    }
    useStageStore.getState().setSelfScreen(null)
  }

  /**
   * 被动停止（SCREEN_SHARE_STOP 事件到达本人）：停采集清理 + 按 reason 提示。
   * reason=self 时本端 stop() 已清理完毕，此处自然 no-op。
   */
  handleRemoteStop(reason?: string): void {
    const selfScreen = useStageStore.getState().selfScreen
    if (!selfScreen) return
    vlog("screen-share: 收到远端 STOP", reason)
    this.teardown({ notifyServer: false })
    const message = screenStopReasonMessage(reason)
    if (message) toast.info(message)
  }

  /** 抱下等场景的本地立即收口（不重试恢复，docs 11 FR-10；不另发 toast） */
  stopSilently(): void {
    if (!useStageStore.getState().selfScreen) return
    this.teardown({ notifyServer: true })
  }

  // ---------------------------------------------------------------------------
  // 内部
  // ---------------------------------------------------------------------------

  private teardown(options: { notifyServer: boolean }) {
    const selfScreen = useStageStore.getState().selfScreen
    this.epoch += 1
    this.clearCapsWatch()
    this.stopCapture()
    void voiceConnection.unpublishScreenTrack().catch(() => undefined)
    useStageStore.getState().setSelfScreen(null)
    if (options.notifyServer && selfScreen) {
      void stopScreenShare(selfScreen.channelId).catch(() => undefined)
    }
  }

  private stopCapture() {
    // 先清预览再 stop track，避免 clear 时 stream 已置空对不上引用
    this.clearLocalPreview()
    if (this.track) {
      this.track.onended = null
      this.track.stop()
      this.track = null
    }
    this.stream?.getTracks().forEach((item) => item.stop())
    this.stream = null
  }

  private publishLocalPreview(stream: MediaStream) {
    const selfId = useAuthStore.getState().user?.id
    if (!selfId) return
    useStageStore.getState().setRemoteVideo(selfId, stream)
  }

  private clearLocalPreview() {
    const selfId = useAuthStore.getState().user?.id
    if (!selfId || !this.stream) return
    // 仅当 store 中仍是本端预览流时清除，避免误删远端回灌
    const current = useStageStore.getState().remoteVideos[selfId]
    if (current === this.stream) {
      useStageStore.getState().setRemoteVideo(selfId, null)
    }
  }

  /** 失败路径释放 RESERVED 占坑（docs 11 FR-05，幂等） */
  private async releaseReservation(channelId: string): Promise<void> {
    try {
      await stopScreenShare(channelId)
    } catch (error) {
      vwarn("释放屏幕共享占坑失败（等待服务端超时回收）", error)
    }
  }

  /**
   * 占坑：正常 POST screen/start。
   * 若返回 SCREEN_ALREADY_ACTIVE（刷新后服务端孤儿槽位），先 stop 再 start 一次。
   */
  private async reserveScreenSlot(
    channelId: string,
    quality: ScreenQuality,
  ): Promise<void> {
    try {
      await startScreenShare(channelId, quality)
      return
    } catch (error) {
      if (
        !(error instanceof ApiError) ||
        error.code !== "SCREEN_ALREADY_ACTIVE"
      ) {
        throw error
      }
      vlog(
        "screen-share: SCREEN_ALREADY_ACTIVE，先释放服务端残留占坑再重试 start",
      )
      await stopScreenShare(channelId).catch(() => undefined)
      await startScreenShare(channelId, quality)
    }
  }

  /**
   * 语音连通后：本地已无采集/状态机时，幂等调用 screen/stop 清掉服务端残留槽位。
   * 避免刷新后 UI 无共享态，但 start 报「你已有一路共享正在进行」。
   * 若本地仍在共享（stream/selfScreen），不碰服务端。
   */
  private async releaseOrphanServerSlot(channelId: string): Promise<void> {
    if (this.stream || this.track) return
    const selfScreen = useStageStore.getState().selfScreen
    if (selfScreen && selfScreen.phase !== "idle") return
    try {
      await stopScreenShare(channelId)
      // 同步清掉本地 shares 里的本人条目（GATEWAY STOP 可能因时序未到）
      const selfId = useAuthStore.getState().user?.id
      const guildId = useVoiceStore.getState().session?.guildId
      if (selfId && guildId) {
        useStageStore.getState().applyScreenStop({
          guild_id: guildId,
          channel_id: channelId,
          user_id: selfId,
          reason: "disconnect",
        })
      }
      vlog("screen-share: 已清理服务端残留占坑（channel=", channelId, ")")
    } catch (error) {
      // 无槽位时 stop 仍为 204；其它错误仅记日志，不挡进房
      vwarn("screen-share: 清理残留占坑失败", error)
    }
  }
}

/** 全局单例（voice-panel 与 gateway-bindings 共用） */
export const screenShare = new ScreenShareManager()
