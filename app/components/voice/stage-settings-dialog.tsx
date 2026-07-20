// 语音频道模式设置 Dialog（docs 10 FR-01~04，简版）：
// 模式单选（自由讨论 / 舞台）、台上名额 max_speakers（1–50，>20 黄色警告）、
// 允许举手开关。入口乐观显示，权限由服务端 PATCH 裁决（403 → 中文提示）；
// STAGE→FREE 注明「队列将被清空」；>50 人被拒（STAGE_REQUIRED_BY_CAPACITY）有专属文案。

import { useEffect, useState } from "react"
import { toast } from "sonner"

import { Button } from "~/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group"
import { Switch } from "~/components/ui/switch"
import { patchVoiceStage } from "~/lib/api/stage"
import type { StageConfigPatch, VoiceChannelMode } from "~/lib/api/types"
import { stageErrorMessage } from "~/lib/voice/stage-errors"
import { useStageStore, type StageChannelState } from "~/stores/stage"

export function StageSettingsDialog({
  channelId,
  open,
  onOpenChange,
  stage,
  inferredMode,
}: {
  channelId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  stage: StageChannelState | undefined
  /** 实例未知时的推断模式（表单初值用） */
  inferredMode: VoiceChannelMode
}) {
  const currentMode = stage?.instanceKnown ? stage.mode : inferredMode
  const [mode, setMode] = useState<VoiceChannelMode>(currentMode)
  const [maxSpeakers, setMaxSpeakers] = useState(stage?.maxSpeakers ?? 20)
  const [requestEnabled, setRequestEnabled] = useState(
    stage?.requestToSpeakEnabled ?? true
  )
  const [saving, setSaving] = useState(false)

  // 每次打开时以最新 store 状态重置表单
  useEffect(() => {
    if (!open) return
    setMode(currentMode)
    setMaxSpeakers(stage?.maxSpeakers ?? 20)
    setRequestEnabled(stage?.requestToSpeakEnabled ?? true)
    // 仅在打开瞬间同步，避免编辑中被事件覆盖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const speakersInvalid =
    !Number.isInteger(maxSpeakers) || maxSpeakers < 1 || maxSpeakers > 50
  const speakersWarn = !speakersInvalid && maxSpeakers > 20
  const switchingToFree = currentMode === "STAGE" && mode === "FREE_DISCUSSION"
  const switchingToStage = currentMode === "FREE_DISCUSSION" && mode === "STAGE"

  const submit = async () => {
    if (speakersInvalid) {
      toast.error("台上名额需为 1–50 的整数")
      return
    }
    const patch: StageConfigPatch = {
      mode,
      max_speakers: maxSpeakers,
      request_to_speak_enabled: requestEnabled,
    }
    setSaving(true)
    try {
      const result = await patchVoiceStage(channelId, patch)
      // PATCH 响应即权威实例状态，直接落 store（事件到达时再次对齐）
      useStageStore
        .getState()
        .applyInstanceUpdate({ ...result, channel_id: channelId })
      toast.success("频道设置已保存")
      onOpenChange(false)
    } catch (error) {
      toast.error(stageErrorMessage(error, "保存失败，请稍后再试"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>语音频道模式</DialogTitle>
          <DialogDescription>
            模式与名额的修改需要频道管理权限，保存时由服务端校验。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5">
          <RadioGroup
            value={mode}
            onValueChange={(value) => setMode(value as VoiceChannelMode)}
            className="gap-2"
          >
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border p-3 hover:bg-accent/50">
              <RadioGroupItem value="FREE_DISCUSSION" className="mt-0.5" />
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">自由讨论</span>
                <span className="text-xs text-muted-foreground">
                  全员可自由发言（默认）
                </span>
                {switchingToFree && (
                  <span className="text-xs text-amber-600 dark:text-amber-400">
                    切回自由讨论后，当前申请队列将被清空；频道超过 50
                    人时无法切回
                  </span>
                )}
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border p-3 hover:bg-accent/50">
              <RadioGroupItem value="STAGE" className="mt-0.5" />
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">舞台</span>
                <span className="text-xs text-muted-foreground">
                  仅台上成员可发言，听众可举手申请上麦
                </span>
                {switchingToStage && (
                  <span className="text-xs text-amber-600 dark:text-amber-400">
                    切换后仅台上成员可发言，超出名额的发言者将进入听众席
                  </span>
                )}
              </span>
            </label>
          </RadioGroup>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="stage-max-speakers">台上名额（1–50）</Label>
            <Input
              id="stage-max-speakers"
              type="number"
              min={1}
              max={50}
              value={maxSpeakers}
              onChange={(event) => setMaxSpeakers(Number(event.target.value))}
              className="w-28"
            />
            {speakersWarn && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                超过推荐上限 20，可能影响听众带宽
              </p>
            )}
            {speakersInvalid && (
              <p className="text-xs text-destructive">
                台上名额需为 1–50 的整数
              </p>
            )}
          </div>

          <div className="flex items-center justify-between gap-3">
            <span className="flex flex-col">
              <span className="text-sm">允许举手申请上麦</span>
              <span className="text-xs text-muted-foreground">
                关闭后仅管理员可邀请成员上台（仅抱麦模式）
              </span>
            </span>
            <Switch
              checked={requestEnabled}
              onCheckedChange={(checked) => setRequestEnabled(Boolean(checked))}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            disabled={saving || speakersInvalid}
            onClick={() => void submit()}
          >
            {saving ? "保存中…" : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
