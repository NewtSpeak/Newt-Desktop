// 贴图库路由：/stickers（与 /?tab=stickers 等价，兼容书签）。

import { useEffect } from "react"
import { useNavigate, useSearchParams } from "react-router"

import { CreateStickerPackView } from "~/components/create-sticker-pack-view"
import { ManageStickerPacksView } from "~/components/manage-sticker-packs-view"
import { StickerLibraryView } from "~/components/sticker-library-view"
import {
  STICKERS_CREATE_PATH,
  STICKERS_MANAGE_PATH,
  STICKERS_PATH,
} from "~/lib/stickers-route"

/** 规范化到首页 tab，避免后注册路由未热更新而 404 */
export default function StickersRoute() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const view = searchParams.get("view")

  useEffect(() => {
    if (view === "create") {
      navigate(STICKERS_CREATE_PATH, { replace: true })
      return
    }
    if (view === "manage") {
      navigate(STICKERS_MANAGE_PATH, { replace: true })
      return
    }
    navigate(STICKERS_PATH, { replace: true })
  }, [navigate, view])

  if (view === "create") return <CreateStickerPackView />
  if (view === "manage") return <ManageStickerPacksView />
  return <StickerLibraryView />
}
