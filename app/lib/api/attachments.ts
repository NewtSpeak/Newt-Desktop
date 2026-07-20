// 附件二段式上传（docs 13 AT）：
//   1. presign 声明文件名/大小/MIME → 拿 attachment_id + 一次性 upload_url；
//   2. PUT 原始字节到 upload_url（大小必须与声明完全一致）；
//   3. 发消息时把 attachment_id 放进 attachment_ids 完成绑定。

import { api, ApiError, ensureAccessToken } from "./http"
import type { PresignResult, UploadResult } from "./types"

export type PresignInput = {
  filename: string
  size: number
  mime?: string
}

/** 需 ATTACH_FILES；size 超过服级上限返回 400 FILE_TOO_LARGE */
export const presignAttachment = (channelId: string, input: PresignInput) =>
  api<PresignResult>(`/channels/${channelId}/attachments/presign`, {
    method: "POST",
    body: JSON.stringify(input),
  })

/**
 * 上传附件内容。upload_url 已含 token 查询串（相对路径，走同源代理），
 * 且认证头照常携带（上传端点在认证组内）。
 */
export async function uploadAttachmentContent(
  presigned: PresignResult,
  body: Blob | ArrayBuffer,
): Promise<UploadResult> {
  // upload_url 已是完整相对路径（含 /gapi/v1 前缀），不能再走 api() 的 BASE_URL 拼接
  const token = await ensureAccessToken()
  const headers = new Headers({ "Content-Type": "application/octet-stream" })
  if (token) headers.set("Authorization", `Bearer ${token}`)
  const response = await fetch(presigned.upload_url, { method: "PUT", headers, body })
  if (!response.ok) {
    const parsed = (await response.json().catch(() => ({}))) as {
      error?: { code?: string; message?: string }
    }
    throw new ApiError(
      response.status,
      parsed.error?.code ?? "UPLOAD_FAILED",
      parsed.error?.message ?? `附件上传失败（${response.status}）`,
    )
  }
  return (await response.json()) as UploadResult
}

/**
 * 带进度回调的直传（XHR：fetch 拿不到上传进度）。
 * 返回可 abort 的句柄；Promise 在完成/失败/取消时 settle。
 */
export function uploadAttachmentWithProgress(
  presigned: PresignResult,
  body: Blob,
  onProgress: (loaded: number, total: number) => void,
): { promise: Promise<UploadResult>; abort: () => void } {
  const xhr = new XMLHttpRequest()
  const promise = (async () => {
    const token = await ensureAccessToken()
    return new Promise<UploadResult>((resolve, reject) => {
      xhr.open("PUT", presigned.upload_url)
      xhr.setRequestHeader("Content-Type", "application/octet-stream")
      if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`)
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress(event.loaded, event.total)
      }
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText) as UploadResult)
          } catch {
            reject(new ApiError(xhr.status, "UPLOAD_FAILED", "附件上传响应解析失败"))
          }
          return
        }
        let code = "UPLOAD_FAILED"
        let message = `附件上传失败（${xhr.status}）`
        try {
          const parsed = JSON.parse(xhr.responseText) as {
            error?: { code?: string; message?: string }
          }
          code = parsed.error?.code ?? code
          message = parsed.error?.message ?? message
        } catch {
          // 保持默认文案
        }
        reject(new ApiError(xhr.status, code, message))
      }
      xhr.onerror = () => reject(new ApiError(0, "NETWORK_ERROR", "网络请求失败，附件上传中断"))
      xhr.onabort = () => reject(new ApiError(0, "UPLOAD_ABORTED", "上传已取消"))
      xhr.send(body)
    })
  })()
  return { promise, abort: () => xhr.abort() }
}
