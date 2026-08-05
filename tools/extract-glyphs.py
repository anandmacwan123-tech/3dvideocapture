#!/usr/bin/env python3
"""
Extract glyph outlines from the display font into fonts/glyphs.json.

The exporter uses this to convert letters to paths, so an outlined SVG opens
identically anywhere without the font installed.

    pip install fonttools brotli
    python3 tools/extract-glyphs.py

Run it again after replacing the font. It also rebuilds the WOFF2 the page
loads, so the two never drift apart.
"""

import json
from pathlib import Path

from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "fonts" / "HelveticaNowDisplay-Bold.ttf"
WOFF2 = ROOT / "fonts" / "HelveticaNowDisplay-Bold.woff2"
TARGET = ROOT / "fonts" / "glyphs.json"

# printable ASCII, plus the punctuation a layout is likely to reach for
CHARS = [chr(c) for c in range(0x20, 0x7F)] + list(
    "–—‘’“”…•·°×÷€£¥©®™†‡§¶±≠≤≥→←↑↓"
)


def main() -> None:
    font = TTFont(SOURCE)
    cmap = font.getBestCmap()
    glyph_set = font.getGlyphSet()
    hmtx = font["hmtx"]

    glyphs = {}
    for ch in CHARS:
        name = cmap.get(ord(ch))
        if name is None:
            continue
        pen = SVGPathPen(glyph_set)
        glyph_set[name].draw(pen)
        glyphs[ch] = {"d": pen.getCommands(), "aw": hmtx[name][0]}

    os2 = font["OS/2"]
    data = {
        "unitsPerEm": font["head"].unitsPerEm,
        "capHeight": os2.sCapHeight,
        "xHeight": os2.sxHeight,
        "ascender": os2.sTypoAscender,
        "descender": os2.sTypoDescender,
        "glyphs": glyphs,
    }

    TARGET.write_text(json.dumps(data, separators=(",", ":")))
    print(f"{TARGET.relative_to(ROOT)}: {len(glyphs)} glyphs, {TARGET.stat().st_size:,} bytes")

    font.flavor = "woff2"
    font.save(WOFF2)
    print(f"{WOFF2.relative_to(ROOT)}: {WOFF2.stat().st_size:,} bytes")

    print(
        "\ncap height is "
        f"{os2.sCapHeight}/{font['head'].unitsPerEm} = "
        f"{os2.sCapHeight / font['head'].unitsPerEm:.3f} em"
        " — keep CAP_RATIO in js/state.js in step with this."
    )


if __name__ == "__main__":
    main()
