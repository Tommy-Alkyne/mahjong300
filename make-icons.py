#!/usr/bin/env python3
"""从牌面素材生成站点图标（默认 東 = 1z）。

用法:
    /usr/bin/python3 make-icons.py                 # 東
    /usr/bin/python3 make-icons.py --tile 7z       # 换成 中
    /usr/bin/python3 make-icons.py --tile 5z       # 换成 白
可用牌: 0m-9m 0p-9p 0s-9s（0 为赤五） 1z東 2z南 3z西 4z北 5z白 6z发 7z中
"""
import argparse
import os

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.join(HERE, "dist")

ap = argparse.ArgumentParser()
ap.add_argument("--tile", default="1z")
ap.add_argument("--pad", type=float, default=0.02, help="四周留白比例（越小图标越满）")
args = ap.parse_args()

src_path = os.path.join(DIST, "images", "tiles", f"{args.tile}.png")
src = Image.open(src_path).convert("RGBA")
print("源:", src_path, src.size)


def make(size: int) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    inner = round(size * (1 - args.pad * 2))
    w = round(inner * src.width / src.height)
    tile = src.resize((w, inner), Image.LANCZOS)
    canvas.paste(tile, ((size - w) // 2, (size - inner) // 2), tile)
    return canvas


out_dir = os.path.join(DIST, "icons")
os.makedirs(out_dir, exist_ok=True)
for size in (32, 48, 180, 192, 512):
    make(size).save(os.path.join(out_dir, f"icon-{size}.png"), optimize=True)
make(64).save(os.path.join(out_dir, "favicon.ico"), sizes=[(16, 16), (32, 32), (48, 48)])
print("已写出:", ", ".join(sorted(os.listdir(out_dir))))
