// 本地降噪引擎（docs 20）：模型目录 + WASM/AudioWorklet 生命周期管理。
//
// 模型资产全部**内置**：vendor/ 下的 WASM、模型权重与 worklet 处理器经 Vite
// 打进应用包，运行时零下载（docs 20 §3.3 可本地运行）。
//   - RNNoise / Speex：vendor 上游 @sapphi-red/web-noise-suppressor（MIT）
//   - DeepFilterNet 3：vendor/dfn 上游 denoise-voice-clarity（MIT；DFN 本体 MIT/Apache-2.0），
//     含 ≈18MB WASM+权重；WASM/worklet 用 Vite `?url` 导入（与 RNNoise 同路径），
//     避免 vendor 内 `new URL(..., import.meta.url)` + `compileStreaming` 在
//     错误 MIME / Tauri asset 协议下静默失败。
//   - DTLN：@sapphi-red/dtln-web（MIT；模型 Apache-2.0 / MIT），TFLite WASM +
//     动态量化权重置于 public/dtln/（固定路径，避免 hash 打断 loadModel 前缀约定）。
//     原生采样率 16kHz；在宿主 48kHz 上下文上通过独立 16k AudioContext + MediaStream 桥接。
//
// 职责：
//   - 模型目录元数据（设置页展示，docs 20 §3.2）；
//   - WASM 二进制/模块按模型进程内缓存（一次加载）；
//   - AudioWorklet 模块按 (AudioContext, 模型) 幂等注册；
//   - createNsNodeWithFallback：构建降噪链节点，失败按回退链降级（FR-L02）；
//   - 强度（FR-S06）：统一实现为干/湿混合，NsHandle.setStrength(0–100)；
//   - P0 一律单声道处理（决议 R2）：湿路入口强制 channelCount=1 下混；
//   - DeepFilterNet 要求 48kHz 采样率——宿主 AudioContext 须以
//     { sampleRate: 48000 } 创建（RNNoise 同样按 48kHz 假设，一并受益）。
//
// 本模块不依赖任何 store，供 webrtc.ts / 设置页测试链复用。

import { toast } from "sonner"
// 仅导入资产 URL：vendor/wns 含 `extends AudioWorkletNode`，必须浏览器动态 import，
// 否则 Vite SSRCompatModuleRunner 在 Node 求值会直接崩溃。
import rnnoiseWasmUrl from "./vendor/rnnoise.wasm?url"
import rnnoiseSimdWasmUrl from "./vendor/rnnoise_simd.wasm?url"
import speexWasmUrl from "./vendor/speex.wasm?url"
import rnnoiseWorkletUrl from "./vendor/rnnoise-worklet.js?url"
import speexWorkletUrl from "./vendor/speex-worklet.js?url"
// DFN 资产与 RNNoise 一样走 Vite `?url`，保证打包产物 URL 稳定可 fetch
import dfnWasmUrl from "./vendor/dfn/wasm/denoise_voice_core_bg.wasm?url"
import dfnWorkletUrl from "./vendor/dfn/voiceClarity.worklet.js?url"

// ---------------------------------------------------------------------------
// 模型目录（docs 20 §3.1）
// ---------------------------------------------------------------------------

export type NoiseModelId =
  | "browser"
  | "rnnoise"
  | "speex"
  | "deepfilternet"
  | "dtln"

/** 实际由 WASM / ScriptProcessor 承载的模型（browser 走 getUserMedia 约束） */
export type WasmNsModelId = "rnnoise" | "speex" | "deepfilternet" | "dtln"

export type NoiseModelMeta = {
  id: NoiseModelId
  label: string
  description: string
  /** 作用范围标签（docs 20 §3.2） */
  scope: "仅自己" | "自己+他人"
  /** 相对算力 */
  cpu: "低" | "中" | "高"
  /** 开源项目 + 许可证短名 */
  license: string
  /** 当前平台是否已实装（未实装项在 UI 标注「即将推出」，FR-S02） */
  implemented: boolean
}

export const NOISE_MODELS: NoiseModelMeta[] = [
  {
    id: "browser",
    label: "浏览器内置",
    description: "WebRTC 引擎自带降噪，延迟与占用最低",
    scope: "仅自己",
    cpu: "低",
    license: "随 WebView 引擎",
    implemented: true,
  },
  {
    id: "rnnoise",
    label: "RNNoise",
    description: "RNN 神经网络降噪，效果与开销均衡",
    scope: "自己+他人",
    cpu: "中",
    license: "RNNoise · BSD",
    implemented: true,
  },
  {
    id: "speex",
    label: "Speex 轻量",
    description: "SpeexDSP 谱减降噪，低配设备首选",
    scope: "自己+他人",
    cpu: "低",
    license: "SpeexDSP · BSD",
    implemented: true,
  },
  {
    id: "dtln",
    label: "DTLN",
    description:
      "双信号变换 LSTM 网络（DTLN），实时语音降噪；动态量化模型约 1MB + TFLite WASM",
    scope: "自己+他人",
    cpu: "中",
    license: "DTLN · Apache-2.0/MIT",
    implemented: true,
  },
  {
    id: "deepfilternet",
    label: "DeepFilterNet 3",
    description: "深度滤波网络，降噪质量最高；内置模型约 18MB，CPU/内存占用较高",
    scope: "自己+他人",
    cpu: "高",
    license: "DeepFilterNet · MIT/Apache-2.0",
    implemented: true,
  },
]

/** DFN 平台能力：只需 AudioWorklet + WebAssembly（不再强依赖 compileStreaming） */
export function isDeepFilterNetSupported(): boolean {
  return (
    typeof AudioWorkletNode !== "undefined" &&
    typeof WebAssembly !== "undefined" &&
    typeof WebAssembly.compile === "function"
  )
}

/** DTLN 平台能力：仅浏览器 + WebAssembly + AudioContext（ScriptProcessor 由运行时创建） */
export function isDtlnSupported(): boolean {
  // Node / Vite 预构建环境禁止碰 DTLN（tfjs 会误走 PlatformNode）
  if (typeof window === "undefined" || typeof document === "undefined") {
    return false
  }
  if (typeof WebAssembly === "undefined") return false
  const Ctor =
    typeof AudioContext !== "undefined"
      ? AudioContext
      : (
          window as unknown as {
            webkitAudioContext?: typeof AudioContext
          }
        ).webkitAudioContext
  return typeof Ctor === "function"
}

export function isNsModelImplemented(id: NoiseModelId): boolean {
  const meta = NOISE_MODELS.find((m) => m.id === id)
  if (!meta?.implemented) return false
  if (id === "deepfilternet") return isDeepFilterNetSupported()
  if (id === "dtln") return isDtlnSupported()
  return true
}

/**
 * 上行有效 WASM 模型：browser → null（走 getUserMedia 约束）。
 * 用户显式选择的 deepfilternet / dtln 原样返回，由 createNsNodeWithFallback 负责加载与回退
 * （避免在此静默改写导致控制台「零日志」）。
 */
export function uplinkWasmModel(id: NoiseModelId): WasmNsModelId | null {
  if (id === "browser") return null
  if (id === "deepfilternet" && !isDeepFilterNetSupported()) {
    console.warn(
      "[noise-suppression] 当前环境不支持 DeepFilterNet（缺 AudioWorklet/WebAssembly），将回退 RNNoise",
    )
    return "rnnoise"
  }
  if (id === "dtln" && !isDtlnSupported()) {
    console.warn(
      "[noise-suppression] 当前环境不支持 DTLN（缺 ScriptProcessor/WebAssembly），将回退 RNNoise",
    )
    return "rnnoise"
  }
  return id
}

/**
 * 下行每用户降噪模型：browser 仅支持上行，自动回退 RNNoise（FR-R04）。
 */
export function downlinkWasmModel(id: NoiseModelId): WasmNsModelId {
  return uplinkWasmModel(id) ?? "rnnoise"
}

/** 选中仅上行模型时对他人降噪的实际回退模型名（UI 提示文案用） */
export function downlinkFallbackLabel(id: NoiseModelId): string | null {
  if (uplinkWasmModel(id) !== null) return null
  return NOISE_MODELS.find((m) => m.id === downlinkWasmModel(id))?.label ?? null
}

/**
 * 下行同时降噪软上限（决议 R6）：DeepFilterNet 4 路、DTLN 6 路、轻量模型 8 路；
 * 用户可在设置中覆盖（FR-R09 P1）。仅 toast 提示，不硬拦截。
 */
export function downlinkNsSoftLimit(model: WasmNsModelId): number {
  if (model === "deepfilternet") return 4
  if (model === "dtln") return 6
  return 8
}

function modelLabel(id: WasmNsModelId | NoiseModelId): string {
  return NOISE_MODELS.find((m) => m.id === id)?.label ?? id
}

// ---------------------------------------------------------------------------
// WASM / Worklet 生命周期
// ---------------------------------------------------------------------------

/** DeepFilterNet 调参（衰减上限 + 人声清晰度） */
export type DfnTuningParams = {
  /** 噪声衰减上限 dB（0–100，越高去噪越狠） */
  attenuationLimitDb: number
  /** 人声清晰度提升 dB（-12–12） */
  presenceGainDb: number
}

/**
 * DTLN 调参（模型本身无运行时旋钮，经湿路后处理实现）：
 * - presenceGainDb：约 2.8kHz 峰值 EQ，提升听感清晰度
 * - makeupGainDb：湿路电平补偿（强降噪后音量常略掉）
 */
export type DtlnTuningParams = {
  presenceGainDb: number
  makeupGainDb: number
}

/**
 * 降噪链句柄：input → [湿路：下混 → 模型节点 → wetGain] + [干路：dryGain] → output。
 * 强度（FR-S06）= 湿/干混合比：100 全湿（完全降噪输出）、0 全干（原声直通）。
 */
export type NsHandle = {
  input: AudioNode
  output: AudioNode
  model: WasmNsModelId
  /** 0–100；每模型记忆的强度由调用方从设置读出后传入/更新 */
  setStrength: (percent: number) => void
  /** DeepFilterNet 专用：热更衰减/清晰度（非 DFN 节点为 undefined） */
  setDfnTuning?: (params: Partial<DfnTuningParams>) => void
  /** DTLN 专用：热更清晰度/输出补偿（非 DTLN 节点为 undefined） */
  setDtlnTuning?: (params: Partial<DtlnTuningParams>) => void
  destroy: () => void
}

/** 夹紧 DFN 参数到引擎合法范围 */
export function clampDfnTuning(params: DfnTuningParams): DfnTuningParams {
  return {
    attenuationLimitDb: Math.min(
      100,
      Math.max(0, Math.round(params.attenuationLimitDb)),
    ),
    presenceGainDb: Math.min(
      12,
      Math.max(-12, Math.round(params.presenceGainDb * 10) / 10),
    ),
  }
}

// ---------------------------------------------------------------------------
// DeepFilterNet 预设（默认：屏蔽环境噪音与键鼠）
// ---------------------------------------------------------------------------

export type DfnPresetId =
  | "env-keyboard"
  | "balanced"
  | "natural"
  | "max"
  | "custom"

export type DfnPresetMeta = {
  id: DfnPresetId
  label: string
  description: string
  /** custom 无固定数值 */
  attenuationLimitDb?: number
  presenceGainDb?: number
  /** 建议干湿强度；选预设时一并写入 nsStrengthByModel.deepfilternet */
  strength?: number
}

export const DFN_PRESETS: DfnPresetMeta[] = [
  {
    id: "env-keyboard",
    label: "屏蔽环境噪音与键鼠",
    description: "默认推荐：强力压键盘/鼠标/风扇等稳态与敲击噪声，保留人声",
    attenuationLimitDb: 48,
    presenceGainDb: 2,
    strength: 100,
  },
  {
    id: "balanced",
    label: "均衡",
    description: "日常通话：去噪与自然度折中",
    attenuationLimitDb: 32,
    presenceGainDb: 3,
    strength: 92,
  },
  {
    id: "natural",
    label: "自然人声",
    description: "轻度去噪，尽量保留音色与环境感",
    attenuationLimitDb: 18,
    presenceGainDb: 4,
    strength: 78,
  },
  {
    id: "max",
    label: "最强降噪",
    description: "极吵环境：最大衰减；可能略伤齿音与自然度",
    attenuationLimitDb: 60,
    presenceGainDb: 0,
    strength: 100,
  },
  {
    id: "custom",
    label: "自定义",
    description: "自行调节衰减上限、清晰度与干湿强度",
  },
]

export const DEFAULT_DFN_PRESET_ID: DfnPresetId = "env-keyboard"

export function resolveDfnPreset(id: DfnPresetId): DfnPresetMeta {
  return DFN_PRESETS.find((p) => p.id === id) ?? DFN_PRESETS[0]!
}

export function defaultDfnTuningFromPreset(
  id: DfnPresetId = DEFAULT_DFN_PRESET_ID,
): DfnTuningParams {
  const p = resolveDfnPreset(id)
  return clampDfnTuning({
    attenuationLimitDb: p.attenuationLimitDb ?? 48,
    presenceGainDb: p.presenceGainDb ?? 2,
  })
}

// ---------------------------------------------------------------------------
// DTLN 预设（默认：屏蔽环境噪音与键鼠）
// ---------------------------------------------------------------------------

export type DtlnPresetId =
  | "env-keyboard"
  | "balanced"
  | "natural"
  | "max"
  | "custom"

export type DtlnPresetMeta = {
  id: DtlnPresetId
  label: string
  description: string
  presenceGainDb?: number
  makeupGainDb?: number
  /** 建议干湿强度；选预设时一并写入 nsStrengthByModel.dtln */
  strength?: number
}

export const DTLN_PRESETS: DtlnPresetMeta[] = [
  {
    id: "env-keyboard",
    label: "屏蔽环境噪音与键鼠",
    description: "默认推荐：全湿降噪压键盘/风扇；轻度清晰度提升",
    presenceGainDb: 2,
    makeupGainDb: 0.5,
    strength: 100,
  },
  {
    id: "balanced",
    label: "均衡",
    description: "日常通话：去噪与自然度折中",
    presenceGainDb: 3,
    makeupGainDb: 0.5,
    strength: 90,
  },
  {
    id: "natural",
    label: "自然人声",
    description: "轻度去噪，尽量保留音色与环境感",
    presenceGainDb: 4,
    makeupGainDb: 1,
    strength: 72,
  },
  {
    id: "max",
    label: "最强降噪",
    description: "极吵环境：最大干湿比；清晰度归零以免发干",
    presenceGainDb: 0,
    makeupGainDb: 1,
    strength: 100,
  },
  {
    id: "custom",
    label: "自定义",
    description: "自行调节清晰度、输出补偿与干湿强度",
  },
]

export const DEFAULT_DTLN_PRESET_ID: DtlnPresetId = "env-keyboard"

export function resolveDtlnPreset(id: DtlnPresetId): DtlnPresetMeta {
  return DTLN_PRESETS.find((p) => p.id === id) ?? DTLN_PRESETS[0]!
}

/** 夹紧 DTLN 后处理参数到安全范围 */
export function clampDtlnTuning(params: DtlnTuningParams): DtlnTuningParams {
  return {
    presenceGainDb: Math.min(
      12,
      Math.max(-12, Math.round(params.presenceGainDb * 10) / 10),
    ),
    makeupGainDb: Math.min(
      6,
      Math.max(-6, Math.round(params.makeupGainDb * 10) / 10),
    ),
  }
}

export function defaultDtlnTuningFromPreset(
  id: DtlnPresetId = DEFAULT_DTLN_PRESET_ID,
): DtlnTuningParams {
  const p = resolveDtlnPreset(id)
  return clampDtlnTuning({
    presenceGainDb: p.presenceGainDb ?? 2,
    makeupGainDb: p.makeupGainDb ?? 0.5,
  })
}

// ---------------------------------------------------------------------------
// RNNoise / Speex vendor（浏览器动态加载）
// ---------------------------------------------------------------------------

type WnsModule = typeof import("./vendor/wns")

let wnsModulePromise: Promise<WnsModule> | null = null

async function importWnsModule(): Promise<WnsModule> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("RNNoise/Speex 仅在浏览器环境可用（不可在 Node/SSR 加载）")
  }
  if (!wnsModulePromise) {
    console.info("[noise-suppression] 动态加载 vendor/wns …")
    wnsModulePromise = import("./vendor/wns").catch((error) => {
      wnsModulePromise = null
      throw error
    })
  }
  return wnsModulePromise
}

/** 轻量模型 WASM 二进制进程内缓存（内置资产，仅解码一次） */
const wasmCache = new Map<"rnnoise" | "speex", Promise<ArrayBuffer>>()

async function loadWasm(model: "rnnoise" | "speex"): Promise<ArrayBuffer> {
  let cached = wasmCache.get(model)
  if (!cached) {
    cached = (async () => {
      const { loadRnnoise, loadSpeex } = await importWnsModule()
      return model === "rnnoise"
        ? loadRnnoise({ url: rnnoiseWasmUrl, simdUrl: rnnoiseSimdWasmUrl })
        : loadSpeex({ url: speexWasmUrl })
    })()
    cached.catch(() => wasmCache.delete(model))
    wasmCache.set(model, cached)
  }
  return cached
}

/**
 * 编译 WASM 模块：优先 compileStreaming；MIME 不对 / 协议不支持时回退
 * fetch → arrayBuffer → WebAssembly.compile（与 RNNoise 同等稳健）。
 */
async function compileWasmFromUrl(
  url: string,
  tag: string,
): Promise<WebAssembly.Module> {
  console.info(`[noise-suppression] ${tag} 开始加载 WASM`, url)

  if (typeof WebAssembly.compileStreaming === "function") {
    try {
      const res = await fetch(url)
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`)
      }
      const mod = await WebAssembly.compileStreaming(res)
      console.info(`[noise-suppression] ${tag} compileStreaming 成功`)
      return mod
    } catch (error) {
      console.warn(
        `[noise-suppression] ${tag} compileStreaming 失败，回退 arrayBuffer+compile`,
        error,
      )
    }
  }

  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(
      `${tag} WASM 下载失败: HTTP ${res.status} ${res.statusText} (${url})`,
    )
  }
  const buf = await res.arrayBuffer()
  if (buf.byteLength < 1000) {
    throw new Error(
      `${tag} WASM 体积异常（${buf.byteLength} bytes），URL 可能错误: ${url}`,
    )
  }
  console.info(
    `[noise-suppression] ${tag} WASM 已下载 ${buf.byteLength} bytes，开始 compile`,
  )
  const mod = await WebAssembly.compile(buf)
  console.info(`[noise-suppression] ${tag} compile 成功`)
  return mod
}

/** DFN WASM Module 进程内缓存 */
let dfnModulePromise: Promise<WebAssembly.Module> | null = null

function loadDfnModule(): Promise<WebAssembly.Module> {
  if (!dfnModulePromise) {
    dfnModulePromise = compileWasmFromUrl(dfnWasmUrl, "DeepFilterNet")
    dfnModulePromise.catch((error) => {
      console.error("[noise-suppression] DeepFilterNet WASM 缓存失效", error)
      dfnModulePromise = null
    })
  }
  return dfnModulePromise
}

/** 每个 AudioContext 已注册的 worklet（幂等 addModule） */
const registeredWorklets = new WeakMap<
  AudioContext,
  Map<WasmNsModelId, Promise<void>>
>()

function ensureWorklet(
  ctx: AudioContext,
  model: WasmNsModelId,
): Promise<void> {
  let byModel = registeredWorklets.get(ctx)
  if (!byModel) {
    byModel = new Map()
    registeredWorklets.set(ctx, byModel)
  }
  let pending = byModel.get(model)
  if (!pending) {
    if (model === "dtln") {
      // DTLN 使用 ScriptProcessor，无需 AudioWorklet
      return Promise.resolve()
    }
    const url =
      model === "rnnoise"
        ? rnnoiseWorkletUrl
        : model === "speex"
          ? speexWorkletUrl
          : dfnWorkletUrl
    console.info(`[noise-suppression] 注册 worklet model=${model}`, url)
    pending = ctx.audioWorklet.addModule(url).then(() => {
      console.info(`[noise-suppression] worklet 注册完成 model=${model}`)
    })
    pending.catch((error) => {
      console.error(
        `[noise-suppression] worklet 注册失败 model=${model}`,
        error,
      )
      byModel?.delete(model)
    })
    byModel.set(model, pending)
  }
  return pending
}

// ---------------------------------------------------------------------------
// DTLN（16kHz TFLite；跨采样率桥接）
// ---------------------------------------------------------------------------
//
// 重要：@sapphi-red/dtln-web 内嵌 tfjs，禁止顶层静态 import（SSR/Node 会误走
// PlatformNode）。浏览器内动态 import；vite.config 已 alias 到 dist/index.mjs，
// 避免 CJS main 的 default 互操作错误（star export entries）。

type DtlnModule = {
  setup: (tfliteWasmPath: string) => Promise<void>
  loadModel: (opts: {
    path: string
    quant?: "dynamic" | "f16"
  }) => Promise<void>
  createDtlnProcessorNode: (
    ctx: BaseAudioContext,
    opts: { channelCount: number },
  ) => ScriptProcessorNode
  sampleRate: number
}

let dtlnModulePromise: Promise<DtlnModule> | null = null

function normalizeDtlnModule(mod: Record<string, unknown>): DtlnModule {
  // 兼容：具名导出 / default 包一层 / default 再嵌套
  const candidates: Record<string, unknown>[] = [mod]
  if (mod.default && typeof mod.default === "object") {
    candidates.push(mod.default as Record<string, unknown>)
    const nested = (mod.default as { default?: unknown }).default
    if (nested && typeof nested === "object") {
      candidates.push(nested as Record<string, unknown>)
    }
  }
  for (const c of candidates) {
    if (
      typeof c.setup === "function" &&
      typeof c.loadModel === "function" &&
      typeof c.createDtlnProcessorNode === "function"
    ) {
      return c as unknown as DtlnModule
    }
  }
  throw new Error(
    `DTLN 模块导出异常（无 setup/loadModel/createDtlnProcessorNode）: ${Object.keys(mod).join(",")}`,
  )
}

async function importDtlnModule(): Promise<DtlnModule> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("DTLN 仅在浏览器环境可用（不可在 Node/SSR 加载）")
  }
  if (!dtlnModulePromise) {
    console.info("[noise-suppression] 动态加载 @sapphi-red/dtln-web (ESM) …")
    dtlnModulePromise = (async () => {
      // vite.config alias 将包名指向 dist/index.mjs，避免 CJS main 的 default 互操作错误
      const mod = await import("@sapphi-red/dtln-web")
      return normalizeDtlnModule(mod as Record<string, unknown>)
    })().catch((error) => {
      dtlnModulePromise = null
      throw error
    })
  }
  return dtlnModulePromise
}

/** public/dtln/ 下固定路径（与 setup/loadModel 前缀约定一致） */
function dtlnPublicBase(): string {
  const base = import.meta.env.BASE_URL || "/"
  const root = base.endsWith("/") ? base : `${base}/`
  return `${root}dtln/`
}

/** 启动前探测关键资产，缺文件时给出明确错误（避免 tfjs 抛出难读异常） */
async function assertDtlnAssets(base: string): Promise<void> {
  const required = [
    "tflite_web_api_cc.js",
    "tflite_web_api_cc.wasm",
    "tflite_web_api_cc_simd.js",
    "tflite_web_api_cc_simd.wasm",
    "model_quant_dynamic_1.tflite",
    "model_quant_dynamic_2.tflite",
  ]
  const results = await Promise.all(
    required.map(async (name) => {
      const url = `${base}${name}`
      try {
        const res = await fetch(url, { method: "HEAD" })
        // 部分静态服对 HEAD 不友好，再试 GET 范围探测
        if (res.ok) return { name, url, ok: true as const }
        const get = await fetch(url, {
          method: "GET",
          headers: { Range: "bytes=0-0" },
        })
        return { name, url, ok: get.ok || get.status === 206 }
      } catch {
        return { name, url, ok: false as const }
      }
    }),
  )
  const missing = results.filter((r) => !r.ok)
  if (missing.length > 0) {
    const list = missing.map((m) => m.url).join(", ")
    throw new Error(
      `DTLN 静态资源缺失（请运行 bun run copy-dtln）: ${list}`,
    )
  }
  console.info("[noise-suppression] DTLN 资产检查通过", base)
}

let dtlnLoadPromise: Promise<void> | null = null

async function ensureDtlnLoaded(): Promise<DtlnModule> {
  const mod = await importDtlnModule()
  if (!dtlnLoadPromise) {
    dtlnLoadPromise = (async () => {
      const path = dtlnPublicBase()
      console.info("[noise-suppression] DTLN setup", path)
      await assertDtlnAssets(path)
      try {
        await mod.setup(path)
      } catch (error) {
        console.error("[noise-suppression] DTLN setup() 失败", error)
        throw error instanceof Error
          ? error
          : new Error(`DTLN setup 失败: ${String(error)}`)
      }
      // 动态量化：体积更小（≈1MB），实时性更好
      try {
        await mod.loadModel({ path, quant: "dynamic" })
      } catch (error) {
        console.error("[noise-suppression] DTLN loadModel() 失败", error)
        throw error instanceof Error
          ? error
          : new Error(`DTLN loadModel 失败: ${String(error)}`)
      }
      console.info("[noise-suppression] DTLN 模型加载完成")
    })().catch((error) => {
      dtlnLoadPromise = null
      throw error
    })
  }
  await dtlnLoadPromise
  return mod
}

/**
 * 在任意采样率宿主上下文上挂 DTLN：
 * 宿主 ⇄ MediaStream ⇄ 16kHz 独立 AudioContext + ScriptProcessor。
 * 湿路：from16 → presence EQ → makeup → wetGain → output（+ 干路混合）。
 */
async function createDtlnHandle(
  parentCtx: AudioContext,
  strengthPercent: number,
  initialTuning?: DtlnTuningParams | null,
): Promise<NsHandle> {
  const { createDtlnProcessorNode } = await ensureDtlnLoaded()

  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext
  if (!Ctor) throw new Error("DTLN 需要 AudioContext")

  const ctx16 = new Ctor({ sampleRate: 16_000 })
  if (Math.round(ctx16.sampleRate) !== 16_000) {
    void ctx16.close().catch(() => undefined)
    throw new Error(
      `DTLN 需要 16kHz AudioContext（实际 ${ctx16.sampleRate}）`,
    )
  }
  await ctx16.resume().catch(() => undefined)

  const dtln = createDtlnProcessorNode(ctx16, { channelCount: 1 })

  // 宿主 → 16k
  const to16 = parentCtx.createMediaStreamDestination()
  to16.channelCount = 1
  const fromParent = ctx16.createMediaStreamSource(to16.stream)
  fromParent.connect(dtln)

  // 16k → 宿主
  const toParent = ctx16.createMediaStreamDestination()
  toParent.channelCount = 1
  dtln.connect(toParent)
  const from16 = parentCtx.createMediaStreamSource(toParent.stream)

  const input = parentCtx.createGain()
  const output = parentCtx.createGain()
  const wet = parentCtx.createGain()
  const dry = parentCtx.createGain()

  // 湿路后处理：人声清晰度（峰值 EQ）+ 输出补偿
  const presence = parentCtx.createBiquadFilter()
  presence.type = "peaking"
  presence.frequency.value = 2_800
  presence.Q.value = 0.75
  const makeup = parentCtx.createGain()

  let tuning = clampDtlnTuning(
    initialTuning ?? defaultDtlnTuningFromPreset(),
  )
  const applyTuning = (next: DtlnTuningParams) => {
    tuning = clampDtlnTuning(next)
    presence.gain.value = tuning.presenceGainDb
    makeup.gain.value = Math.pow(10, tuning.makeupGainDb / 20)
  }
  applyTuning(tuning)

  input.connect(to16)
  from16.connect(presence)
  presence.connect(makeup)
  makeup.connect(wet)
  wet.connect(output)
  input.connect(dry)
  dry.connect(output)

  const apply = (percent: number) => {
    const s = Math.min(100, Math.max(0, percent)) / 100
    wet.gain.value = s
    dry.gain.value = 1 - s
  }
  apply(strengthPercent)

  let destroyed = false
  console.info(
    `[noise-suppression] DTLN 桥接就绪 parentRate=${parentCtx.sampleRate}`,
    tuning,
  )

  return {
    input,
    output,
    model: "dtln",
    setStrength: apply,
    setDtlnTuning: (params) => {
      applyTuning({
        presenceGainDb: params.presenceGainDb ?? tuning.presenceGainDb,
        makeupGainDb: params.makeupGainDb ?? tuning.makeupGainDb,
      })
    },
    destroy: () => {
      if (destroyed) return
      destroyed = true
      for (const node of [
        input,
        output,
        wet,
        dry,
        presence,
        makeup,
        from16,
        fromParent,
        dtln,
        to16,
        toParent,
      ]) {
        try {
          node.disconnect()
        } catch {
          // ignore
        }
      }
      void ctx16.close().catch(() => undefined)
    },
  }
}

/** 创建核心节点时可选的 DFN 初始调参 */
let dfnTuningOverride: DfnTuningParams | null = null
/** 创建 DTLN 节点时可选的初始调参 */
let dtlnTuningOverride: DtlnTuningParams | null = null

/** 构造模型核心节点（未接线）；destroyCore 负责模型自身资源释放 */
async function createCoreNode(
  ctx: AudioContext,
  model: WasmNsModelId,
): Promise<{ node: AudioWorkletNode; destroyCore: () => void }> {
  console.info(
    `[noise-suppression] createCoreNode model=${model} sampleRate=${ctx.sampleRate}`,
  )

  if (model === "dtln") {
    // DTLN 走独立 16k 桥接，不经 AudioWorklet 核心路径
    throw new Error("DTLN 请使用 createDtlnHandle")
  }

  if (model === "deepfilternet") {
    // DFN 模型以 48kHz / 480 样本帧（10ms）训练；采样率不符会失真，直接拒绝并走回退链
    if (Math.round(ctx.sampleRate) !== 48_000) {
      throw new Error(
        `DeepFilterNet 需要 48kHz AudioContext（当前 ${ctx.sampleRate}）`,
      )
    }
    if (!isDeepFilterNetSupported()) {
      throw new Error(
        "DeepFilterNet 需要 AudioWorkletNode 与 WebAssembly.compile",
      )
    }
    const [wasmModule] = await Promise.all([
      loadDfnModule(),
      ensureWorklet(ctx, "deepfilternet"),
    ])
    // 调参由调用方传入；缺省用「屏蔽环境噪音与键鼠」预设
    const tuning = clampDfnTuning(
      dfnTuningOverride ?? defaultDfnTuningFromPreset(),
    )
    const node = new AudioWorkletNode(ctx, "voice-clarity-processor", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
      channelCountMode: "explicit",
      processorOptions: {
        wasmModule,
        enabled: true,
        attenuationLimitDb: tuning.attenuationLimitDb,
        presenceGainDb: tuning.presenceGainDb,
      },
    })
    console.info("[noise-suppression] DeepFilterNet AudioWorkletNode 已创建", tuning)
    return {
      node,
      destroyCore: () => {
        try {
          node.port.postMessage({ type: "destroy" })
        } catch {
          // ignore
        }
      },
    }
  }

  const [wns, wasmBinary] = await Promise.all([
    importWnsModule(),
    loadWasm(model),
    ensureWorklet(ctx, model),
  ])
  const node =
    model === "rnnoise"
      ? new wns.RnnoiseWorkletNode(ctx, { maxChannels: 1, wasmBinary })
      : new wns.SpeexWorkletNode(ctx, { maxChannels: 1, wasmBinary })
  // 决议 R2（P0）：立体声输入强制下混单声道后进模型
  node.channelCount = 1
  node.channelCountMode = "explicit"
  return {
    node,
    destroyCore: () => {
      try {
        ;(node as { destroy?: () => void }).destroy?.()
      } catch {
        // ignore
      }
    },
  }
}

/** 把核心节点包装成带干/湿强度混合的 NsHandle */
function wrapHandle(
  ctx: AudioContext,
  model: WasmNsModelId,
  core: { node: AudioWorkletNode; destroyCore: () => void },
  strengthPercent: number,
): NsHandle {
  const input = ctx.createGain()
  const output = ctx.createGain()
  const wet = ctx.createGain()
  const dry = ctx.createGain()
  input.connect(core.node)
  core.node.connect(wet)
  wet.connect(output)
  input.connect(dry)
  dry.connect(output)
  const apply = (percent: number) => {
    const s = Math.min(100, Math.max(0, percent)) / 100
    wet.gain.value = s
    dry.gain.value = 1 - s
  }
  apply(strengthPercent)
  let destroyed = false

  const setDfnTuning =
    model === "deepfilternet"
      ? (params: Partial<DfnTuningParams>) => {
          if (typeof params.attenuationLimitDb === "number") {
            const db = clampDfnTuning({
              attenuationLimitDb: params.attenuationLimitDb,
              presenceGainDb: 0,
            }).attenuationLimitDb
            try {
              core.node.port.postMessage({
                type: "set-attenuation-limit",
                value: db,
              })
            } catch {
              // ignore
            }
          }
          if (typeof params.presenceGainDb === "number") {
            const db = clampDfnTuning({
              attenuationLimitDb: 30,
              presenceGainDb: params.presenceGainDb,
            }).presenceGainDb
            try {
              core.node.port.postMessage({
                type: "set-presence-gain",
                value: db,
              })
            } catch {
              // ignore
            }
          }
        }
      : undefined

  return {
    input,
    output,
    model,
    setStrength: apply,
    setDfnTuning,
    destroy: () => {
      if (destroyed) return
      destroyed = true
      for (const node of [input, output, wet, dry, core.node]) {
        try {
          node.disconnect()
        } catch {
          // ignore
        }
      }
      core.destroyCore()
    },
  }
}

/** 各模型的失败回退链（FR-L02）：全部失败返回 null（直通不降噪，语音不受影响） */
const FALLBACK_CHAINS: Record<WasmNsModelId, WasmNsModelId[]> = {
  deepfilternet: ["deepfilternet", "dtln", "rnnoise", "speex"],
  dtln: ["dtln", "rnnoise", "speex"],
  rnnoise: ["rnnoise", "speex"],
  speex: ["speex", "rnnoise"],
}

/** 回退 toast 去重（下行多路会连续建节点） */
let lastFallbackToastKey = ""
let lastFallbackToastAt = 0

function notifyFallback(wanted: WasmNsModelId, actual: WasmNsModelId) {
  const key = `${wanted}->${actual}`
  const now = Date.now()
  if (key === lastFallbackToastKey && now - lastFallbackToastAt < 8_000) return
  lastFallbackToastKey = key
  lastFallbackToastAt = now
  toast.warning(
    `${modelLabel(wanted)} 加载失败，已回退到 ${modelLabel(actual)}`,
  )
}

function notifyAllFailed(wanted: WasmNsModelId) {
  const key = `${wanted}->null`
  const now = Date.now()
  if (key === lastFallbackToastKey && now - lastFallbackToastAt < 8_000) return
  lastFallbackToastKey = key
  lastFallbackToastAt = now
  toast.error("降噪模型全部加载失败，已直通不降噪")
}

export async function createNsNodeWithFallback(
  ctx: AudioContext,
  wanted: WasmNsModelId,
  strengthPercent = 100,
  dfnTuning?: DfnTuningParams | null,
  dtlnTuning?: DtlnTuningParams | null,
): Promise<NsHandle | null> {
  console.info(
    `[noise-suppression] 请求模型=${wanted} sampleRate=${ctx.sampleRate} strength=${strengthPercent}`,
    { dfn: dfnTuning ?? null, dtln: dtlnTuning ?? null },
  )
  // 线程局部：仅本次创建对应节点时生效
  dfnTuningOverride = dfnTuning ? clampDfnTuning(dfnTuning) : null
  dtlnTuningOverride = dtlnTuning ? clampDtlnTuning(dtlnTuning) : null
  try {
    for (const model of FALLBACK_CHAINS[wanted]) {
      try {
        console.info(`[noise-suppression] 尝试加载 ${model}…`)
        if (model === "dtln") {
          const handle = await createDtlnHandle(
            ctx,
            strengthPercent,
            // 用户主动选 DTLN 用其调参；回退到 DTLN 时用默认预设
            model === wanted
              ? (dtlnTuningOverride ?? defaultDtlnTuningFromPreset())
              : defaultDtlnTuningFromPreset(),
          )
          if (model !== wanted) {
            console.warn(
              `[noise-suppression] ${wanted} 不可用，已回退到 ${model}`,
            )
            notifyFallback(wanted, model)
          } else {
            console.info(`[noise-suppression] ${model} 加载成功`)
          }
          return handle
        }
        const core = await createCoreNode(ctx, model)
        if (model !== wanted) {
          console.warn(
            `[noise-suppression] ${wanted} 不可用，已回退到 ${model}`,
          )
          notifyFallback(wanted, model)
        } else {
          console.info(`[noise-suppression] ${model} 加载成功`)
        }
        return wrapHandle(ctx, model, core, strengthPercent)
      } catch (error) {
        console.warn(`[noise-suppression] ${model} 加载失败`, error)
      }
    }
    console.error(
      `[noise-suppression] 模型链全部失败（wanted=${wanted}），直通不降噪`,
    )
    notifyAllFailed(wanted)
    return null
  } finally {
    dfnTuningOverride = null
    dtlnTuningOverride = null
  }
}

/**
 * 创建承载降噪的 AudioContext：显式 48kHz（DFN 硬要求；RNNoise 亦按 48kHz 假设）。
 * 环境不支持 sampleRate 选项时回退默认构造。
 */
export function createNsAudioContext(): AudioContext | null {
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext
  if (!Ctor) return null
  try {
    const ctx = new Ctor({ sampleRate: 48_000 })
    if (Math.round(ctx.sampleRate) !== 48_000) {
      console.warn(
        `[noise-suppression] 请求 48kHz AudioContext，实际得到 ${ctx.sampleRate}（DeepFilterNet 将无法使用）`,
      )
    }
    return ctx
  } catch (error) {
    console.warn(
      "[noise-suppression] 无法创建 48kHz AudioContext，回退默认采样率",
      error,
    )
    return new Ctor()
  }
}
