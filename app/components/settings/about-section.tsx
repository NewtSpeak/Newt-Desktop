// 设置 · 关于：版本号（构建期读 package.json）与开源信息占位。

import packageJson from "../../../package.json"
import { GroupLabel, SectionTitle, SettingRow } from "./section"

export function AboutSection() {
  return (
    <div>
      <SectionTitle>关于</SectionTitle>

      <div className="flex items-center gap-4 rounded-2xl bg-muted/50 p-4">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-primary text-2xl font-bold text-primary-foreground select-none">
          Owl
        </div>
        <div>
          <p className="text-base font-semibold">NewtSpeak Desktop</p>
          <p className="text-sm text-muted-foreground">版本 {packageJson.version ?? "0.0.0"}</p>
        </div>
      </div>

      <GroupLabel id="about-oss">开源信息</GroupLabel>
      <SettingRow
        label="开源许可"
        description="第三方依赖许可信息整理中，将在后续版本提供"
      />
      <SettingRow label="源代码" description="项目开源地址待公布" />
    </div>
  )
}
