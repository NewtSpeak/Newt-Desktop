import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * 判断服务器外观资产 URL 是否为可内嵌播放的视频（当前仅 MP4）。
 * 依据路径扩展名（服务端上传落盘为 .mp4，URL 不可变）。
 */
export function isGuildMediaVideo(url: string | null | undefined): boolean {
  if (!url) return false
  // 去掉 query/hash，再取扩展名
  const path = url.split(/[?#]/, 1)[0] ?? url
  return /\.mp4$/i.test(path)
}
