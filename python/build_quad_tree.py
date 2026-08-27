"""Build the LOD quadtree from base-level chunks, cleaning them on the way in.

Replaces createQuadTree.py. The tree structure is unchanged: LOD 1 stores a full
chunk, every deeper level stores only the 75% of pixels its parent does not already
carry (TR, BL, BR), and the client stitches TL from the parent.

Parent pixels are a subsample, not an average. That is required by the delta format
-- the parent pixel a client reuses for TL must be exactly the child's TL pixel.

What is new is the base level: each chunk has its water filled and its artifacts
removed before entering the pyramid, so every LOD inherits clean data. Cleaning
happens in memory; public/map/100 is left untouched as the source of truth.

    python -m python.build_quad_tree --preview 543 113
    python -m python.build_quad_tree
"""

import argparse
import math
import os
import re
import sys
import time

import numpy as np

from python.artifact_filter import DEFAULT_PASSES, remove_artifacts
from python.chunk_io import (
    BYTES_PER_PIXEL,
    CHUNK_SIZE,
    EXTENSION,
    NODATA,
    chunk_exists,
    encode,
    read_chunk,
    read_with_margin,
)
from python.water_fill import fill_water

DEFAULT_INPUT_DIR = os.path.join("public", "map", "100")

# Deliberately not "lod_output". The existing pyramid is the one currently being
# served; a rebuild writes alongside it so it can be compared and rolled back to.
# Point the server at this directory, or swap the folders, once it looks right.
DEFAULT_OUTPUT_DIR = os.path.join("public", "map", "lod_output_clean")

_CHUNK_PATTERN = re.compile(r"(-?\d+)_(-?\d+)\.hmap$")


def margin_for(passes):
    """Pixels of neighbouring data the filter needs on each side."""
    if not passes:
        return 0
    return max((k - 1) // 2 for k, _ in passes)


def survey_edge_mask(input_dir, x, z, shape, margin):
    """Mark the chunk edges that face a tile which was never surveyed.

    A hole that runs off the edge of the survey is a coverage gap, not water --
    water stops at a shoreline, it does not stop at a tile boundary. Neighbour
    existence is checked directly rather than inferred from the margin's contents,
    because a neighbour that does exist can still be nodata where a lake continues
    into it.
    """
    mask = np.zeros(shape, dtype=bool)
    last = margin + CHUNK_SIZE - 1

    if not chunk_exists(input_dir, x - 1, z):
        mask[:, margin] = True
    if not chunk_exists(input_dir, x + 1, z):
        mask[:, last] = True
    if not chunk_exists(input_dir, x, z - 1):
        mask[margin, :] = True
    if not chunk_exists(input_dir, x, z + 1):
        mask[last, :] = True

    return mask


def clean_chunk(input_dir, x, z, passes=DEFAULT_PASSES, fill=True):
    """Load a base chunk, clean it, and return (raw uint8 chunk, stats)."""
    margin = margin_for(passes)
    rgb, height, core = read_with_margin(input_dir, x, z, margin)

    filled = np.zeros(height.shape, dtype=bool)
    if fill:
        height, rgb, filled = fill_water(height, rgb,
                                         veto=survey_edge_mask(input_dir, x, z, height.shape, margin))

    height, rgb, fixed = remove_artifacts(height, rgb, passes=passes)

    rgb, height = rgb[core], height[core]
    filled, fixed = filled[core], fixed[core]

    stats = {
        "filled_px": int(filled.sum()),
        "fixed_px": int(fixed.sum()),
        "nodata_px": int((height == NODATA).sum()),
    }
    return encode(rgb, height), stats


def find_bounds(input_dir):
    coords = []
    with os.scandir(input_dir) as entries:
        for entry in entries:
            match = _CHUNK_PATTERN.match(entry.name)
            if match:
                coords.append((int(match.group(1)), int(match.group(2))))
    if not coords:
        return None
    return (min(c[0] for c in coords), max(c[0] for c in coords),
            min(c[1] for c in coords), max(c[1] for c in coords))


def build(input_dir, output_dir, passes=DEFAULT_PASSES, fill=True, force=False):
    if not force and os.path.isdir(output_dir) and os.listdir(output_dir):
        print(f"Refusing to write into non-empty {output_dir}.\n"
              f"Pass --force to overwrite it, or --output-dir to write elsewhere.",
              file=sys.stderr)
        return 1

    bounds = find_bounds(input_dir)
    if bounds is None:
        print(f"No {EXTENSION} files found in {input_dir}", file=sys.stderr)
        return 1
    min_x, max_x, min_z, max_z = bounds

    width = max_x - min_x + 1
    depth = max_z - min_z + 1
    size = 2 ** math.ceil(math.log2(max(width, depth)))
    levels = int(math.log2(size)) + 1

    print(f"World bounds: X[{min_x}..{max_x}] Z[{min_z}..{max_z}]")
    print(f"Quadtree: {size}x{size} chunks, {levels} LOD levels")
    print(f"Filter passes: {passes}   water fill: {'on' if fill else 'off'}")

    progress = {"chunks": 0, "filled": 0, "fixed": 0, "started": time.time()}

    def process(level, x, z):
        if level == levels:
            original_x, original_z = min_x + x, min_z + z
            path = os.path.join(input_dir, f"{original_x}_{original_z}{EXTENSION}")
            if not os.path.exists(path):
                return None

            chunk, stats = clean_chunk(input_dir, original_x, original_z,
                                       passes=passes, fill=fill)
            progress["chunks"] += 1
            progress["filled"] += stats["filled_px"]
            progress["fixed"] += stats["fixed_px"]
            if progress["chunks"] % 100 == 0:
                elapsed = time.time() - progress["started"]
                rate = progress["chunks"] / max(elapsed, 1e-9)
                print(f"  {progress['chunks']} chunks cleaned "
                      f"({rate:.1f}/s, {progress['fixed'] / 1e6:.1f}M artifact px, "
                      f"{progress['filled'] / 1e6:.1f}M water px)", flush=True)
        else:
            top_left = process(level + 1, 2 * x, 2 * z)
            top_right = process(level + 1, 2 * x + 1, 2 * z)
            bottom_left = process(level + 1, 2 * x, 2 * z + 1)
            bottom_right = process(level + 1, 2 * x + 1, 2 * z + 1)

            if all(child is None for child in
                   (top_left, top_right, bottom_left, bottom_right)):
                return None

            half = CHUNK_SIZE // 2
            chunk = np.zeros((CHUNK_SIZE, CHUNK_SIZE, BYTES_PER_PIXEL), dtype=np.uint8)
            if top_left is not None:
                chunk[0:half, 0:half] = top_left
            if top_right is not None:
                chunk[0:half, half:CHUNK_SIZE] = top_right
            if bottom_left is not None:
                chunk[half:CHUNK_SIZE, 0:half] = bottom_left
            if bottom_right is not None:
                chunk[half:CHUNK_SIZE, half:CHUNK_SIZE] = bottom_right

        level_dir = os.path.join(output_dir, str(level))
        os.makedirs(level_dir, exist_ok=True)
        target = os.path.join(level_dir, f"{x}_{z}{EXTENSION}")

        if level == 1:
            with open(target, "wb") as f:
                f.write(chunk.ravel().tobytes())
            print(f"Saved root LOD 1: {target}")
            return None

        parent_pixels = chunk[0::2, 0::2]
        new_pixels = np.stack(
            [chunk[0::2, 1::2], chunk[1::2, 0::2], chunk[1::2, 1::2]], axis=-2
        )
        with open(target, "wb") as f:
            f.write(new_pixels.ravel().tobytes())
        return parent_pixels

    print("Building sparse quadtree (empty branches are skipped)...")
    process(1, 0, 0)
    elapsed = time.time() - progress["started"]
    print(f"Done in {elapsed / 60:.1f} min. {progress['chunks']} base chunks, "
          f"{progress['fixed'] / 1e6:.1f}M artifact px removed, "
          f"{progress['filled'] / 1e6:.1f}M water px filled.")
    return 0


def preview(input_dir, x, z, out_dir, passes=DEFAULT_PASSES, fill=True):
    """Render before/after/difference PNGs for a single chunk."""
    from PIL import Image

    os.makedirs(out_dir, exist_ok=True)
    rgb_before, height_before = read_chunk(input_dir, x, z)
    raw_after, stats = clean_chunk(input_dir, x, z, passes=passes, fill=fill)
    height_after = raw_after[..., 3].astype(np.uint16) | (raw_after[..., 4].astype(np.uint16) << 8)
    rgb_after = raw_after[..., :3]

    def shade(height, rgb):
        """Hillshade so height changes are actually visible."""
        h = height.astype(np.float64)
        dy, dx = np.gradient(h)
        light = np.clip(0.5 + 0.5 * (dx + dy) / 3.0, 0.15, 1.0)
        shaded = rgb.astype(np.float64) * light[..., None]
        shaded[height == NODATA] = (255, 0, 0)  # nodata in red
        return Image.fromarray(np.clip(shaded, 0, 255).astype(np.uint8))

    before_image = shade(height_before, rgb_before)
    after_image = shade(height_after, rgb_after)

    written = []
    for name, image in ((f"{x}_{z}_before.png", before_image),
                        (f"{x}_{z}_after.png", after_image)):
        path = os.path.join(out_dir, name)
        image.save(path)
        written.append(path)

    # Side by side at half scale, with a divider, so a tile can be judged from one
    # file instead of flipping between two.
    half = (CHUNK_SIZE // 2, CHUNK_SIZE // 2)
    gap = 8
    combined = Image.new("RGB", (half[0] * 2 + gap, half[1]), (255, 255, 255))
    combined.paste(before_image.resize(half), (0, 0))
    combined.paste(after_image.resize(half), (half[0] + gap, 0))
    path = os.path.join(out_dir, f"{x}_{z}_compare.png")
    combined.save(path)
    written.append(path)

    drop = height_before.astype(np.int32) - height_after.astype(np.int32)
    difference = np.zeros(drop.shape + (3,), dtype=np.uint8)
    difference[..., 0] = np.clip(drop, 0, 40) * 6      # lowered -> red
    difference[..., 2] = np.clip(-drop, 0, 40) * 6     # raised (water fill) -> blue
    path = os.path.join(out_dir, f"{x}_{z}_diff.png")
    Image.fromarray(difference).save(path)
    written.append(path)

    changed = drop != 0
    print(f"chunk {x}_{z}")
    print(f"  artifact pixels removed : {stats['fixed_px']:>8} "
          f"({100 * stats['fixed_px'] / drop.size:.2f}%)")
    print(f"  water pixels filled     : {stats['filled_px']:>8} "
          f"({100 * stats['filled_px'] / drop.size:.2f}%)")
    print(f"  nodata remaining        : {stats['nodata_px']:>8} "
          f"({100 * stats['nodata_px'] / drop.size:.2f}%)")
    if changed.any():
        lowered = drop[drop > 0]
        if lowered.size:
            print(f"  height drop             : mean {lowered.mean():.1f}m  "
                  f"p99 {np.percentile(lowered, 99):.0f}m  max {lowered.max()}m")
    for path in written:
        print(f"  wrote {path}")
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--input-dir", default=DEFAULT_INPUT_DIR)
    parser.add_argument("--output-dir", default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--preview", nargs=2, type=int, metavar=("X", "Z"),
                        help="render before/after PNGs for one chunk and exit")
    parser.add_argument("--preview-dir", default=os.path.join("public", "map", "preview"))
    parser.add_argument("--no-water-fill", action="store_true")
    parser.add_argument("--no-filter", action="store_true",
                        help="skip artifact removal (water fill only)")
    parser.add_argument("--force", action="store_true",
                        help="allow writing into a non-empty output directory")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args(argv)

    passes = () if args.no_filter else DEFAULT_PASSES
    fill = not args.no_water_fill

    if args.preview:
        return preview(args.input_dir, args.preview[0], args.preview[1],
                       args.preview_dir, passes=passes, fill=fill)

    return build(args.input_dir, args.output_dir, passes=passes, fill=fill,
                 force=args.force)


if __name__ == "__main__":
    raise SystemExit(main())
