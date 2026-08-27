"""Vectorized LAZ tile -> heightmap conversion.

LazConverter.laz_to_hmap accumulates points in a Python dict, one iteration per
point. The larger GKOT tiles hold 70M+ points, which is why four of them were never
converted. This does the same job with array operations.

Two behavioural differences from the dict version:

* The tile origin comes from the filename rather than X.min(). They agree on every
  tile checked, but a partial edge tile whose points stop short of its west or south
  edge would be silently shifted.
* Ties on height resolve to whichever point comes last, rather than to the first
  one seen. Both are arbitrary.
"""

import numpy as np

from python.chunk_io import CHUNK_SIZE

# Each GKOT tile covers a 1km square, so a CHUNK_SIZE of 1000 assumes 1m cells --
# that is, voxel_size=100. Other voxel sizes would need CHUNK_SIZE to change with
# them, which the rest of the pipeline does not currently support.
TILE_METRES = 1000

# ufunc.at is slow, so points are processed in blocks to keep peak memory bounded
# on the 70M-point tiles without materialising a full sort.
_BLOCK = 8_000_000


def laz_to_heightmap(laz_file, tile_x, tile_z, voxel_size=100, verbose=False):
    """Convert one GKOT tile to a (CHUNK_SIZE, CHUNK_SIZE, 4) uint16 heightmap.

    Indexed [x, z, (r, g, b, height)] to match LazConverter.laz_to_hmap, which is
    what ChunkBinaryManager.heightmap_to_binary expects.
    """
    import laspy

    las = laspy.read(laz_file)
    header = las.header
    scale, offset = header.scale, header.offset
    metres_per_voxel = voxel_size / 100

    n = CHUNK_SIZE
    origin_x = int(round(tile_x * TILE_METRES / metres_per_voxel))
    origin_z = int(round(tile_z * TILE_METRES / metres_per_voxel))

    max_height = np.zeros(n * n, dtype=np.int32)
    seen = np.zeros(n * n, dtype=bool)
    colours = np.zeros((n * n, 3), dtype=np.uint8)

    total = len(las.X)
    for start in range(0, total, _BLOCK):
        stop = min(start + _BLOCK, total)
        cell, height = _block_cells(las, start, stop, scale, offset, metres_per_voxel,
                                    origin_x, origin_z, n)
        if cell.size == 0:
            continue
        np.maximum.at(max_height, cell, height)
        seen[cell] = True

    # Second pass: a point that achieves its cell's maximum donates its colour.
    for start in range(0, total, _BLOCK):
        stop = min(start + _BLOCK, total)
        cell, height, rgb = _block_cells(las, start, stop, scale, offset,
                                         metres_per_voxel, origin_x, origin_z, n,
                                         with_colour=True)
        if cell.size == 0:
            continue
        winners = height == max_height[cell]
        colours[cell[winners]] = rgb[winners]

    heightmap = np.zeros((n, n, 4), dtype=np.uint16)
    filled = seen & (max_height > 0)
    flat = heightmap.reshape(n * n, 4)
    flat[filled, :3] = colours[filled]
    flat[filled, 3] = np.clip(max_height[filled], 1, np.iinfo(np.uint16).max)

    if verbose:
        print(f"  {laz_file}: {total} points -> {filled.sum()} cells "
              f"({100 * filled.mean():.1f}% coverage)")

    return heightmap


def _block_cells(las, start, stop, scale, offset, metres_per_voxel,
                 origin_x, origin_z, n, with_colour=False):
    """Map a block of points to (flat cell index, height[, rgb]), in-bounds only."""
    x = np.round((np.asarray(las.X[start:stop]) * scale[0] + offset[0]) / metres_per_voxel)
    y = np.round((np.asarray(las.Y[start:stop]) * scale[1] + offset[1]) / metres_per_voxel)
    z = np.round((np.asarray(las.Z[start:stop]) * scale[2] + offset[2]) / metres_per_voxel)

    ix = x.astype(np.int64) - origin_x
    iz = y.astype(np.int64) - origin_z

    inside = (ix >= 0) & (ix < n) & (iz >= 0) & (iz < n) & (z > 0)
    ix, iz = ix[inside], iz[inside]

    # [x, z] indexing, matching LazConverter's array layout.
    cell = (ix * n + iz).astype(np.int64)
    height = np.clip(z[inside], 0, np.iinfo(np.uint16).max).astype(np.int32)

    if not with_colour:
        return cell, height

    rgb = np.empty((inside.sum(), 3), dtype=np.uint8)
    for channel, name in enumerate(("red", "green", "blue")):
        raw = np.asarray(getattr(las, name)[start:stop])[inside]
        rgb[:, channel] = (raw / 65535 * 255).astype(np.uint8)
    return cell, height, rgb
