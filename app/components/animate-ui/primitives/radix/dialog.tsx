"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { AnimatePresence, motion, type HTMLMotionProps } from "motion/react"

import { useControlledState } from "~/hooks/use-controlled-state"
import { getStrictContext } from "~/lib/get-strict-context"

type DialogContextType = {
  isOpen: boolean
  setIsOpen: DialogProps["onOpenChange"]
}

const [DialogProvider, useDialog] =
  getStrictContext<DialogContextType>("DialogContext")

type DialogProps = React.ComponentProps<typeof DialogPrimitive.Root>

function Dialog(props: DialogProps) {
  const [isOpen, setIsOpen] = useControlledState({
    value: props?.open,
    defaultValue: props?.defaultOpen,
    onChange: props?.onOpenChange,
  })

  return (
    <DialogProvider value={{ isOpen, setIsOpen }}>
      <DialogPrimitive.Root
        data-slot="dialog"
        {...props}
        open={isOpen}
        onOpenChange={setIsOpen}
      />
    </DialogProvider>
  )
}

type DialogTriggerProps = React.ComponentProps<typeof DialogPrimitive.Trigger>

function DialogTrigger(props: DialogTriggerProps) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

type DialogPortalProps = Omit<
  React.ComponentProps<typeof DialogPrimitive.Portal>,
  "forceMount"
>

function DialogPortal({ children, ...props }: DialogPortalProps) {
  const { isOpen } = useDialog()
  const [present, setPresent] = React.useState(isOpen)

  React.useEffect(() => {
    if (isOpen) setPresent(true)
  }, [isOpen])

  if (!present) return null

  return (
    <DialogPrimitive.Portal data-slot="dialog-portal" forceMount {...props}>
      <AnimatePresence onExitComplete={() => setPresent(false)}>
        {isOpen ? children : null}
      </AnimatePresence>
    </DialogPrimitive.Portal>
  )
}

type DialogOverlayProps = Omit<
  React.ComponentProps<typeof DialogPrimitive.Overlay>,
  "forceMount" | "asChild"
> &
  HTMLMotionProps<"div">

function DialogOverlay({
  transition = { duration: 0.2, ease: "easeInOut" },
  ...props
}: DialogOverlayProps) {
  return (
    <DialogPrimitive.Overlay
      key="dialog-overlay"
      data-slot="dialog-overlay"
      asChild
      forceMount
    >
      <motion.div
        initial={{ opacity: 0, filter: "blur(4px)" }}
        animate={{ opacity: 1, filter: "blur(0px)" }}
        exit={{ opacity: 0, filter: "blur(4px)" }}
        transition={transition}
        {...props}
      />
    </DialogPrimitive.Overlay>
  )
}

type DialogFlipDirection = "top" | "bottom" | "left" | "right"

type DialogContentProps = Omit<
  React.ComponentProps<typeof DialogPrimitive.Content>,
  "forceMount" | "asChild"
> &
  HTMLMotionProps<"div"> & {
    from?: DialogFlipDirection
  }

function DialogContent({
  from = "top",
  onOpenAutoFocus,
  onCloseAutoFocus,
  onEscapeKeyDown,
  onPointerDownOutside,
  onInteractOutside,
  transition = { type: "spring", stiffness: 150, damping: 25 },
  ...props
}: DialogContentProps) {
  const initialRotation = from === "bottom" || from === "left" ? 20 : -20
  const isVertical = from === "top" || from === "bottom"
  const rotateAxis = isVertical ? "rotateX" : "rotateY"

  return (
    <DialogPrimitive.Content
      key="dialog-content"
      asChild
      forceMount
      onOpenAutoFocus={onOpenAutoFocus}
      onCloseAutoFocus={onCloseAutoFocus}
      onEscapeKeyDown={onEscapeKeyDown}
      onPointerDownOutside={onPointerDownOutside}
      onInteractOutside={onInteractOutside}
    >
      <motion.div
        data-slot="dialog-content"
        initial={{
          opacity: 0,
          filter: "blur(4px)",
          // 保留居中 translate，避免 motion 的 transform 覆盖 CSS -50%
          transform: `translate(-50%, -50%) perspective(500px) ${rotateAxis}(${initialRotation}deg) scale(0.8)`,
        }}
        animate={{
          opacity: 1,
          filter: "blur(0px)",
          transform: `translate(-50%, -50%) perspective(500px) ${rotateAxis}(0deg) scale(1)`,
        }}
        exit={{
          opacity: 0,
          filter: "blur(4px)",
          transform: `translate(-50%, -50%) perspective(500px) ${rotateAxis}(${initialRotation}deg) scale(0.8)`,
        }}
        transition={transition}
        {...props}
      />
    </DialogPrimitive.Content>
  )
}

type DialogCloseProps = React.ComponentProps<typeof DialogPrimitive.Close>

function DialogClose(props: DialogCloseProps) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

type DialogHeaderProps = React.ComponentProps<"div">

function DialogHeader(props: DialogHeaderProps) {
  return <div data-slot="dialog-header" {...props} />
}

type DialogFooterProps = React.ComponentProps<"div">

function DialogFooter(props: DialogFooterProps) {
  return <div data-slot="dialog-footer" {...props} />
}

type DialogTitleProps = React.ComponentProps<typeof DialogPrimitive.Title>

function DialogTitle(props: DialogTitleProps) {
  return <DialogPrimitive.Title data-slot="dialog-title" {...props} />
}

type DialogDescriptionProps = React.ComponentProps<
  typeof DialogPrimitive.Description
>

function DialogDescription(props: DialogDescriptionProps) {
  return (
    <DialogPrimitive.Description data-slot="dialog-description" {...props} />
  )
}

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  useDialog,
  type DialogProps,
  type DialogTriggerProps,
  type DialogPortalProps,
  type DialogCloseProps,
  type DialogOverlayProps,
  type DialogContentProps,
  type DialogHeaderProps,
  type DialogFooterProps,
  type DialogTitleProps,
  type DialogDescriptionProps,
  type DialogContextType,
  type DialogFlipDirection,
}
