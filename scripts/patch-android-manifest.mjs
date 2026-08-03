#!/usr/bin/env node
/**
 * 在 `tauri android init` 之后运行：为语音/网络/通知/悬浮窗/前台服务补 AndroidManifest 权限。
 * 用法：node scripts/patch-android-manifest.mjs
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const manifestPath = path.join(
  root,
  "src-tauri",
  "gen",
  "android",
  "app",
  "src",
  "main",
  "AndroidManifest.xml",
)

const PERMS = [
  "android.permission.INTERNET",
  "android.permission.ACCESS_NETWORK_STATE",
  "android.permission.RECORD_AUDIO",
  "android.permission.MODIFY_AUDIO_SETTINGS",
  "android.permission.CAMERA",
  "android.permission.POST_NOTIFICATIONS",
  "android.permission.FOREGROUND_SERVICE",
  "android.permission.FOREGROUND_SERVICE_MICROPHONE",
  "android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK",
  "android.permission.SYSTEM_ALERT_WINDOW",
  "android.permission.WAKE_LOCK",
]

if (!fs.existsSync(manifestPath)) {
  console.error(
    "未找到 AndroidManifest.xml。请先执行：bun run android:init\n期望路径：",
    manifestPath,
  )
  process.exit(1)
}

let xml = fs.readFileSync(manifestPath, "utf8")
let added = 0

for (const perm of PERMS) {
  if (xml.includes(perm)) continue
  const line = `    <uses-permission android:name="${perm}" />\n`
  if (xml.includes("<application")) {
    xml = xml.replace(/(\s*)(<application\b)/, `\n${line}$1$2`)
  } else {
    xml = xml.replace("</manifest>", `${line}</manifest>`)
  }
  added++
}

// 语音前台服务（若缺失则补）
if (!xml.includes("VoiceBubbleService")) {
  const serviceXml = `
        <service
            android:name=".VoiceBubbleService"
            android:exported="false"
            android:foregroundServiceType="microphone|mediaPlayback" />
`
  if (xml.includes("</application>")) {
    xml = xml.replace("</application>", `${serviceXml}    </application>`)
    console.log("已添加 VoiceBubbleService")
  }
}

fs.writeFileSync(manifestPath, xml)
console.log(
  added > 0
    ? `已写入 ${added} 条 uses-permission → ${manifestPath}`
    : `权限已齐全，无需修改 → ${manifestPath}`,
)
