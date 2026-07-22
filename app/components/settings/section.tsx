// 设置面板通用小组件：分栏标题、设置行、「即将推出」徽标。

import { Badge } from "~/components/ui/badge"

import { settingsAnchorDomId } from "./settings-toc"

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-5 text-lg font-semibold text-balance">{children}</h2>
  )
}

/**
 * 分组标题；传入 id 时作为子菜单跳转锚点（与 settings-toc 中 id 对齐）。
 * scroll-mt 避免被顶栏挡住。
 */
export function GroupLabel({
  id,
  children,
}: {
  id?: string
  children: React.ReactNode
}) {
  return (
    <p
      id={id ? settingsAnchorDomId(id) : undefined}
      className="mt-8 mb-2 scroll-mt-6 text-xs font-semibold tracking-wide text-muted-foreground uppercase first:mt-0"
    >
      {children}
    </p>
  )
}

/** 单条设置行：左侧标题+描述，右侧控件 */
export function SettingRow({
  label,
  description,
  children,
}: {
  label: React.ReactNode
  description?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-6 py-3.5">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      </div>
      {children && <div className="shrink-0">{children}</div>}
    </div>
  )
}

export function ComingSoon() {
  return (
    <Badge variant="secondary" className="text-xs">
      即将推出
    </Badge>
  )
}
