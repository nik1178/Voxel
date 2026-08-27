"""Removing pillars and powerline strips from heightmaps.

The LAZ converter takes the top-most lidar return per cell, so wires, poles and
pylons become terrain. All of these are thin positive features standing above the
ground, which is exactly what a grayscale morphological top-hat isolates:

    opened = grey_opening(H, k)   # k x k flat structuring element
    spike  = H - opened
    fix where spike > threshold

A pixel survives opening only if the structuring element fits inside its feature, so
a k x k element removes anything strictly narrower than k pixels -- k=3 clears
features up to 2px across, k=5 up to 4px. A powerline of any length or orientation
vanishes; a building, being wider than the element, is untouched. Only pixels
exceeding the threshold are modified, so this is surgical rather than a blanket
smooth.
"""

import numpy as np
from scipy import ndimage

from python.chunk_io import NODATA

# (structuring element size, height above local surface in metres).
#
# Pass B's structuring element must be strictly wider than pass A's. Opening is
# idempotent for a given element, so a second pass at the same k with a higher
# threshold can only flag a subset of what pass A already fixed -- it would do
# nothing. k=3 clears wires and pillars up to 2m across; k=5 at a much higher
# threshold clears pylon masts up to 4m across.
DEFAULT_PASSES = ((3, 3), (5, 15))

# Substituted for nodata before erosion. Erosion takes a local minimum, so leaving
# nodata at 0 would drag the opened surface down across its whole neighbourhood,
# flag the surrounding real terrain as a spike, and delete it.
_SENTINEL = np.int32(1 << 30)

# Shape gate. The top-hat alone removes every thin positive feature, and a conifer
# crown in steep forest is one: it stands ~20m above the canopy gaps around it,
# exactly like a wire. No height threshold separates them -- at a 12m threshold a
# steep forested chunk still loses 18% of its pixels.
#
# Shape does separate them, and matches what we actually want gone: single-cell
# pillars, and the long strips left by powerlines. A tree crown is neither. Gating
# the mask on component shape takes tile 516_82 from 28.6% of pixels modified to
# 1.1%, while keeping every one of the 1944 powerline pixels on tile 543_113.
MAX_PILLAR_PX = 3         # isolated spikes this small are pillars
MIN_STRIP_SPAN = 20       # a strip must run at least this far
MAX_STRIP_THICKNESS = 3.0 # ...averaging no more than this many pixels wide


def remove_artifacts(height, rgb=None, passes=DEFAULT_PASSES, gate_shape=True):
    """Return (height, rgb, fixed) with thin positive artifacts removed.

    `fixed` is a boolean mask of the pixels that were modified. `rgb` may be None,
    in which case no colour correction is done and None is returned for it.

    Nodata pixels are never modified and never contribute to a neighbour's local
    surface.
    """
    height = np.asarray(height)
    valid = height != NODATA

    h = height.astype(np.int32)
    fixed = np.zeros(h.shape, dtype=bool)

    for k, threshold in passes:
        work = np.where(valid, h, _SENTINEL)
        opened = ndimage.grey_opening(work, size=(k, k), mode="nearest")

        # Opening is anti-extensive, so at valid pixels opened <= h and spike >= 0.
        spike = h - opened
        mask = valid & (spike > threshold)
        if not mask.any():
            continue

        h = np.where(mask, opened, h)
        fixed |= mask

    if gate_shape and fixed.any():
        fixed = _keep_pillars_and_strips(fixed)
        h = np.where(fixed, h, height.astype(np.int32))

    out_height = np.clip(h, 0, np.iinfo(np.uint16).max).astype(np.uint16)

    # Preserve nodata exactly. Clipping cannot resurrect it, but a pass could in
    # principle have written a 0 into a valid cell.
    out_height = np.where(valid, np.maximum(out_height, 1), NODATA).astype(np.uint16)

    out_rgb = None
    if rgb is not None:
        out_rgb = _repair_colour(np.asarray(rgb), fixed, valid)

    return out_height, out_rgb, fixed


def _keep_pillars_and_strips(mask):
    """Drop everything from `mask` that is neither a small pillar nor a long strip.

    8-connectivity, because a powerline crossing the grid diagonally is a chain of
    diagonally adjacent pixels.
    """
    labels, count = ndimage.label(mask, structure=np.ones((3, 3)))
    if count == 0:
        return mask

    sizes = np.bincount(labels.ravel(), minlength=count + 1)
    keep = np.zeros(count + 1, dtype=bool)

    for label, bounds in enumerate(ndimage.find_objects(labels), start=1):
        if sizes[label] <= MAX_PILLAR_PX:
            keep[label] = True
            continue
        rows = bounds[0].stop - bounds[0].start
        cols = bounds[1].stop - bounds[1].start
        span = max(rows, cols)

        # Mean thickness, not bounding-box aspect ratio. A 45-degree wire has a
        # square bounding box, so an aspect test would reject the diagonal
        # powerlines this is meant to catch. Pixel count over span is orientation
        # independent: a line of any angle gives ~1, a compact blob gives ~span.
        thickness = sizes[label] / span
        if span >= MIN_STRIP_SPAN and thickness <= MAX_STRIP_THICKNESS:
            keep[label] = True

    return keep[labels]


def _repair_colour(rgb, fixed, valid):
    """Give corrected pixels the colour of their nearest untouched neighbour.

    Dropping a powerline pixel to ground level while leaving its wire-coloured RGB
    in place would paint a thin discoloured line across the terrain.
    """
    repairable = fixed & valid
    if not repairable.any():
        return rgb.copy()

    donor = valid & ~fixed
    if not donor.any():
        return rgb.copy()

    # EDT over the non-donor region returns, for every pixel, the index of the
    # nearest donor pixel.
    _, indices = ndimage.distance_transform_edt(
        ~donor, return_indices=True, return_distances=True
    )

    out = rgb.copy()
    rows, cols = indices[0][repairable], indices[1][repairable]
    out[repairable] = rgb[rows, cols]
    return out
