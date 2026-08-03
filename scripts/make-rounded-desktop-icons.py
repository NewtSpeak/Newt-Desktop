#!/usr/bin/env python3
"""从 Newt-assets/logo.png 生成带圆角的桌面端图标源图，并写出各尺寸 PNG / ICO。

圆角比例默认 22%（接近现代桌面/移动应用图标观感）。
透明圆角区域在 Windows 任务栏 / 快捷方式上会正确透出。
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
LOGO = ROOT.parent / "Newt-assets" / "logo.png"
ICONS = ROOT / "src-tauri" / "icons"
PUB = ROOT / "public"
# 中间产物：圆角源图（供 tauri icon 使用）
ROUNDED_SRC = ROOT / "src-tauri" / "icons" / "app-icon-rounded-source.png"

# 圆角半径 = 边长 * ratio（约 iOS / 现代 Win 图标观感）
CORNER_RATIO = 0.22


def fit_square(im: Image.Image, size: int) -> Image.Image:
    return im.resize((size, size), Image.Resampling.LANCZOS)


def apply_rounded_corners(im: Image.Image, ratio: float = CORNER_RATIO) -> Image.Image:
    """抗锯齿圆角：高分辨率 mask 再缩回，边缘更顺滑。"""
    im = im.convert("RGBA")
    w, h = im.size
    radius = max(1, int(min(w, h) * ratio))

    scale = 4
    mw, mh = w * scale, h * scale
    mask_hi = Image.new("L", (mw, mh), 0)
    draw = ImageDraw.Draw(mask_hi)
    # 右下角用 size-1 在部分 Pillow 版本会少一像素；用完整矩形更稳
    draw.rounded_rectangle((0, 0, mw - 1, mh - 1), radius=radius * scale, fill=255)
    mask = mask_hi.resize((w, h), Image.Resampling.LANCZOS)

    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    out.paste(im, mask=mask)
    return out


def save_png(im: Image.Image, path: Path, size: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fit_square(im, size).save(path, format="PNG", optimize=True)
    print("PNG", path.name, size)


def save_ico_multi(
    im: Image.Image,
    path: Path,
    sizes: tuple[int, ...] = (16, 24, 32, 48, 64, 128, 256),
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    imgs = [fit_square(im, s) for s in sizes]
    primary = imgs[-1]
    primary.save(
        path,
        format="ICO",
        sizes=[(s, s) for s in sizes],
        append_images=imgs[:-1],
    )
    print("ICO", path.name, path.stat().st_size)


def main() -> int:
    if not LOGO.is_file():
        print("missing logo:", LOGO, file=sys.stderr)
        return 1

    src = Image.open(LOGO).convert("RGBA")
    print("source", LOGO, src.size)

    # 以 1024 源做圆角，再导出；保持清晰
    base = fit_square(src, 1024)
    rounded = apply_rounded_corners(base, CORNER_RATIO)
    ROUNDED_SRC.parent.mkdir(parents=True, exist_ok=True)
    rounded.save(ROUNDED_SRC, format="PNG", optimize=True)
    print("rounded source", ROUNDED_SRC, rounded.size, "ratio", CORNER_RATIO)

    # 桌面 Tauri PNG 尺寸（ico/icns 优先走 tauri icon）
    save_png(rounded, ICONS / "icon.png", 512)
    save_png(rounded, ICONS / "32x32.png", 32)
    save_png(rounded, ICONS / "64x64.png", 64)
    save_png(rounded, ICONS / "128x128.png", 128)
    save_png(rounded, ICONS / "128x128@2x.png", 256)
    save_ico_multi(rounded, ICONS / "icon.ico")

    # Windows Store tile logos
    for name, size in [
        ("Square30x30Logo.png", 30),
        ("Square44x44Logo.png", 44),
        ("Square71x71Logo.png", 71),
        ("Square89x89Logo.png", 89),
        ("Square107x107Logo.png", 107),
        ("Square142x142Logo.png", 142),
        ("Square150x150Logo.png", 150),
        ("Square284x284Logo.png", 284),
        ("Square310x310Logo.png", 310),
        ("StoreLogo.png", 50),
    ]:
        save_png(rounded, ICONS / name, size)

    # Web / 安装包相关 public 图标（桌面外观一致）
    save_png(rounded, PUB / "app-icon.png", 512)
    save_png(rounded, PUB / "logo.png", 512)
    save_png(rounded, PUB / "icon-192.png", 192)
    save_png(rounded, PUB / "icon-512.png", 512)
    save_png(rounded, PUB / "favicon.png", 32)
    save_png(rounded, PUB / "apple-touch-icon.png", 180)
    save_ico_multi(rounded, PUB / "favicon.ico")

    # 用圆角源再跑 tauri icon，生成正确的 .icns / 多端尺寸（含 iOS）
    # Android 自适应图标本身会被系统裁圆角，这里仍用圆角源保持一致
    print("running: bunx tauri icon", ROUNDED_SRC)
    r = subprocess.run(
        ["bunx", "tauri", "icon", str(ROUNDED_SRC), "--ios-color", "#F95F9A"],
        cwd=ROOT,
        check=False,
    )
    if r.returncode != 0:
        print("warn: tauri icon failed, kept manually written PNG/ICO", file=sys.stderr)
    else:
        # tauri icon 会用源图再切；源图已圆角，输出自然带圆角
        # 再强制写回我们控制的桌面关键 PNG/ICO，避免 tauri 对透明边处理差异
        save_png(rounded, ICONS / "icon.png", 512)
        save_png(rounded, ICONS / "32x32.png", 32)
        save_png(rounded, ICONS / "64x64.png", 64)
        save_png(rounded, ICONS / "128x128.png", 128)
        save_png(rounded, ICONS / "128x128@2x.png", 256)
        save_ico_multi(rounded, ICONS / "icon.ico")
        save_png(rounded, PUB / "app-icon.png", 512)
        save_png(rounded, PUB / "logo.png", 512)
        save_png(rounded, PUB / "icon-192.png", 192)
        save_png(rounded, PUB / "icon-512.png", 512)
        save_png(rounded, PUB / "favicon.png", 32)
        save_png(rounded, PUB / "apple-touch-icon.png", 180)
        save_ico_multi(rounded, PUB / "favicon.ico")

    # 校验四角透明
    check = Image.open(ICONS / "icon.png").convert("RGBA")
    for p in [(0, 0), (check.size[0] - 1, 0), (0, check.size[1] - 1)]:
        print("corner", p, check.getpixel(p))

    print("done")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
