"""Reading and writing base-level .hmap chunks.

On disk a chunk is CHUNK_SIZE x CHUNK_SIZE pixels of 5 bytes: r, g, b, height_lo,
height_hi. The array layout is [row, col] where row is the chunk's z axis and col is
its x axis, matching what ChunkBinaryManager.heightmap_to_binary writes.
"""

import os

import numpy as np

CHUNK_SIZE = 1000
BYTES_PER_PIXEL = 5
EXTENSION = ".hmap"

# A height of 0 means "no lidar return here", not "sea level". Water absorbs the
# 1064nm pulse and unsurveyed ground returns nothing, so both land on this value.
NODATA = 0


def chunk_path(base_dir, x, z):
    return os.path.join(base_dir, f"{x}_{z}{EXTENSION}")


def chunk_exists(base_dir, x, z):
    return os.path.isfile(chunk_path(base_dir, x, z))


def decode(raw):
    """Split a raw (N, N, 5) uint8 chunk into (rgb uint8, height uint16)."""
    rgb = np.ascontiguousarray(raw[..., :3])
    height = raw[..., 3].astype(np.uint16) | (raw[..., 4].astype(np.uint16) << 8)
    return rgb, height


def encode(rgb, height):
    """Pack (rgb, height) back into the (N, N, 5) uint8 on-disk layout."""
    out = np.empty(rgb.shape[:2] + (BYTES_PER_PIXEL,), dtype=np.uint8)
    out[..., :3] = rgb
    h = np.ascontiguousarray(height.astype(np.uint16))
    out[..., 3:5] = h[..., None].view(np.uint8)
    return out


def read_raw(base_dir, x, z, mmap=True):
    """Read a chunk as a raw (N, N, 5) uint8 array."""
    path = chunk_path(base_dir, x, z)
    mode = "r" if mmap else None
    if mmap:
        return np.memmap(path, dtype=np.uint8, mode=mode).reshape(
            CHUNK_SIZE, CHUNK_SIZE, BYTES_PER_PIXEL
        )
    with open(path, "rb") as f:
        return np.frombuffer(f.read(), dtype=np.uint8).reshape(
            CHUNK_SIZE, CHUNK_SIZE, BYTES_PER_PIXEL
        )


def read_chunk(base_dir, x, z):
    return decode(read_raw(base_dir, x, z))


def write_chunk(base_dir, x, z, rgb, height):
    os.makedirs(base_dir, exist_ok=True)
    with open(chunk_path(base_dir, x, z), "wb") as f:
        f.write(encode(rgb, height).ravel().tobytes())


# Neighbour offsets as (d_col, d_row) == (dx, dz). Col is x, row is z.
_NEIGHBOURS = [
    (-1, -1), (0, -1), (1, -1),
    (-1, 0), (1, 0),
    (-1, 1), (0, 1), (1, 1),
]


def read_with_margin(base_dir, x, z, margin):
    """Read a chunk padded by `margin` pixels of real data from its neighbours.

    Filtering each chunk in isolation leaves artifacts uncleaned within `margin`
    pixels of every seam, which shows up as a faint grid across the world. Where a
    neighbour is missing the margin falls back to edge replication.

    Returns (rgb, height, core) where `core` is the slice selecting the original
    chunk out of the padded arrays.
    """
    if margin <= 0:
        rgb, height = read_chunk(base_dir, x, z)
        return rgb, height, (slice(None), slice(None))

    rgb, height = read_chunk(base_dir, x, z)
    rgb = np.pad(rgb, ((margin, margin), (margin, margin), (0, 0)), mode="edge")
    height = np.pad(height, margin, mode="edge")

    n = CHUNK_SIZE
    m = margin
    for dx, dz in _NEIGHBOURS:
        if not chunk_exists(base_dir, x + dx, z + dz):
            continue
        raw = read_raw(base_dir, x + dx, z + dz)

        # Source strip on the neighbour: the edge facing this chunk.
        src_rows = slice(n - m, n) if dz < 0 else slice(0, m) if dz > 0 else slice(None)
        src_cols = slice(n - m, n) if dx < 0 else slice(0, m) if dx > 0 else slice(None)

        # Destination strip in the padded arrays.
        dst_rows = slice(0, m) if dz < 0 else slice(m + n, m + n + m) if dz > 0 else slice(m, m + n)
        dst_cols = slice(0, m) if dx < 0 else slice(m + n, m + n + m) if dx > 0 else slice(m, m + n)

        n_rgb, n_height = decode(np.asarray(raw[src_rows, src_cols]))
        rgb[dst_rows, dst_cols] = n_rgb
        height[dst_rows, dst_cols] = n_height

    core = (slice(m, m + n), slice(m, m + n))
    return rgb, height, core
