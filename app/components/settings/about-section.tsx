// 设置 · 关于：版本号、应用内更新（GitHub + 国内镜像预下载）

import packageJson from "../../../package.json"
import { Button } from "~/components/ui/button"
import { Switch } from "~/components/ui/switch"
import {
  formatBytes,
  formatLatency,
  formatSpeed,
  isDesktopUpdaterSupported,
  phaseLabel,
  qualityBarClass,
  qualityTone,
} from "~/lib/updater"
import { cn } from "~/lib/utils"
import { useUpdaterStore } from "~/stores/updater"
import { GroupLabel, SectionTitle, SettingRow } from "./section"

function UpdateProgressBar({ value }: { value: number }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100)
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div
        className="h-full rounded-full bg-primary transition-[width] duration-200"
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

function DesktopUpdateBlock() {
  const status = useUpdaterStore((s) => s.status)
  const mirrors = useUpdaterStore((s) => s.mirrors)
  const probeById = useUpdaterStore((s) => s.probeById)
  const probing = useUpdaterStore((s) => s.probing)
  const busy = useUpdaterStore((s) => s.busy)
  const error = useUpdaterStore((s) => s.error)
  const installOnQuit = useUpdaterStore((s) => s.installOnQuit)
  const checkAndDownload = useUpdaterStore((s) => s.checkAndDownload)
  const installNow = useUpdaterStore((s) => s.installNow)
  const setAutoCheck = useUpdaterStore((s) => s.setAutoCheck)
  const setInstallOnQuit = useUpdaterStore((s) => s.setInstallOnQuit)
  const probeMirrors = useUpdaterStore((s) => s.probeMirrors)

  const phase = status?.phase ?? "idle"
  const canInstall = phase === "ready"
  const downloading = phase === "downloading"
  const checking = phase === "checking" || busy
  const hasProbe = Object.keys(probeById).length > 0

  return (
    <>
      <GroupLabel id="about-update">软件更新</GroupLabel>

      <div className="rounded-2xl border border-border/50 bg-muted/30 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">
              {phaseLabel(phase)}
              {status?.latestVersion &&
              phase !== "up_to_date" &&
              phase !== "idle" ? (
                <span className="text-muted-foreground">
                  {" "}
                  · v{status.latestVersion}
                </span>
              ) : null}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              更新源：GitHub Releases（NewtSpeak/Newt-Desktop）
              <br />
              有新版本时自动经国内镜像下载到本地，
              <strong className="font-medium text-foreground/80">
                不会立刻安装
              </strong>
              ；关闭应用或点击「立即更新」时才安装。
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={checking || downloading}
              onClick={() => void checkAndDownload()}
            >
              {checking ? "检查中…" : downloading ? "下载中…" : "检查更新"}
            </Button>
            <Button
              size="sm"
              disabled={!canInstall || busy}
              onClick={() => void installNow()}
            >
              立即更新
            </Button>
          </div>
        </div>

        {(downloading || canInstall) && status ? (
          <div className="mt-3 space-y-1.5">
            <UpdateProgressBar value={status.progress} />
            <p className="text-[11px] text-muted-foreground tabular-nums">
              {formatBytes(status.bytesDownloaded)}
              {status.bytesTotal != null
                ? ` / ${formatBytes(status.bytesTotal)}`
                : ""}
              {status.mirrorLabel ? ` · 镜像 ${status.mirrorLabel}` : ""}
              {status.assetName ? ` · ${status.assetName}` : ""}
            </p>
          </div>
        ) : null}

        {error || status?.error ? (
          <p className="mt-2 text-xs text-destructive">
            {error || status?.error}
          </p>
        ) : null}

        {status?.releaseNotes?.trim() &&
        (phase === "available" ||
          phase === "downloading" ||
          phase === "ready") ? (
          <details className="mt-3 rounded-xl bg-background/60 px-3 py-2 text-xs">
            <summary className="cursor-pointer select-none font-medium text-foreground/80">
              更新说明
            </summary>
            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap font-sans text-muted-foreground">
              {status.releaseNotes.trim().slice(0, 4000)}
            </pre>
          </details>
        ) : null}
      </div>

      <SettingRow
        label="自动检查更新"
        description="每 10 分钟检查一次 GitHub；发现新版本后后台下载，不打断使用"
      >
        <Switch
          checked={status?.autoCheck ?? true}
          onCheckedChange={(v) => void setAutoCheck(Boolean(v))}
        />
      </SettingRow>

      <SettingRow
        label="退出时安装更新"
        description="关闭应用时，若安装包已下载完成则自动启动安装程序"
      >
        <Switch
          checked={installOnQuit}
          onCheckedChange={(v) => void setInstallOnQuit(Boolean(v))}
        />
      </SettingRow>

      <SettingRow
        label="当前版本"
        description={`v${status?.currentVersion ?? packageJson.version ?? "0.0.0"}`}
      />

      {mirrors.length > 0 ? (
        <>
          <GroupLabel id="about-mirrors">下载加速镜像</GroupLabel>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              按顺序尝试以下中国大陆加速站，全部失败后再回退 GitHub 官方源。
              测速会采样约 512KB 流量，用于比较延迟与带宽。
            </p>
            <Button
              size="sm"
              variant="outline"
              disabled={probing}
              onClick={() => void probeMirrors()}
            >
              {probing ? "测速中…" : hasProbe ? "重新测速" : "测速"}
            </Button>
          </div>

          {/* 表头 */}
          <div className="mb-1 grid grid-cols-[1.4rem_minmax(0,1fr)_4.5rem_5.5rem_minmax(4.5rem,1fr)] items-center gap-x-2 px-3 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
            <span>#</span>
            <span>镜像</span>
            <span className="text-right">延迟</span>
            <span className="text-right">速度</span>
            <span>通畅度</span>
          </div>

          <ul className="space-y-1 rounded-2xl bg-muted/40 px-2 py-2">
            {mirrors.map((m, index) => {
              const probe = probeById[m.id]
              const active =
                status?.mirrorId === m.id && (downloading || canInstall)
              return (
                <li
                  key={m.id}
                  className={cn(
                    "grid grid-cols-[1.4rem_minmax(0,1fr)_4.5rem_5.5rem_minmax(4.5rem,1fr)] items-center gap-x-2 rounded-xl px-1.5 py-2 text-xs",
                    active && "bg-primary/10 font-medium text-primary",
                    probe?.probing && "bg-muted/60",
                  )}
                  title={probe?.error ?? undefined}
                >
                  <span className="tabular-nums text-muted-foreground">
                    {index + 1}.
                  </span>
                  <div className="min-w-0">
                    <p className="truncate">{m.label}</p>
                    {active && downloading ? (
                      <p className="text-[10px] text-primary">下载中</p>
                    ) : null}
                    {active && canInstall ? (
                      <p className="text-[10px] text-emerald-600 dark:text-emerald-400">
                        已使用
                      </p>
                    ) : null}
                    {probe?.error && !probe.ok ? (
                      <p className="truncate text-[10px] text-destructive/80">
                        {probe.error}
                      </p>
                    ) : null}
                  </div>
                  <span
                    className={cn(
                      "text-right tabular-nums",
                      probe?.probing
                        ? "text-muted-foreground"
                        : probe && !probe.ok
                          ? "text-destructive"
                          : "text-foreground/80",
                    )}
                  >
                    {probe?.probing
                      ? "…"
                      : probe
                        ? formatLatency(probe.latencyMs)
                        : "—"}
                  </span>
                  <span
                    className={cn(
                      "text-right tabular-nums",
                      probe?.probing
                        ? "text-muted-foreground"
                        : probe && !probe.ok
                          ? "text-destructive"
                          : "text-foreground/80",
                    )}
                  >
                    {probe?.probing
                      ? "…"
                      : probe
                        ? formatSpeed(probe.speedBps)
                        : "—"}
                  </span>
                  <div className="min-w-0">
                    {probe?.probing ? (
                      <span className="text-[11px] text-muted-foreground">
                        探测中
                      </span>
                    ) : probe ? (
                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={cn(
                              "text-[11px] font-semibold tabular-nums",
                              qualityTone(probe.quality, probe.ok),
                            )}
                          >
                            {probe.ok
                              ? `${probe.qualityLabel} ${probe.quality}`
                              : "不通"}
                          </span>
                        </div>
                        <div className="h-1 overflow-hidden rounded-full bg-background/70">
                          <div
                            className={cn(
                              "h-full rounded-full transition-[width] duration-300",
                              qualityBarClass(probe.quality, probe.ok),
                            )}
                            style={{
                              width: `${probe.ok ? probe.quality : 4}%`,
                            }}
                          />
                        </div>
                      </div>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">
                        未测
                      </span>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
          {hasProbe && !probing ? (
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              通畅度综合延迟与采样带宽（优 ≥85 · 良 ≥65 · 中 ≥40 · 差
              &lt;40）。实际更新下载仍按列表顺序尝试。
            </p>
          ) : null}
        </>
      ) : null}
    </>
  )
}

export function AboutSection() {
  const desktop = isDesktopUpdaterSupported()

  return (
    <div>
      <SectionTitle>关于</SectionTitle>

      <div className="flex items-center gap-4 rounded-2xl bg-muted/50 p-4">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-primary text-2xl font-bold text-primary-foreground select-none">
          N
        </div>
        <div>
          <p className="text-base font-semibold">NewtSpeak Desktop</p>
          <p className="text-sm text-muted-foreground">
            版本 {packageJson.version ?? "0.0.0"}
          </p>
        </div>
      </div>

      {desktop ? (
        <DesktopUpdateBlock />
      ) : (
        <>
          <GroupLabel id="about-update">软件更新</GroupLabel>
          <SettingRow
            label="应用内更新"
            description="自动更新仅在桌面客户端（Windows / macOS / Linux）可用；Web 与移动端请从发布页获取安装包"
          />
        </>
      )}

      <GroupLabel id="about-oss">开源信息</GroupLabel>
      <SettingRow
        label="开源许可"
        description="第三方依赖许可信息整理中，将在后续版本提供"
      />
      <SettingRow
        label="源代码"
        description="https://github.com/NewtSpeak/Newt-Desktop"
      />
    </div>
  )
}
