"""Convert any LAZ tile that has no corresponding .hmap chunk.

Idempotent: rerunning it converts nothing when nothing is missing.

    python -m python.convert_missing_chunks --dry-run
    python -m python.convert_missing_chunks
"""

import argparse
import os
import re
import sys
import time

from python.chunk_binary_manager import ChunkBinaryManager
from python.chunk_io import chunk_exists
from python.laz_tile import laz_to_heightmap

DEFAULT_LAZ_DIR = os.path.join("E:", os.sep, "gkot")
DEFAULT_OUT_DIR = os.path.join("public", "map", "100")

_LAZ_PATTERN = re.compile(r"GKOT_(-?\d+)_(-?\d+)\.laz$", re.IGNORECASE)


def find_laz_tiles(laz_dir):
    """Return {(x, z): path} for every GKOT tile in `laz_dir`."""
    tiles = {}
    with os.scandir(laz_dir) as entries:
        for entry in entries:
            match = _LAZ_PATTERN.match(entry.name)
            if match:
                tiles[(int(match.group(1)), int(match.group(2)))] = entry.path
    return tiles


def find_missing(laz_dir, out_dir):
    """Return a sorted list of (x, z, laz_path) that have LAZ but no chunk."""
    tiles = find_laz_tiles(laz_dir)
    missing = [(x, z, path) for (x, z), path in tiles.items()
               if not chunk_exists(out_dir, x, z)]
    missing.sort()
    return missing, len(tiles)


def convert_tile(x, z, laz_path, out_dir, voxel_size, verbose):
    heightmap = laz_to_heightmap(laz_path, x, z, voxel_size=voxel_size, verbose=verbose)
    binary = ChunkBinaryManager(verbose).heightmap_to_binary(heightmap, verbose=verbose)

    os.makedirs(out_dir, exist_ok=True)
    target = os.path.join(out_dir, f"{x}_{z}.hmap")

    # Write via a temporary file so an interrupted run cannot leave a truncated
    # chunk behind, which would then look present and be skipped on the retry.
    temporary = target + ".partial"
    with open(temporary, "wb") as f:
        f.write(binary)
    os.replace(temporary, target)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--laz-dir", default=DEFAULT_LAZ_DIR)
    parser.add_argument("--out-dir", default=DEFAULT_OUT_DIR)
    parser.add_argument("--voxel-size", type=int, default=100,
                        help="cell size in centimetres (default 100)")
    parser.add_argument("--dry-run", action="store_true",
                        help="list what would be converted and exit")
    parser.add_argument("--limit", type=int, default=None,
                        help="convert at most this many tiles")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args(argv)

    if not os.path.isdir(args.laz_dir):
        parser.error(f"LAZ directory not found: {args.laz_dir}")

    missing, total = find_missing(args.laz_dir, args.out_dir)
    print(f"{total} LAZ tiles, {total - len(missing)} already converted, "
          f"{len(missing)} missing")

    if not missing:
        return 0

    if args.limit is not None:
        missing = missing[:args.limit]

    if args.dry_run:
        for x, z, path in missing:
            size_gb = os.path.getsize(path) / 1e9
            print(f"  would convert {x}_{z}  ({size_gb:.2f} GB)")
        return 0

    for index, (x, z, path) in enumerate(missing, start=1):
        started = time.time()
        print(f"[{index}/{len(missing)}] converting {x}_{z} ...", flush=True)
        try:
            convert_tile(x, z, path, args.out_dir, args.voxel_size, args.verbose)
        except Exception as error:  # keep going; one bad tile should not stop the run
            print(f"    FAILED {x}_{z}: {error}", file=sys.stderr)
            continue
        print(f"    done in {time.time() - started:.0f}s", flush=True)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
