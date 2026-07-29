// GSAP 统一封装：全局动效节奏 token 与 reduced-motion 媒体条件。
// 与管理后台 Newt-Server/frontend/app/lib/gsap.ts 保持一致，新动效代码一律从此导入。

import gsap from "gsap"
import { useGSAP } from "@gsap/react"

gsap.registerPlugin(useGSAP)

/** 全局动效节奏（统一 duration/easing tokens） */
export const MOTION = {
  enter: 0.32,
  exit: 0.2,
  stagger: 0.05,
  ease: "power3.out",
  easeIn: "power2.in",
} as const

/** 尊重 prefers-reduced-motion 的媒体条件（配合 gsap.matchMedia 使用） */
export const MOTION_OK = "(prefers-reduced-motion: no-preference)"

export { gsap, useGSAP }
