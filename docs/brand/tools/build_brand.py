# /// script
# requires-python = ">=3.11"
# dependencies = ["fonttools==4.66.1"]
# ///
"""Build every OpenTerminal brand asset from source, reproducibly.

    uv run docs/brand/tools/build_brand.py

Requires `resvg` on PATH for the PNG exports (`cargo install resvg --locked`).

The mark is a terminal prompt chevron followed by three rising candlesticks:
"a terminal, for markets". Colours are the app's own (web/app/globals.css):
amber #ff9900, up #00c853, down #ff3d3d, on the #0a0a0a panel colour.

The wordmark is JetBrains Mono ExtraBold converted to outlines, so the SVGs
render identically without the font installed. The font is fetched from the
pinned upstream release and verified by SHA-256 (not vendored). JetBrains Mono
is SIL Open Font License 1.1, which permits using its outlines in a logo.

Outputs: docs/brand/*.svg|png, plus web/app/icon.svg, web/app/apple-icon.png
(Next.js metadata-file conventions) and web/components/LogoMark.tsx.
"""

from __future__ import annotations

import hashlib
import io
import pathlib
import re
import shutil
import subprocess
import sys
import urllib.request
import zipfile

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

BRAND = pathlib.Path(__file__).resolve().parents[1]
REPO = BRAND.parents[1]
FONT_URL = "https://github.com/JetBrains/JetBrainsMono/releases/download/v2.304/JetBrainsMono-2.304.zip"
FONT_SHA256 = "6f6376c6ed2960ea8a963cd7387ec9d76e3f629125bc33d1fdcd7eb7012f7bbf"

# Palette: the app's CSS variables, plus darker tones for light backgrounds.
TILE = "#0A0A0A"  # --panel
EDGE = "#262626"  # tile hairline, so the tile reads on pure-black pages
AMBER = "#FF9900"  # --amber
UP = "#00C853"  # --up
DOWN = "#FF3D3D"  # --down
SNOW = "#F2F2F2"
MUTED = "#9AA0A6"
INK = "#111111"  # wordmark on light backgrounds
AMBER_ON_LIGHT = "#A35C00"
GITHUB_LIGHT_BG = "#FFFFFF"
GITHUB_DARK_BG = "#0D1117"


# ----------------------------------------------------------------- contrast

def _lum(hex_color: str) -> float:
    rgb = [int(hex_color[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    lin = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in rgb]
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]


def contrast(a: str, b: str) -> float:
    la, lb = sorted((_lum(a), _lum(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


# ----------------------------------------------------------------- fonts

def load_fonts() -> dict[str, TTFont]:
    cache = BRAND / "tools" / ".cache" / "JetBrainsMono-2.304.zip"
    if not cache.exists():
        cache.parent.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(FONT_URL, timeout=60) as r:  # noqa: S310 (pinned https URL)
            cache.write_bytes(r.read())
    data = cache.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    if digest != FONT_SHA256:
        cache.unlink()
        sys.exit(f"font archive checksum mismatch: {digest}")
    z = zipfile.ZipFile(io.BytesIO(data))
    return {w: TTFont(io.BytesIO(z.read(f"fonts/ttf/JetBrainsMono-{w}.ttf"))) for w in ("ExtraBold", "Medium")}


def _n(v: float) -> str:
    s = f"{v:.2f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def text_path(font: TTFont, text: str, size: float, x: float, baseline: float, tracking: float = 0.0) -> tuple[str, float]:
    """Outline `text` as an SVG path. Returns (d, advance width)."""
    glyphs, cmap = font.getGlyphSet(), font.getBestCmap()
    scale = size / font["head"].unitsPerEm
    pen = SVGPathPen(glyphs, ntos=_n)
    cursor = x
    for ch in text:
        name = cmap[ord(ch)]
        glyphs[name].draw(TransformPen(pen, (scale, 0, 0, -scale, cursor, baseline)))
        cursor += font["hmtx"][name][0] * scale + tracking
    return pen.getCommands(), cursor - x - tracking


def cap_height(font: TTFont, size: float) -> float:
    return font["OS/2"].sCapHeight * size / font["head"].unitsPerEm


# ----------------------------------------------------------------- the mark

# Candles on the 64 grid: (centre x, wick top, body top, body bottom, wick bottom, colour).
# Up, down, up, with each close higher: a rising market after the prompt.
CANDLES = [
    (33, 34, 38, 48, 52, UP),
    (42.5, 24, 28, 38, 44, DOWN),
    (52, 12, 16, 32, 38, UP),
]


def mark(*, x: float = 0, y: float = 0, size: float = 64, rx: float = 13, edge: bool = True) -> str:
    """Prompt chevron + candlesticks on a dark tile, 64-unit grid."""
    s = size / 64
    # The hairline needs a half-unit inset; the edgeless (apple icon) variant must fill edge to edge.
    parts = [f'<rect x="0.5" y="0.5" width="63" height="63" rx="{_n(rx)}" fill="{TILE}" stroke="{EDGE}"/>' if edge
             else f'<rect width="64" height="64" rx="{_n(rx)}" fill="{TILE}"/>']
    parts.append(f'<path d="M10 20L21 32L10 44" fill="none" stroke="{AMBER}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>')
    for cx, wt, bt, bb, wb, col in CANDLES:
        parts.append(f'<path d="M{_n(cx)} {wt}V{wb}" stroke="{col}" stroke-width="2" stroke-linecap="round"/>')
        parts.append(f'<rect x="{_n(cx - 3.5)}" y="{bt}" width="7" height="{bb - bt}" rx="1" fill="{col}"/>')
    return f'<g transform="translate({_n(x)} {_n(y)}) scale({_n(s)})">{"".join(parts)}</g>'


def favicon16() -> str:
    """Hand-hinted 16 px variant: whole-pixel geometry, 2 candles, no wicks."""
    return (
        f'<rect width="16" height="16" rx="3" fill="{TILE}"/>'
        # chevron as a 2 px-thick pixel staircase: anti-aliased diagonals blur at this size
        f'<path d="M2 4h2v1h1v1h1v1h1v2h-1v1h-1v1h-1v1h-2v-1h1v-1h1v-1h1v-2h-1v-1h-1v-1h-1z" fill="{AMBER}" shape-rendering="crispEdges"/>'
        f'<g shape-rendering="crispEdges"><rect x="8" y="8" width="2" height="5" fill="{DOWN}"/>'
        f'<rect x="12" y="3" width="2" height="8" fill="{UP}"/>'
        f'<rect x="8.5" y="6" width="1" height="9" fill="{DOWN}"/><rect x="12.5" y="2" width="1" height="11" fill="{UP}"/></g>'
    )


def svg(width: float, height: float, body: str, title: str) -> str:
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{_n(width)}" height="{_n(height)}" '
        f'viewBox="0 0 {_n(width)} {_n(height)}" role="img" aria-label="{title}">'
        f"<title>{title}</title>{body}</svg>\n"
    )


def lockup(fonts: dict[str, TTFont], fg: str, accent: str) -> str:
    """Mark + "OpenTerminal" wordmark, 64 high. "Open" in fg, "Terminal" in the accent."""
    eb = fonts["ExtraBold"]
    size, gap, track = 40.0, 16.0, -0.8
    base = 32 + cap_height(eb, size) / 2
    d1, w1 = text_path(eb, "Open", size, 64 + gap, base, track)
    d2, w2 = text_path(eb, "Terminal", size, 64 + gap + w1 + track, base, track)
    width = 64 + gap + w1 + track + w2 + 2
    return svg(width, 64, mark() + f'<path fill="{fg}" d="{d1}"/><path fill="{accent}" d="{d2}"/>', "OpenTerminal")


def social(fonts: dict[str, TTFont]) -> str:
    """1280x640, opaque, full-bleed (GitHub crops it); content inside a 96 px margin."""
    W, H, left = 1280, 640, 96
    eb, md = fonts["ExtraBold"], fonts["Medium"]
    parts = [f'<rect width="{W}" height="{H}" fill="#000000"/>']
    # faint price grid, like the chart panel
    for gy in range(80, H, 80):
        parts.append(f'<path d="M0 {gy}H{W}" stroke="#141414" stroke-width="1"/>')
    parts.append(f'<rect x="0" y="0" width="{W}" height="6" fill="{AMBER}"/>')
    parts.append(mark(x=left, y=104, size=128, rx=13, edge=True))
    wsize = 84
    base = 104 + 64 + cap_height(eb, wsize) / 2
    d1, w1 = text_path(eb, "Open", wsize, left + 160, base, -1.5)
    d2, _ = text_path(eb, "Terminal", wsize, left + 160 + w1 - 1.5, base, -1.5)
    parts.append(f'<path fill="{SNOW}" d="{d1}"/><path fill="{AMBER}" d="{d2}"/>')
    for i, line in enumerate(("A terminal-style market workspace,", "built on free public data.")):
        d, _ = text_path(md, line, 48, left, 350 + i * 64)
        parts.append(f'<path fill="{SNOW}" d="{d}"/>')
    d, _ = text_path(md, "Charts · screener · heatmap · options · crypto · macro · no API keys", 25, left, 480)
    parts.append(f'<path fill="{MUTED}" d="{d}"/>')
    d, _ = text_path(md, "github.com/ErTasselli/OpenTerminal", 24, left, 560)
    parts.append(f'<path fill="{AMBER}" d="{d}"/>')
    return svg(W, H, "".join(parts), "OpenTerminal: a terminal-style market workspace built on free public data")


def apple_icon() -> str:
    """Opaque square, no rounding: iOS applies its own mask and blackens transparency."""
    return svg(64, 64, mark(rx=0, edge=False), "OpenTerminal")


def react_component() -> str:
    """The 16 px mark as an inline React component for the top bar (no public/ dir needed)."""
    body = favicon16().replace('shape-rendering="crispEdges"', 'shapeRendering="crispEdges"')
    body = re.sub(r'stroke-(width|linecap|linejoin)', lambda m: "stroke" + m.group(1).capitalize(), body)
    return (
        "// GENERATED by docs/brand/tools/build_brand.py — edit the script, not this file.\n"
        "export default function LogoMark({ size = 16 }: { size?: number }) {\n"
        "  return (\n"
        f'    <svg width={{size}} height={{size}} viewBox="0 0 16 16" aria-hidden="true" focusable="false">{body}</svg>\n'
        "  );\n"
        "}\n"
    )


# ----------------------------------------------------------------- safety gate

FORBIDDEN = [
    (re.compile(r"<\s*script", re.I), "script element"),
    (re.compile(r"\son[a-z]+\s*=", re.I), "event handler attribute"),
    (re.compile(r"<\s*foreignObject", re.I), "foreignObject"),
    (re.compile(r"(?:xlink:)?href\s*=\s*\"(?!#)", re.I), "external reference"),
    (re.compile(r"url\(\s*['\"]?(?!#)", re.I), "external url()"),
    (re.compile(r"javascript:", re.I), "javascript: URL"),
]


def check_safe(name: str, text: str) -> None:
    for pattern, what in FORBIDDEN:
        if pattern.search(text):
            sys.exit(f"{name}: unsafe SVG content ({what})")


def write(path: pathlib.Path, text: str) -> None:
    check_safe(path.name, text)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8", newline="\n")
    print(f"wrote {path.relative_to(REPO)} ({len(text)} bytes)")


def main() -> None:
    checks = {
        "chevron on tile": contrast(AMBER, TILE),
        "up candle on tile": contrast(UP, TILE),
        "down candle on tile": contrast(DOWN, TILE),
        "tile on GitHub light": contrast(TILE, GITHUB_LIGHT_BG),
        "wordmark ink on light": contrast(INK, GITHUB_LIGHT_BG),
        "wordmark accent on light": contrast(AMBER_ON_LIGHT, GITHUB_LIGHT_BG),
        "wordmark snow on dark": contrast(SNOW, GITHUB_DARK_BG),
        "wordmark accent on dark": contrast(AMBER, GITHUB_DARK_BG),
    }
    for label, ratio in checks.items():
        print(f"contrast {label}: {ratio:.2f}:1")
        if ratio < 3.0:
            sys.exit(f"contrast below WCAG 3:1 for graphics: {label}")

    fonts = load_fonts()
    files = {
        BRAND / "logo-mark.svg": svg(64, 64, mark(), "OpenTerminal"),
        BRAND / "favicon-16.svg": svg(16, 16, favicon16(), "OpenTerminal"),
        BRAND / "apple-touch-icon.svg": apple_icon(),
        BRAND / "logo.svg": lockup(fonts, INK, AMBER_ON_LIGHT),
        BRAND / "logo-dark.svg": lockup(fonts, SNOW, AMBER),
        BRAND / "social-preview.svg": social(fonts),
        REPO / "web" / "app" / "icon.svg": svg(64, 64, mark(), "OpenTerminal"),
    }
    for path, text in files.items():
        write(path, text)
    comp = REPO / "web" / "components" / "LogoMark.tsx"
    comp.write_text(react_component(), encoding="utf-8", newline="\n")
    print(f"wrote {comp.relative_to(REPO)}")

    resvg = shutil.which("resvg")
    if not resvg:
        sys.exit("resvg not found on PATH; install it to export PNGs")
    renders = [
        (BRAND / "favicon-16.svg", BRAND / "favicon-16.png", 16),
        (BRAND / "logo-mark.svg", BRAND / "favicon-32.png", 32),
        (BRAND / "logo-mark.svg", BRAND / "logo-mark-512.png", 512),
        (BRAND / "apple-touch-icon.svg", REPO / "web" / "app" / "apple-icon.png", 180),
        (BRAND / "social-preview.svg", BRAND / "social-preview.png", 1280),
    ]
    for src, dst, width in renders:
        # List-form argv, no shell; every argument is a constant path from this script.
        subprocess.run([resvg, "-w", str(width), str(src), str(dst)], check=True, shell=False)
        print(f"rendered {dst.relative_to(REPO)} ({dst.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
