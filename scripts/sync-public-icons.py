#!/usr/bin/env python3
"""从 Newt-assets/logo.png 同步 Web public 图标；不覆盖 tauri 生成的多尺寸 icon.ico。"""
from __future__ import annotations

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
LOGO = ROOT.parent / "Newt-assets" / "logo.png"
PUB = ROOT / "public"


def fit(im: Image.Image, size: int) -> Image.Image:
    return im.resize((size, size), Image.Resampling.LANCZOS)


def save_png(im: Image.Image, path: Path, size: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fit(im, size).save(path, format="PNG", optimize=True)
    print("PNG", path, size)


def save_ico_multi(
    im: Image.Image,
    path: Path,
    sizes: tuple[int, ...] = (16, 24, 32, 48, 64, 128, 256),
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    imgs = [fit(im, s) for s in sizes]
    # Use largest as primary; append smaller sizes for multi-resolution ICO
    primary = imgs[-1]
    primary.save(
        path,
        format="ICO",
        sizes=[(s, s) for s in sizes],
        append_images=imgs[:-1],
    )
    print("ICO", path, path.stat().st_size, "sizes", sizes)


def main() -> None:
    src = Image.open(LOGO).convert("RGBA")
    print("source", LOGO, src.size)

    save_png(src, PUB / "favicon.png", 32)
    save_png(src, PUB / "apple-touch-icon.png", 180)
    save_png(src, PUB / "logo.png", 512)
    save_png(src, PUB / "icon-192.png", 192)
    save_png(src, PUB / "icon-512.png", 512)
    save_png(src, PUB / "app-icon.png", 512)
    save_ico_multi(src, PUB / "favicon.ico")

    # Only rebuild tauri icon.ico if missing or too small (broken single 16x16)
    ico = ROOT / "src-tauri" / "icons" / "icon.ico"
    if not ico.exists() or ico.stat().st_size < 5000:
        save_ico_multi(src, ico)
        print("rebuilt tauri icon.ico")
    else:
        print("keep tauri icon.ico", ico.stat().st_size)

    # 同步品牌字标 SVG（侧栏 / 登录页使用）
    svg_src = LOGO.parent / "icon.svg"
    svg_dst = PUB / "icon.svg"
    if svg_src.is_file():
        svg_dst.write_bytes(svg_src.read_bytes())
        print("SVG", svg_dst)

    print("done")


if __name__ == "__main__":
    main()
