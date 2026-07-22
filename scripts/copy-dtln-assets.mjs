#!/usr/bin/env node
/**
 * 将 @sapphi-red/dtln-web 运行时资产拷到 public/dtln/。
 * setup()/loadModel() 按固定路径前缀拉取：
 *   - tflite_web_api_cc*.{js,wasm,worker.js}
 *   - model_quant_dynamic_{1,2}.tflite（动态量化，体积小）
 *
 * 用法：node scripts/copy-dtln-assets.mjs
 * 建议：postinstall / predev / prebuild 自动跑。
 */
import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const srcDir = join(root, "node_modules/@sapphi-red/dtln-web/dist")
const destDir = join(root, "public/dtln")

const REQUIRED = [
  // TFLite WASM 运行时（setup 必需；缺 .js 会导致加载失败并回退 RNNoise）
  "tflite_web_api_cc.js",
  "tflite_web_api_cc.wasm",
  "tflite_web_api_cc_simd.js",
  "tflite_web_api_cc_simd.wasm",
  "tflite_web_api_cc_threaded.js",
  "tflite_web_api_cc_threaded.wasm",
  "tflite_web_api_cc_threaded.worker.js",
  "tflite_web_api_cc_simd_threaded.js",
  "tflite_web_api_cc_simd_threaded.wasm",
  "tflite_web_api_cc_simd_threaded.worker.js",
  // 动态量化权重（loadModel quant: "dynamic"）
  "model_quant_dynamic_1.tflite",
  "model_quant_dynamic_2.tflite",
]

if (!existsSync(srcDir)) {
  console.error(
    `[copy-dtln-assets] 未找到 ${srcDir}，请先安装 @sapphi-red/dtln-web`,
  )
  process.exit(1)
}

mkdirSync(destDir, { recursive: true })

let missing = 0
for (const name of REQUIRED) {
  const from = join(srcDir, name)
  if (!existsSync(from)) {
    console.warn(`[copy-dtln-assets] 源文件缺失，跳过: ${name}`)
    missing += 1
    continue
  }
  cpSync(from, join(destDir, name))
}

// LICENSE 在包根目录，可选
const license = join(root, "node_modules/@sapphi-red/dtln-web/LICENSE")
if (existsSync(license)) {
  cpSync(license, join(destDir, "LICENSE"))
}

const listed = readdirSync(destDir)
console.info(
  `[copy-dtln-assets] 已同步 ${REQUIRED.length - missing}/${REQUIRED.length} 个必需文件 → public/dtln/（当前共 ${listed.length} 项）`,
)
if (missing > 0) process.exitCode = 1
