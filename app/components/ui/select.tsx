"use client"

/**
 * Select 封装（Base UI）。
 *
 * 关键点：关闭弹层后 Item 不在 DOM，若未向 Root 提供 `items`，
 * SelectValue 会回退显示 raw value（UUID / deviceId 等）。
 * 这里自动从子树中的 SelectItem 收集 { value, label } 并传给 Root，
 * 使触发器始终显示选项的渲染文案，而非字段值。
 */

import * as React from "react"
import { Select as SelectPrimitive } from "@base-ui/react/select"

import { cn } from "~/lib/utils"
import { ChevronDownIcon, CheckIcon, ChevronUpIcon } from "lucide-react"

// ---------------------------------------------------------------------------
// 从 React 子树收集 SelectItem → Base UI items
// ---------------------------------------------------------------------------

type ItemEntry = { value: unknown; label: React.ReactNode }

const SELECT_ITEM_FLAG = "__owlSelectItem"

function extractText(node: React.ReactNode): string {
  if (node == null || typeof node === "boolean") return ""
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(extractText).join("")
  if (React.isValidElement(node)) {
    const kids = (node.props as { children?: React.ReactNode }).children
    return extractText(kids)
  }
  return ""
}

type SelectItemProps = {
  value?: unknown
  label?: React.ReactNode
  children?: React.ReactNode
}

function isSelectItemElement(
  child: React.ReactElement,
): child is React.ReactElement<SelectItemProps> {
  const t = child.type as { [SELECT_ITEM_FLAG]?: boolean } | string
  return typeof t === "function" && Boolean((t as { [SELECT_ITEM_FLAG]?: boolean })[SELECT_ITEM_FLAG])
}

/** 深度遍历 children，收集所有 SelectItem 的 value/label（不依赖 DOM 是否挂载） */
function collectSelectItems(node: React.ReactNode, out: ItemEntry[]) {
  React.Children.forEach(node, (child) => {
    if (!React.isValidElement(child)) return
    if (isSelectItemElement(child)) {
      const { value, label, children } = child.props
      const resolved =
        label ??
        (children != null && children !== false ? children : null) ??
        (value == null ? null : String(value))
      out.push({ value, label: resolved })
      return
    }
    const kids = (child.props as { children?: React.ReactNode } | null)?.children
    if (kids != null) collectSelectItems(kids, out)
  })
}

type RootItems = NonNullable<SelectPrimitive.Root.Props<unknown>["items"]>

function mergeItems(
  explicit: RootItems | undefined,
  collected: ItemEntry[],
): RootItems | undefined {
  if (explicit != null) return explicit
  if (collected.length === 0) return undefined
  return collected as RootItems
}

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

function Select<Value = string, Multiple extends boolean | undefined = false>({
  items: itemsProp,
  children,
  ...props
}: SelectPrimitive.Root.Props<Value, Multiple>) {
  const collected = React.useMemo(() => {
    const out: ItemEntry[] = []
    collectSelectItems(children, out)
    return out
  }, [children])

  const items = mergeItems(
    itemsProp as RootItems | undefined,
    collected,
  ) as SelectPrimitive.Root.Props<Value, Multiple>["items"]

  return (
    <SelectPrimitive.Root items={items} {...props}>
      {children}
    </SelectPrimitive.Root>
  )
}

// ---------------------------------------------------------------------------
// Parts
// ---------------------------------------------------------------------------

function SelectGroup({ className, ...props }: SelectPrimitive.Group.Props) {
  return (
    <SelectPrimitive.Group
      data-slot="select-group"
      className={cn("scroll-my-1.5 p-1.5", className)}
      {...props}
    />
  )
}

function SelectValue({ className, ...props }: SelectPrimitive.Value.Props) {
  return (
    <SelectPrimitive.Value
      data-slot="select-value"
      className={cn("flex min-w-0 flex-1 text-left", className)}
      {...props}
    />
  )
}

function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}: SelectPrimitive.Trigger.Props & {
  size?: "sm" | "default"
}) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        "flex w-fit items-center justify-between gap-1.5 rounded-3xl border border-transparent bg-input/50 px-3 py-2 text-sm transition-[color,box-shadow,background-color] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-placeholder:text-muted-foreground data-[size=default]:h-9 data-[size=sm]:h-8 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-1.5 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon
        render={
          <ChevronDownIcon className="pointer-events-none size-4 shrink-0 text-muted-foreground" />
        }
      />
    </SelectPrimitive.Trigger>
  )
}

function SelectContent({
  className,
  children,
  side = "bottom",
  sideOffset = 4,
  align = "center",
  alignOffset = 0,
  alignItemWithTrigger = true,
  ...props
}: SelectPrimitive.Popup.Props &
  Pick<
    SelectPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset" | "alignItemWithTrigger"
  >) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        alignItemWithTrigger={alignItemWithTrigger}
        className="isolate z-50"
      >
        <SelectPrimitive.Popup
          data-slot="select-content"
          data-align-trigger={alignItemWithTrigger}
          className={cn(
            "relative isolate z-50 max-h-(--available-height) w-(--anchor-width) min-w-36 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-3xl bg-popover text-popover-foreground shadow-lg ring-1 ring-foreground/5 duration-100 data-[align-trigger=true]:animate-none data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 dark:ring-foreground/10",
            className,
          )}
          {...props}
        >
          <SelectScrollUpButton />
          <SelectPrimitive.List>{children}</SelectPrimitive.List>
          <SelectScrollDownButton />
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  )
}

function SelectLabel({
  className,
  ...props
}: SelectPrimitive.GroupLabel.Props) {
  return (
    <SelectPrimitive.GroupLabel
      data-slot="select-label"
      className={cn("px-3 py-2.5 text-xs text-muted-foreground", className)}
      {...props}
    />
  )
}

function SelectItem({
  className,
  children,
  label,
  value,
  ...props
}: SelectPrimitive.Item.Props) {
  // 键盘快速定位用纯文本；优先显式 label，否则从 children 抽文本
  const resolvedLabel =
    label ??
    (extractText(children) ||
      (value == null ? undefined : String(value)))

  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      value={value}
      label={resolvedLabel}
      className={cn(
        "relative flex w-full cursor-default items-center gap-2.5 rounded-2xl py-2 pr-8 pl-3 text-sm font-medium outline-hidden select-none focus:bg-accent focus:text-accent-foreground not-data-[variant=destructive]:focus:**:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText className="flex min-w-0 flex-1 gap-2">
        {children}
      </SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator
        render={
          <span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center" />
        }
      >
        <CheckIcon className="pointer-events-none" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  )
}

;(SelectItem as unknown as { [SELECT_ITEM_FLAG]: boolean })[SELECT_ITEM_FLAG] =
  true
SelectItem.displayName = "SelectItem"

function SelectSeparator({
  className,
  ...props
}: SelectPrimitive.Separator.Props) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn(
        "pointer-events-none -mx-1.5 my-1.5 h-px bg-border",
        className,
      )}
      {...props}
    />
  )
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpArrow>) {
  return (
    <SelectPrimitive.ScrollUpArrow
      data-slot="select-scroll-up-button"
      className={cn(
        "top-0 z-10 flex w-full cursor-default items-center justify-center bg-popover py-1 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      <ChevronUpIcon />
    </SelectPrimitive.ScrollUpArrow>
  )
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownArrow>) {
  return (
    <SelectPrimitive.ScrollDownArrow
      data-slot="select-scroll-down-button"
      className={cn(
        "bottom-0 z-10 flex w-full cursor-default items-center justify-center bg-popover py-1 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      <ChevronDownIcon />
    </SelectPrimitive.ScrollDownArrow>
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
}
