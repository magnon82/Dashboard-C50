"""Rasterize / recolor logo_C50.pdf into Suite brand assets."""
from __future__ import annotations

import re
from pathlib import Path

import fitz
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
BRAND = ROOT / "public" / "brand"
PDF = BRAND / "logo_C50.pdf"

NAVY = "#1B2A4A"
LIGHT = "#EEF2F8"


def raster_masters() -> tuple[Image.Image, Image.Image]:
    doc = fitz.open(PDF)
    page = doc[0]
    art = page.artbox
    pix = page.get_pixmap(matrix=fitz.Matrix(4, 4), alpha=True, clip=art)
    raw_path = BRAND / "logo_C50_raw.png"
    pix.save(raw_path.as_posix())
    src = Image.open(raw_path).convert("RGBA")
    px = src.load()
    w, h = src.size
    minx, miny, maxx, maxy = w, h, -1, -1
    for y in range(h):
        for x in range(w):
            if px[x, y][3] > 10:
                minx = min(minx, x)
                miny = min(miny, y)
                maxx = max(maxx, x)
                maxy = max(maxy, y)
    pad = 16
    cropped = src.crop(
        (
            max(0, minx - pad),
            max(0, miny - pad),
            min(w, maxx + 1 + pad),
            min(h, maxy + 1 + pad),
        )
    )
    return recolor_alpha(cropped, (0x1B, 0x2A, 0x4A)), recolor_alpha(
        cropped, (0xEE, 0xF2, 0xF8)
    )


def recolor_alpha(img: Image.Image, rgb: tuple[int, int, int]) -> Image.Image:
    out = Image.new("RGBA", img.size)
    sp = img.load()
    op = out.load()
    tr, tg, tb = rgb
    for y in range(img.height):
        for x in range(img.width):
            a = sp[x, y][3]
            if a < 2:
                op[x, y] = (0, 0, 0, 0)
            else:
                op[x, y] = (tr, tg, tb, min(255, int(a * 1.08)))
    return out


def save_widths(img: Image.Image, stem: str, widths: list[int]) -> None:
    for width in widths:
        nh = max(1, int(round(img.height * width / img.width)))
        # Composite onto transparent via box downsample to avoid LANCZOS fringe
        r = img.resize((width, nh), Image.Resampling.BOX if img.width / width > 2 else Image.Resampling.LANCZOS)
        r.save(BRAND / f"{stem}-{width}.png", "PNG", optimize=True)
        r.save(BRAND / f"{stem}-{width}.webp", "WEBP", quality=92, method=6)


def write_svgs() -> None:
    doc = fitz.open(PDF)
    page = doc[0]
    svg = page.get_svg_image(matrix=fitz.Matrix(1, 1))
    (BRAND / "logo_C50_raw.svg").write_text(svg, encoding="utf-8")

    # Collect fill/stroke tokens for diagnostics
    fills = set(re.findall(r'fill="([^"]+)"', svg))
    strokes = set(re.findall(r'stroke="([^"]+)"', svg))
    print("svg fills", fills)
    print("svg strokes", strokes)

    def tint(color: str) -> str:
        # Replace near-black / gray fills with Suite color; drop black page rects if any
        out = svg
        # Common MuPDF dark fills
        for old in sorted(fills | strokes, key=len, reverse=True):
            if old in ("none", "transparent"):
                continue
            # Keep url(#...) as-is
            if old.startswith("url("):
                continue
            out = out.replace(f'fill="{old}"', f'fill="{color}"')
            out = out.replace(f'stroke="{old}"', f'stroke="{color}"')
        # Also style="" color: #xxxxxx
        out = re.sub(
            r"(fill|stroke):\s*#0{3,6}\b",
            rf"\1:{color}",
            out,
            flags=re.I,
        )
        out = re.sub(
            r"(fill|stroke):\s*rgb\(\s*0\s*,\s*0\s*,\s*0\s*\)",
            rf"\1:{color}",
            out,
            flags=re.I,
        )
        # Ensure root has no background
        if "style=" not in out[:200]:
            out = out.replace(
                "<svg ",
                '<svg role="img" aria-label="Carranza 50" ',
                1,
            )
        return out

    (BRAND / "logo-c50.svg").write_text(tint(NAVY), encoding="utf-8")
    (BRAND / "logo-c50-on-dark.svg").write_text(tint(LIGHT), encoding="utf-8")
    print("wrote SVGs")


def main() -> None:
    BRAND.mkdir(parents=True, exist_ok=True)
    navy, light = raster_masters()
    navy.save(BRAND / "logo-c50.png", "PNG", optimize=True)
    light.save(BRAND / "logo-c50-on-dark.png", "PNG", optimize=True)
    save_widths(navy, "logo-c50", [640, 480, 320, 240])
    save_widths(light, "logo-c50-on-dark", [640, 480, 320, 240])
    write_svgs()
    print("done")


if __name__ == "__main__":
    main()
