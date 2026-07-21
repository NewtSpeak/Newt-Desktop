// 剪贴板工具：统一成功/失败 toast。

import { toast } from "sonner"

export async function copyText(label: string, value: string) {
  try {
    await navigator.clipboard.writeText(value)
    toast.success(`已复制${label}`)
  } catch {
    toast.error("复制失败，请检查剪贴板权限")
  }
}
