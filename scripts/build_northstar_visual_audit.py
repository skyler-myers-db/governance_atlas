#!/usr/bin/env python3
"""Build side-by-side North Star visual audit artifacts.

This script is evidence generation only. It does not sign off visual parity.
Rows remain blocked unless the page ledger cites these current artifacts and
records zero must-fix visual gaps after reviewer inspection.
"""

from __future__ import annotations

import argparse
import json
import math
import statistics
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from PIL import Image, ImageChops, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_WIDE_DIR = "docs/northstar_visual_qa/live-runtime-current-v100-wide-finance-shell-2026-05-03"
DEFAULT_SCROLL_DIR = "docs/northstar_visual_qa/live-runtime-current-v101-wide-scroll-finance-shell-2026-05-03"
DEFAULT_SELECTED_DIR = "docs/northstar_visual_qa/live-runtime-current-v102-discover-selected-finance-shell-2026-05-03"
DEFAULT_OUT_DIR = "docs/northstar_visual_qa/live-runtime-current-v104-reference-current-finance-shell-audit-2026-05-03"

PALETTE_BOXES = {
    "left_rail": (20, 444, 190, 564),
    "topbar": (1062, 12, 1974, 48),
    "main_upper": (546, 152, 1670, 304),
    "main_lower": (546, 862, 1670, 1065),
    "right_rail": (2490, 317, 2976, 697),
}


def rel(path: Path) -> str:
    try:
        return path.resolve().relative_to(ROOT).as_posix()
    except ValueError:
        return path.as_posix()


def image_path(value: str) -> Path:
    path = Path(value)
    return path if path.is_absolute() else ROOT / path


def rgb_tuple(pixel: Any) -> tuple[int, int, int]:
    if isinstance(pixel, int):
        return (pixel, pixel, pixel)
    return tuple(int(channel) for channel in pixel[:3])


def median_rgb(image: Image.Image, box: tuple[int, int, int, int]) -> str:
    width, height = image.size
    left, top, right, bottom = box
    left = max(0, min(left, width))
    top = max(0, min(top, height))
    right = max(left + 1, min(right, width))
    bottom = max(top + 1, min(bottom, height))
    crop = image.crop((left, top, right, bottom)).convert("RGB")
    pixels = list(crop.getdata())
    medians = [
        int(round(statistics.median(pixel[channel] for pixel in pixels)))
        for channel in range(3)
    ]
    return "#{:02x}{:02x}{:02x}".format(*medians)


def hex_to_rgb(value: str) -> tuple[int, int, int]:
    raw = value.removeprefix("#")
    return int(raw[0:2], 16), int(raw[2:4], 16), int(raw[4:6], 16)


def color_delta(left: str, right: str) -> float:
    a = hex_to_rgb(left)
    b = hex_to_rgb(right)
    return round(math.sqrt(sum((a[index] - b[index]) ** 2 for index in range(3))), 2)


def compute_diff(
    reference: Image.Image,
    current: Image.Image,
    *,
    threshold: int,
) -> tuple[dict[str, Any], Image.Image]:
    ref = reference.convert("RGB")
    cur = current.convert("RGB")
    width = min(ref.width, cur.width)
    height = min(ref.height, cur.height)
    ref_crop = ref.crop((0, 0, width, height))
    cur_crop = cur.crop((0, 0, width, height))
    diff = ImageChops.difference(ref_crop, cur_crop)

    total_abs = 0
    total_sq = 0
    changed = 0
    bbox_left = width
    bbox_top = height
    bbox_right = 0
    bbox_bottom = 0
    diff_pixels = []
    for y in range(height):
        row = []
        for x in range(width):
            channels = rgb_tuple(diff.getpixel((x, y)))
            channel_abs = sum(channels) / 3
            total_abs += channel_abs
            total_sq += sum(channel * channel for channel in channels) / 3
            is_changed = max(channels) > threshold
            if is_changed:
                changed += 1
                bbox_left = min(bbox_left, x)
                bbox_top = min(bbox_top, y)
                bbox_right = max(bbox_right, x + 1)
                bbox_bottom = max(bbox_bottom, y + 1)
            row.append((255, 48, 48) if is_changed else (18, 24, 32))
        diff_pixels.extend(row)

    diff_image = Image.new("RGB", (width, height))
    diff_image.putdata(diff_pixels)
    if changed:
        ImageDraw.Draw(diff_image).rectangle(
            (bbox_left, bbox_top, bbox_right - 1, bbox_bottom - 1),
            outline=(255, 220, 0),
            width=4,
        )
        bbox: list[int] | None = [bbox_left, bbox_top, bbox_right - bbox_left, bbox_bottom - bbox_top]
    else:
        bbox = None

    pixel_count = width * height
    metrics = {
        "commonCrop": [width, height],
        "diffBbox": bbox,
        "meanAbsDiff": round(total_abs / pixel_count, 2),
        "rmsDiff": round(math.sqrt(total_sq / pixel_count), 2),
        "changedPixelPctThreshold8": round((changed / pixel_count) * 100, 2),
    }
    return metrics, diff_image


def build_side_by_side(reference: Image.Image, current: Image.Image, key: str) -> Image.Image:
    ref = reference.convert("RGB")
    cur = current.convert("RGB")
    header_h = 56
    gap = 20
    width = ref.width + cur.width + gap
    height = max(ref.height, cur.height) + header_h
    canvas = Image.new("RGB", (width, height), (10, 17, 28))
    draw = ImageDraw.Draw(canvas)
    draw.text((20, 18), f"{key} reference", fill=(235, 241, 247))
    draw.text((ref.width + gap + 20, 18), f"{key} current", fill=(235, 241, 247))
    canvas.paste(ref, (0, header_h))
    canvas.paste(cur, (ref.width + gap, header_h))
    return canvas


def compare_pair(pair: dict[str, str], out_dir: Path, threshold: int) -> dict[str, Any]:
    key = pair["key"]
    reference_path = image_path(pair["reference"])
    current_path = image_path(pair["current"])
    reference = Image.open(reference_path)
    current = Image.open(current_path)
    metrics, diff_image = compute_diff(reference, current, threshold=threshold)

    side_path = out_dir / f"{key}-reference-current.png"
    diff_path = out_dir / f"{key}-diff-common-crop.png"
    build_side_by_side(reference, current, key).save(side_path)
    diff_image.save(diff_path)

    palette: dict[str, dict[str, Any]] = {}
    for label, box in PALETTE_BOXES.items():
        reference_color = median_rgb(reference, box)
        current_color = median_rgb(current, box)
        palette[label] = {
            "reference": reference_color,
            "current": current_color,
            "delta": color_delta(reference_color, current_color),
            "box": list(box),
        }

    max_palette_delta = max(item["delta"] for item in palette.values())
    visual_gate = "BLOCKED" if metrics["changedPixelPctThreshold8"] > 3 or max_palette_delta > 4 else "REVIEW"
    return {
        "key": key,
        "reference": rel(reference_path),
        "current": rel(current_path),
        "sideBySide": rel(side_path),
        "diff": rel(diff_path),
        "referenceSize": list(reference.size),
        "currentSize": list(current.size),
        **metrics,
        "palette": palette,
        "maxPaletteDelta": round(max_palette_delta, 2),
        "visualGate": visual_gate,
        "blockingReason": (
            "changed pixel threshold or palette delta exceeds visual-audit gate"
            if visual_gate == "BLOCKED"
            else ""
        ),
    }


def default_pairs(wide_dir: str, scroll_dir: str, selected_dir: str) -> list[dict[str, str]]:
    return [
        {
            "key": "command-center-first",
            "reference": "northstar/screenshots/prototype_home1.png",
            "current": f"{wide_dir}/command-center-3037x1269.png",
        },
        {
            "key": "command-center-lower",
            "reference": "northstar/screenshots/prototype_home2.png",
            "current": f"{scroll_dir}/command-center-3037x1269-main-bottom.png",
        },
        {
            "key": "discover-first",
            "reference": "northstar/screenshots/prototype_discover1.png",
            "current": f"{wide_dir}/discover-3037x1269.png",
        },
        {
            "key": "discover-selected",
            "reference": "northstar/screenshots/prototype_discover2.png",
            "current": f"{selected_dir}/discover-selected-3037x1269.png",
        },
        {
            "key": "stewardship",
            "reference": "northstar/screenshots/prototype_stewardship1.png",
            "current": f"{wide_dir}/stewardship-3037x1269.png",
        },
        {
            "key": "glossary",
            "reference": "northstar/screenshots/prototype_glossary1.png",
            "current": f"{wide_dir}/glossary-3037x1269.png",
        },
        {
            "key": "cde",
            "reference": "northstar/screenshots/prototype_stewardship2.png",
            "current": f"{wide_dir}/cde-registry-3037x1269.png",
        },
        {
            "key": "lineage",
            "reference": "northstar/screenshots/prototype_lineage.png",
            "current": f"{wide_dir}/lineage-3037x1269.png",
        },
        {
            "key": "audit",
            "reference": "northstar/screenshots/prototype_audit1.png",
            "current": f"{wide_dir}/audit-3037x1269.png",
        },
        {
            "key": "control",
            "reference": "northstar/screenshots/prototype_cc.png",
            "current": f"{wide_dir}/control-center-3037x1269.png",
        },
    ]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--wide-dir", default=DEFAULT_WIDE_DIR)
    parser.add_argument("--scroll-dir", default=DEFAULT_SCROLL_DIR)
    parser.add_argument("--selected-dir", default=DEFAULT_SELECTED_DIR)
    parser.add_argument("--out-dir", default=DEFAULT_OUT_DIR)
    parser.add_argument("--threshold", type=int, default=8)
    args = parser.parse_args()

    out_dir = image_path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    pairs = default_pairs(args.wide_dir, args.scroll_dir, args.selected_dir)
    compared = [compare_pair(pair, out_dir, threshold=args.threshold) for pair in pairs]
    manifest = {
        "generatedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "threshold": args.threshold,
        "wideDir": args.wide_dir,
        "scrollDir": args.scroll_dir,
        "selectedDir": args.selected_dir,
        "pairs": compared,
        "summary": {
            "pairCount": len(compared),
            "blockedPairCount": sum(1 for pair in compared if pair["visualGate"] == "BLOCKED"),
            "maxChangedPixelPctThreshold8": max(pair["changedPixelPctThreshold8"] for pair in compared),
            "maxPaletteDelta": max(pair["maxPaletteDelta"] for pair in compared),
        },
        "signoffBoundary": (
            "This artifact is current visual comparison evidence only. It is not visual signoff, "
            "functional proof, deployed Databricks proof, or North Star completion."
        ),
    }
    manifest_path = out_dir / "audit-artifact-manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(rel(manifest_path))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
