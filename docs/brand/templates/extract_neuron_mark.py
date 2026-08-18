#!/usr/bin/env python3
"""Extract the neuron-A mark from the attached reference lockup.

The procedural SVG kept redrawing a disc-and-sticks stand-in. This pulls the
actual organic A (soma, feet, tapered synapses) out of the 1024x512 reference
so the template can use that silhouette.
"""
from __future__ import annotations

from pathlib import Path
import math

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent
REF = ROOT / "neuron-a-reference.png"
OUT_PNG = ROOT / "neuron-a-mark.png"
OUT_CROP = ROOT / "previews" / "neuron-a-mark-crop.png"

# Pills live in the footer; the subtitle is a teal text band under the lockup.
PILL_Y = 380
SUBTITLE = (250, 336, 770, 378)

# Soma / face in the attached lockup (measured from the raster).
SOMA_CX, SOMA_CY = 470, 227
SOMA_R = 70


def is_black(r: int, g: int, b: int) -> bool:
    return max(r, g, b) < 52


def is_white(r: int, g: int, b: int) -> bool:
    return r > 218 and g > 218 and b > 218


def is_neuron(r: int, g: int, b: int) -> bool:
    if is_black(r, g, b) or is_white(r, g, b):
        return False
    chroma = max(r, g, b) - min(r, g, b)
    return chroma >= 16 and max(r, g, b) >= 64


def in_rect(x: int, y: int, rect: tuple[int, int, int, int]) -> bool:
    x0, y0, x1, y1 = rect
    return x0 <= x < x1 and y0 <= y < y1


def in_soma(x: int, y: int) -> bool:
    return (x - SOMA_CX) ** 2 + (y - SOMA_CY) ** 2 <= SOMA_R * SOMA_R


# Opaque face so eyes and smile stay dark on the teal soma in both modes.
FACE = (17, 17, 17, 255)
# Clean drawn face, in the 1024x512 reference space.
LEFT_EYE = (449.5, 215.0)
RIGHT_EYE = (483.0, 215.0)
EYE_R = 8.2
SMILE_BOX = (441.0, 222.0, 491.0, 248.0)
SMILE_WIDTH = 5.2
FACE_HOLE = (418, 188, 528, 258)


def sample_soma_teal(dst, teal: set[tuple[int, int]]) -> tuple[int, int, int, int]:
    """Bright soma fill — ignore the dark hashed remnants inside the old face hole."""
    counts: dict[tuple[int, int, int, int], int] = {}
    for (x, y) in teal:
        if in_rect(x, y, FACE_HOLE) or not in_soma(x, y):
            continue
        colour = dst[x, y]
        r, g, _b, _a = colour
        if g < 140 or r > 80:
            continue
        counts[colour] = counts.get(colour, 0) + 1
    if counts:
        return max(counts, key=counts.get)
    return (1, 166, 160, 255)


def close_face_hole(dst, teal: set[tuple[int, int]]) -> None:
    """Paint the face interior one solid soma colour, overwriting hashed leftovers."""
    soma_teal = sample_soma_teal(dst, teal)
    x0, y0, x1, y1 = FACE_HOLE
    for y in range(y0, y1):
        xs = [x for x in range(x0, x1) if (x, y) in teal]
        if len(xs) < 2:
            continue
        for x in range(min(xs) + 1, max(xs)):
            dst[x, y] = soma_teal


def fill_a_counter(mark: Image.Image) -> None:
    """Fill the letter-A hole under the smile so it does not read as a black chin."""
    px = mark.load()
    w, h = mark.size
    soma_teal = (1, 166, 160, 255)
    x0, y0, x1, y1 = 405, 258, 538, 308
    seed = (466, 272)
    _r, _g, _b, a = px[seed]
    if a >= 40:
        return
    stack = [seed]
    seen: set[tuple[int, int]] = set()
    while stack:
        x, y = stack.pop()
        if (x, y) in seen:
            continue
        if not (x0 <= x < x1 and y0 <= y < y1):
            continue
        if not (0 <= x < w and 0 <= y < h):
            continue
        _r, _g, _b, alpha = px[x, y]
        if alpha >= 40:
            continue
        seen.add((x, y))
        px[x, y] = soma_teal
        stack.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))


def close_soma_seams(mark: Image.Image) -> None:
    """Fill pinholes and short slashes inside the soma so dendrites cannot show through."""
    px = mark.load()
    soma_teal = (1, 166, 160, 255)
    # Keep apical dendrite crotches open; close body notches.
    regions = (
        (168, 308, 400, 555, 20),
        (150, 168, 410, 530, 8),
    )
    for y0, y1, x0, x1, max_gap in regions:
        for y in range(y0, y1):
            teal_xs = [
                x for x in range(x0, x1) if is_teal_px(px[x, y])
            ]
            if len(teal_xs) < 2:
                continue
            prev = teal_xs[0]
            for x in teal_xs[1:]:
                gap = x - prev
                if 2 <= gap <= max_gap:
                    for gx in range(prev + 1, x):
                        px[gx, y] = soma_teal
                prev = x
    # Flatten hashed leftover colours inside the body, not on the silhouette.
    for y in range(170, 300):
        for x in range(410, 540):
            r, g, b, a = px[x, y]
            if a < 80 or r > g + 15:
                continue
            if r == 1 and g == 166:
                continue
            neighbours = 0
            for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                nr, ng, nb, na = px[x + dx, y + dy]
                if na >= 80 and ng > nr + 15:
                    neighbours += 1
            if neighbours >= 3:
                px[x, y] = soma_teal


def is_teal_px(pixel: tuple[int, int, int, int]) -> bool:
    r, g, b, a = pixel
    return a >= 80 and g > r + 15 and g > b


def is_coral_px(pixel: tuple[int, int, int, int]) -> bool:
    r, g, b, a = pixel
    return a >= 80 and r > g + 15 and r > b


SOMA_TEAL = (1, 166, 160, 255)
CORAL = (214, 108, 100, 255)


def snap_to_palette(mark: Image.Image) -> None:
    """Drop muddy anti-alias and posterise to two logo colours — kills the smudges."""
    px = mark.load()
    w, h = mark.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 40:
                continue
            brightest = max(r, g, b)
            chroma = brightest - min(r, g, b)
            if brightest < 90 or chroma < 20:
                px[x, y] = (0, 0, 0, 0)
                continue
            if g >= r:
                px[x, y] = SOMA_TEAL
            else:
                px[x, y] = CORAL


def complete_near_transitions(mark: Image.Image) -> Image.Image:
    """The letter T cuts one continuous teal→coral synapse. Rejoin only that band."""
    px = mark.load()
    y0, y1, x0, x1 = 144, 152, 515, 565
    max_gap = 24
    for y in range(y0, y1):
        teal_xs = [x for x in range(x0, x1) if is_teal_px(px[x, y])]
        coral_xs = [x for x in range(x0, x1) if is_coral_px(px[x, y])]
        if not teal_xs or not coral_xs:
            continue
        t_right = max(teal_xs)
        corals_after = [c for c in coral_xs if c > t_right]
        if not corals_after:
            continue
        c_left = min(corals_after)
        gap = c_left - t_right
        if not (2 <= gap <= max_gap):
            continue
        mid = (t_right + c_left) / 2
        for x in range(t_right + 1, c_left):
            px[x, y] = SOMA_TEAL if x < mid else CORAL
    return mark


def fill_small_holes(mark: Image.Image, pred, fill, max_gap: int) -> None:
    """Close pinholes inside a colour, not crotches between dendrites."""
    px = mark.load()
    w, h = mark.size
    for y in range(h):
        xs = [x for x in range(w) if pred(px[x, y])]
        if len(xs) < 2:
            continue
        prev = xs[0]
        for x in xs[1:]:
            gap = x - prev
            if 2 <= gap <= max_gap:
                for gx in range(prev + 1, x):
                    px[gx, y] = fill
            prev = x
    for x in range(w):
        ys = [y for y in range(h) if pred(px[x, y])]
        if len(ys) < 2:
            continue
        prev = ys[0]
        for y in ys[1:]:
            gap = y - prev
            if 2 <= gap <= min(max_gap, 3):
                for gy in range(prev + 1, y):
                    px[x, gy] = fill
            prev = y


def close_hairlines(mark: Image.Image, passes: int = 3) -> None:
    """Fill 1px cracks where a pixel is boxed in by the same colour."""
    px = mark.load()
    w, h = mark.size
    for _ in range(passes):
        fills: list[tuple[int, int, tuple[int, int, int, int]]] = []
        for y in range(1, h - 1):
            for x in range(1, w - 1):
                if px[x, y][3] >= 40:
                    continue
                teal_n = 0
                coral_n = 0
                for dy in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        if dx == 0 and dy == 0:
                            continue
                        p = px[x + dx, y + dy]
                        if is_teal_px(p):
                            teal_n += 1
                        elif is_coral_px(p):
                            coral_n += 1
                if teal_n >= 4 and coral_n == 0:
                    fills.append((x, y, SOMA_TEAL))
                elif coral_n >= 4 and teal_n == 0:
                    fills.append((x, y, CORAL))
                elif teal_n >= 2 and coral_n >= 2:
                    fills.append(
                        (x, y, SOMA_TEAL if teal_n >= coral_n else CORAL),
                    )
                else:
                    left, right = px[x - 1, y], px[x + 1, y]
                    up, down = px[x, y - 1], px[x, y + 1]
                    pair = (
                        (is_teal_px(left) and is_coral_px(right))
                        or (is_coral_px(left) and is_teal_px(right))
                        or (is_teal_px(up) and is_coral_px(down))
                        or (is_coral_px(up) and is_teal_px(down))
                    )
                    if pair:
                        fills.append((x, y, SOMA_TEAL))
        if not fills:
            break
        for x, y, colour in fills:
            px[x, y] = colour


def seal_colour_seams(mark: Image.Image) -> None:
    """Fill 1–2px black slivers where teal already meets coral."""
    px = mark.load()
    w, h = mark.size
    fills: list[tuple[int, int, tuple[int, int, int, int]]] = []
    for y in range(2, h - 2):
        for x in range(2, w - 2):
            if px[x, y][3] >= 40:
                continue
            near_t = False
            near_c = False
            best_t = 99.0
            best_c = 99.0
            for dy in range(-2, 3):
                for dx in range(-2, 3):
                    p = px[x + dx, y + dy]
                    dist = max(abs(dx), abs(dy))
                    if is_teal_px(p):
                        near_t = True
                        best_t = min(best_t, dist)
                    elif is_coral_px(p):
                        near_c = True
                        best_c = min(best_c, dist)
            if near_t and near_c:
                fills.append(
                    (x, y, SOMA_TEAL if best_t <= best_c else CORAL),
                )
    for x, y, colour in fills:
        px[x, y] = colour


def extend_thin_tips(mark: Image.Image) -> None:
    """Nudge a thin teal tip until it touches a nearby coral bulb — one row only."""
    px = mark.load()
    w, h = mark.size
    for y in range(h):
        teal_xs = [x for x in range(w) if is_teal_px(px[x, y])]
        coral_xs = [x for x in range(w) if is_coral_px(px[x, y])]
        if not teal_xs or not coral_xs:
            continue
        t_right = max(teal_xs)
        corals_after = [c for c in coral_xs if c > t_right]
        if not corals_after:
            continue
        c_left = min(corals_after)
        gap = c_left - t_right
        t_w = 1
        while t_right - t_w >= 0 and is_teal_px(px[t_right - t_w, y]):
            t_w += 1
        c_w = 1
        while c_left + c_w < w and is_coral_px(px[c_left + c_w, y]):
            c_w += 1
        if min(t_w, c_w) > 5 or not (3 <= gap <= 18):
            continue
        for x in range(t_right + 1, c_left):
            px[x, y] = SOMA_TEAL


def remove_face_specks(mark: Image.Image, min_size: int = 14) -> None:
    """Drop stray black pixels that are not part of the eyes or smile."""
    px = mark.load()
    w, h = mark.size
    seen: set[tuple[int, int]] = set()
    for y in range(h):
        for x in range(w):
            if (x, y) in seen or not is_face_px(px[x, y]):
                continue
            stack = [(x, y)]
            blob: list[tuple[int, int]] = []
            while stack:
                cx, cy = stack.pop()
                if (cx, cy) in seen:
                    continue
                if not (0 <= cx < w and 0 <= cy < h):
                    continue
                if not is_face_px(px[cx, cy]):
                    continue
                seen.add((cx, cy))
                blob.append((cx, cy))
                stack.extend((
                    (cx + 1, cy),
                    (cx - 1, cy),
                    (cx, cy + 1),
                    (cx, cy - 1),
                ))
            if len(blob) < min_size:
                for bx, by in blob:
                    px[bx, by] = SOMA_TEAL


def is_face_px(pixel: tuple[int, int, int, int]) -> bool:
    r, g, b, a = pixel
    return a >= 80 and r < 40 and g < 40 and b < 40


def draw_clean_face(mark: Image.Image) -> Image.Image:
    """Solid black discs and a clean smile — no disc, no raster speckles."""
    scale = 4
    w, h = mark.size
    overlay = Image.new("RGBA", (w * scale, h * scale), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    def s(value: float) -> float:
        return value * scale

    for cx, cy in (LEFT_EYE, RIGHT_EYE):
        r = EYE_R * scale
        draw.ellipse(
            [s(cx) - r, s(cy) - r, s(cx) + r, s(cy) + r],
            fill=FACE,
        )
    # Bigger, lower connected U with round caps so the tips are not specks.
    cx, cy, radius = 466.0, 236.0, 24.0
    width = max(1, round(SMILE_WIDTH * scale))
    draw.arc(
        [s(cx - radius), s(cy - radius), s(cx + radius), s(cy + radius)],
        start=30,
        end=150,
        fill=FACE,
        width=width,
    )
    cap_r = width / 2
    for ang in (30, 150):
        rad = math.radians(ang)
        ex = s(cx + radius * math.cos(rad))
        ey = s(cy + radius * math.sin(rad))
        draw.ellipse(
            [ex - cap_r, ey - cap_r, ex + cap_r, ey + cap_r],
            fill=FACE,
        )
    overlay = overlay.resize((w, h), Image.Resampling.BOX)
    px = overlay.load()
    ow, oh = overlay.size
    for y in range(oh):
        for x in range(ow):
            r, g, b, a = px[x, y]
            if a >= 128:
                px[x, y] = FACE
            else:
                px[x, y] = (0, 0, 0, 0)
    return Image.alpha_composite(mark, overlay)


def extract(im: Image.Image) -> Image.Image:
    w, h = im.size
    src = im.load()
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    dst = out.load()
    teal: set[tuple[int, int]] = set()

    for y in range(h):
        for x in range(w):
            r, g, b, _a = src[x, y]
            if y >= PILL_Y or in_rect(x, y, SUBTITLE):
                continue
            if is_neuron(r, g, b):
                dst[x, y] = (r, g, b, 255)
                teal.add((x, y))

    close_face_hole(dst, teal)
    fill_a_counter(out)
    close_soma_seams(out)
    snap_to_palette(out)
    complete_near_transitions(out)
    fill_small_holes(out, is_coral_px, CORAL, 10)
    fill_small_holes(out, is_teal_px, SOMA_TEAL, 6)
    extend_thin_tips(out)
    seal_colour_seams(out)
    close_hairlines(out)
    faced = draw_clean_face(out)
    remove_face_specks(faced)
    return faced


def main() -> None:
    if not REF.exists():
        raise SystemExit(f"missing reference: {REF}")
    im = Image.open(REF).convert("RGBA")
    mark = extract(im)
    mark.save(OUT_PNG)
    ROOT.joinpath("previews").mkdir(exist_ok=True)
    mark.crop((140, 40, 860, 360)).save(OUT_CROP)
    bbox = mark.getbbox()
    print(f"wrote {OUT_PNG} bbox={bbox} size={mark.size}")


if __name__ == "__main__":
    main()
