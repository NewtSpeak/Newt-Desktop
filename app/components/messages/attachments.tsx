// 消息内附件渲染（docs 07 §3.4）：
//   图片内嵌（最大 550×350，点击 lightbox）/ 音频视频原生播放器 /
//   PDF 卡片（系统默认方式打开）/ 其他类型下载卡片。
// download_url 为 15 分钟 HMAC 签名的相对路径，经 resolveApiUrl 指向当前服务器；
// 加载失败提示重试（简化的过期处理）。

import { useEffect, useState } from "react"
import {
  DownloadIcon,
  FileIcon,
  FileTextIcon,
  ImageOffIcon,
  XIcon,
} from "lucide-react"

import { resolveApiUrl } from "~/lib/api/http"
import type { MessageAttachment } from "~/lib/api/types"
import { cn } from "~/lib/utils"

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`
  return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`
}

// ---------------------------------------------------------------------------
// 通用文件卡片（下载 / PDF）
// ---------------------------------------------------------------------------

function FileCard({
  attachment,
  icon,
  onOpen,
}: {
  attachment: MessageAttachment
  icon: React.ReactNode
  onOpen?: () => void
}) {
  const downloadUrl = resolveApiUrl(attachment.download_url)
  return (
    <div className="flex w-fit max-w-full items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2.5">
      <span className="text-muted-foreground">{icon}</span>
      <div className="min-w-0">
        {onOpen ? (
          <button
            type="button"
            onClick={onOpen}
            className="block max-w-72 truncate text-left text-sm font-medium text-primary hover:underline"
            title={attachment.filename}
          >
            {attachment.filename}
          </button>
        ) : (
          <p
            className="max-w-72 truncate text-sm font-medium"
            title={attachment.filename}
          >
            {attachment.filename}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          {formatBytes(attachment.size)}
        </p>
      </div>
      <a
        href={downloadUrl}
        download={attachment.filename}
        aria-label={`下载 ${attachment.filename}`}
        className="ml-2 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <DownloadIcon className="size-4" />
      </a>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 图片（内嵌 + lightbox）
// ---------------------------------------------------------------------------

function ImageAttachment({ attachment }: { attachment: MessageAttachment }) {
  const [failed, setFailed] = useState(false)
  const [retryKey, setRetryKey] = useState(0)
  const [lightbox, setLightbox] = useState(false)
  const downloadUrl = resolveApiUrl(attachment.download_url)

  // lightbox 打开时 Esc 关闭（窗口级监听，遮罩本身不可聚焦）
  useEffect(() => {
    if (!lightbox) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setLightbox(false)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [lightbox])

  if (failed) {
    return (
      <div className="flex w-fit items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2.5 text-sm text-muted-foreground">
        <ImageOffIcon className="size-4" />
        <span>图片加载失败（链接可能已过期）</span>
        <button
          type="button"
          className="text-primary hover:underline"
          onClick={() => {
            setFailed(false)
            setRetryKey((value) => value + 1)
          }}
        >
          重试
        </button>
      </div>
    )
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setLightbox(true)}
        className="block w-fit overflow-hidden rounded-lg"
        aria-label={`查看图片 ${attachment.filename}`}
      >
        <img
          key={retryKey}
          src={downloadUrl}
          alt={attachment.filename}
          loading="lazy"
          onError={() => setFailed(true)}
          className="max-h-[350px] max-w-[550px] object-contain"
        />
      </button>
      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
          onClick={() => setLightbox(false)}
          role="dialog"
          aria-label="图片查看器"
        >
          <img
            src={downloadUrl}
            alt={attachment.filename}
            className="max-h-[90vh] max-w-[90vw] object-contain"
            onClick={(event) => event.stopPropagation()}
          />
          <div
            className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-full bg-black/70 px-4 py-2 text-sm text-white"
            onClick={(event) => event.stopPropagation()}
          >
            <span className="max-w-60 truncate">{attachment.filename}</span>
            <span className="text-white/60">
              {formatBytes(attachment.size)}
            </span>
            <a
              href={downloadUrl}
              download={attachment.filename}
              className="flex items-center gap-1 text-white/90 hover:text-white"
            >
              <DownloadIcon className="size-4" />
              下载
            </a>
          </div>
          <button
            type="button"
            onClick={() => setLightbox(false)}
            aria-label="关闭"
            className="absolute top-4 right-4 rounded-full bg-black/60 p-2 text-white hover:bg-black/80"
          >
            <XIcon className="size-5" />
          </button>
        </div>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

function AttachmentItem({ attachment }: { attachment: MessageAttachment }) {
  const isPdf = attachment.mime === "application/pdf"
  const downloadUrl = resolveApiUrl(attachment.download_url)

  switch (attachment.preview) {
    case "image":
      return <ImageAttachment attachment={attachment} />
    case "video":
      return (
        <video
          src={downloadUrl}
          controls
          preload="metadata"
          className="max-h-[350px] max-w-[550px] rounded-lg bg-black"
        >
          <track kind="captions" />
        </video>
      )
    case "audio":
      return (
        <div className="w-fit max-w-full rounded-lg border bg-muted/30 p-2">
          <p className="max-w-96 truncate px-1 pb-1 text-xs text-muted-foreground">
            {attachment.filename}（{formatBytes(attachment.size)}）
          </p>
          <audio
            src={downloadUrl}
            controls
            preload="metadata"
            className="h-10"
          />
        </div>
      )
    default:
      if (isPdf) {
        return (
          <FileCard
            attachment={attachment}
            icon={<FileTextIcon className="size-8" />}
            onOpen={() =>
              window.open(downloadUrl, "_blank", "noopener,noreferrer")
            }
          />
        )
      }
      return (
        <FileCard
          attachment={attachment}
          icon={<FileIcon className="size-8" />}
        />
      )
  }
}

export function MessageAttachments({
  attachments,
  className,
}: {
  attachments: MessageAttachment[]
  className?: string
}) {
  if (attachments.length === 0) return null
  return (
    <div className={cn("mt-1 flex flex-col gap-1.5", className)}>
      {attachments.map((attachment) => (
        <AttachmentItem key={attachment.id} attachment={attachment} />
      ))}
    </div>
  )
}
