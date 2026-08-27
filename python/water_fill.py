"""Filling water bodies, and leaving genuine survey gaps alone.

Water absorbs the 1064nm lidar pulse, so rivers and lakes come back as nodata and
the mesher draws them as pits. Unsurveyed ground is also nodata, but filling that
would fabricate terrain -- tile 486_157 sits on the Italian border and its holes
span a 28m elevation change.

The two are told apart by whether the hole's banks line up. A water surface is
level, so the two banks facing each other across it sit at the same elevation.
Where terrain simply was not surveyed, the hillside continues and the far bank does
not match. Measured on real tiles, water holes show a median bank difference of
0.0m (p90 under 11m) while the border tile shows 28m (p90 43m) -- a clean split.

Hole width does NOT discriminate: 555_161 is 279px-wide water and 486_157 is a
200px-wide gap.
"""

import numpy as np
from scipy import ndimage

from python.chunk_io import NODATA

# A component is water if opposing banks agree to within these tolerances.
WATER_MEDIAN_TOLERANCE_M = 2.0
WATER_P90_TOLERANCE_M = 8.0

# Components with fewer interior runs than this have too little evidence to
# classify, so they are left alone.
MIN_RUNS_TO_CLASSIFY = 4

# Scattered single-cell dropouts are too small for the bank test to say anything
# useful about, and filling them is harmless.
ALWAYS_FILL_BELOW_PX = 16

# Filled water gets a flat colour. Interpolating from the banks would smear grass
# green across a lake surface.
WATER_COLOUR = (58, 92, 112)

_SMOOTHING_ITERATIONS = 40


def fill_water(height, rgb=None, water_colour=WATER_COLOUR, veto=None):
    """Return (height, rgb, filled) with water bodies filled in.

    `filled` is a boolean mask of the pixels that were filled. Nodata judged to be
    a survey gap is left untouched.

    `veto` is an optional boolean mask marking pixels that sit on a survey
    boundary. Any component touching one is left alone regardless of how level its
    banks look. The bank test cannot see these on its own: the gap along the east
    edge of tile 486_157 measures a median bank difference of 0.0m, identical to a
    lake, because the terrain either side happens to be at the same elevation.
    Whether the neighbouring tile was ever surveyed is independent evidence.
    """
    height = np.asarray(height)
    nodata = height == NODATA
    if not nodata.any():
        return height.copy(), (None if rgb is None else np.asarray(rgb).copy()), nodata

    labels, count = ndimage.label(nodata)
    if count == 0:
        return height.copy(), (None if rgb is None else np.asarray(rgb).copy()), nodata

    water_labels, measured = _classify(height, nodata, labels, count)
    if not water_labels:
        return height.copy(), (None if rgb is None else np.asarray(rgb).copy()), np.zeros_like(nodata)

    sizes = np.bincount(labels.ravel(), minlength=count + 1)
    tiny = np.zeros(count + 1, dtype=bool)
    tiny[1:] = sizes[1:] < ALWAYS_FILL_BELOW_PX

    # A pixel is filled only if its component looks like water AND that pixel sits
    # in a run that actually supplied evidence.
    #
    # Component membership alone is not enough. label() merges a survey gap running
    # off the chunk edge with any scattered dropout it happens to touch, and the
    # merged component then inherits the dropouts' level-banked statistics. The
    # gap's own runs all terminate at the chunk edge and measure nothing, so
    # requiring per-pixel evidence leaves it alone. Observed on tile 486_157, where
    # component classification alone filled 13% of the chunk with invented terrain.
    is_water = np.zeros(count + 1, dtype=bool)
    is_water[list(water_labels)] = True

    if veto is not None:
        vetoed = np.unique(labels[np.asarray(veto) & nodata])
        is_water[vetoed[vetoed > 0]] = False

    fill_mask = is_water[labels] & (measured | tiny[labels]) & nodata
    out_height = _inpaint(height, nodata, fill_mask)

    out_rgb = None
    if rgb is not None:
        out_rgb = np.asarray(rgb).copy()
        out_rgb[fill_mask] = np.asarray(water_colour, dtype=out_rgb.dtype)

    return out_height, out_rgb, fill_mask


def _classify(height, nodata, labels, count):
    """Return (water component labels, mask of pixels covered by a measured run)."""
    diffs = {}
    measured = np.zeros(nodata.shape, dtype=bool)

    for axis in (1, 0):
        covered = np.zeros(nodata.shape if axis == 1 else nodata.T.shape, dtype=bool)
        for label, diff, row, start, end in _interior_runs(nodata, height, labels, axis):
            diffs.setdefault(label, []).append(diff)
            covered[row, start:end] = True
        measured |= covered if axis == 1 else covered.T

    sizes = np.bincount(labels.ravel(), minlength=count + 1)

    water = set()
    for label in range(1, count + 1):
        if sizes[label] == 0:
            continue
        if sizes[label] < ALWAYS_FILL_BELOW_PX:
            water.add(label)
            continue

        observed = diffs.get(label)
        if observed is None or len(observed) < MIN_RUNS_TO_CLASSIFY:
            # Nothing to go on -- for instance a component that touches the chunk
            # edge on every side. Leave it rather than guess.
            continue

        arr = np.asarray(observed, dtype=np.float64)
        if np.median(arr) <= WATER_MEDIAN_TOLERANCE_M and np.percentile(arr, 90) <= WATER_P90_TOLERANCE_M:
            water.add(label)

    return water, measured


def _interior_runs(nodata, height, labels, axis):
    """Yield (label, |left bank - right bank|, row, start, end) for measurable runs.

    A run is measurable only when it has data on both sides. Runs terminating at
    the array edge are skipped: there is no far bank to compare against, so they
    are evidence of nothing. `axis=1` scans rows, `axis=0` scans columns, with row
    and start/end reported in that axis's own orientation.
    """
    if axis == 0:
        nodata, height, labels = nodata.T, height.T, labels.T

    n = nodata.shape[1]
    padded = np.pad(nodata, ((0, 0), (1, 1)), constant_values=False)
    delta = np.diff(padded.astype(np.int8), axis=1)

    start_rows, start_cols = np.nonzero(delta == 1)
    end_rows, end_cols = np.nonzero(delta == -1)

    # Runs alternate along each row, so nonzero's row-major ordering pairs them.
    for row, start, end in zip(start_rows, start_cols, end_cols):
        if start == 0 or end >= n:
            continue  # touches the edge; no bank on one side
        left = int(height[row, start - 1])
        right = int(height[row, end])
        if left == NODATA or right == NODATA:
            continue
        yield int(labels[row, start]), abs(left - right), int(row), int(start), int(end)


def _inpaint(height, nodata, fill_mask):
    """Fill `fill_mask` with a harmonic surface pinned to the surrounding banks.

    Initialised from the nearest known value, which is already exact for level
    water and follows the gradient of a sloping river, then relaxed to remove the
    seams where nearest-neighbour regions meet.
    """
    known = ~nodata
    out = height.astype(np.float64)

    _, indices = ndimage.distance_transform_edt(~known, return_indices=True)
    out[fill_mask] = out[indices[0][fill_mask], indices[1][fill_mask]]

    # Nodata that is not being filled must not bleed into the average.
    contributes = known | fill_mask
    for _ in range(_SMOOTHING_ITERATIONS):
        total = np.zeros_like(out)
        counts = np.zeros(out.shape, dtype=np.int32)
        weighted = np.where(contributes, out, 0.0)
        for shifted_values, shifted_counts in _four_neighbours(weighted, contributes):
            total += shifted_values
            counts += shifted_counts
        averaged = np.divide(total, np.maximum(counts, 1))
        out = np.where(fill_mask & (counts > 0), averaged, out)

    result = np.rint(out).astype(np.int64)
    result = np.clip(result, 1, np.iinfo(np.uint16).max)  # never write back a nodata 0
    return np.where(fill_mask, result, height).astype(np.uint16)


def _four_neighbours(values, valid):
    """Yield the four axis-aligned shifts of (values, valid).

    Padded rather than rolled: wrapping would let the top row average in the
    bottom row. Anything outside the array counts as invalid.
    """
    padded_values = np.pad(values, 1)
    padded_valid = np.pad(valid.astype(np.int32), 1)
    windows = (
        (slice(0, -2), slice(1, -1)),
        (slice(2, None), slice(1, -1)),
        (slice(1, -1), slice(0, -2)),
        (slice(1, -1), slice(2, None)),
    )
    for rows, cols in windows:
        yield padded_values[rows, cols], padded_valid[rows, cols]
