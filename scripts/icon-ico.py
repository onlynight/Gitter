# -*- coding: utf-8 -*-
"""Gitter 图标 ICO/预览板组装 — 从 design/icon/png/ 下的 PNG 组装。

PNG 由 scripts/build-icon.mjs（resvg 直接光栅化 design/icon/gitter-icon.svg）生成，
本脚本不做任何几何绘制。用法: python scripts/icon-ico.py
"""
from __future__ import annotations

import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PNG_DIR = os.path.join(ROOT, "design", "icon", "png")


def main() -> None:
    sizes = [1024, 512, 256, 128, 64, 48, 32, 24, 16]
    by_size = {s: Image.open(os.path.join(PNG_DIR, f"gitter-{s}.png")).convert("RGBA") for s in sizes}

    # electron-builder（buildResources=app/build）：icon.ico 自动被 win 打包采用
    ico_sizes = [256, 128, 64, 48, 32, 24, 16]
    by_size[256].save(
        os.path.join(ROOT, "app", "build", "icon.ico"),
        format="ICO",
        append_images=[by_size[s] for s in ico_sizes[1:]],
        sizes=[(s, s) for s in ico_sizes],
    )

    # 预览板：明暗背景 × 多尺寸（视觉验收用）
    sheet = Image.new("RGB", (1440, 560), (250, 250, 250))
    dd = ImageDraw.Draw(sheet)
    dd.rectangle([720, 0, 1440, 560], fill=(24, 26, 31))
    for y0 in (0, 280):
        x = 40
        for size in [256, 64, 48, 32, 24, 16]:
            im = by_size[size]
            sheet.paste(im, (x, y0 + (280 - size) // 2), im)
            # 右半深色区重复贴小尺寸（256 只贴左半，避免拥挤）
            if size < 256:
                sheet.paste(im, (720 + x - 216, y0 + (280 - size) // 2), im)
            x += size + 24
    sheet.save(os.path.join(PNG_DIR, "preview-sheet.png"))
    print("ICO + preview OK")


if __name__ == "__main__":
    main()
