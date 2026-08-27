import numpy as np
import pytest

from python.artifact_filter import remove_artifacts
from python.chunk_io import NODATA


def flat_terrain(size=64, height=300):
    return np.full((size, size), height, dtype=np.uint16)


def test_removes_single_cell_pillar():
    h = flat_terrain()
    h[32, 32] = 350  # 50m spike on one cell
    out, _, fixed = remove_artifacts(h)

    assert fixed[32, 32]
    assert out[32, 32] == pytest.approx(300, abs=1)
    assert fixed.sum() == 1


def test_removes_diagonal_powerline():
    h = flat_terrain()
    for i in range(10, 54):
        h[i, i] = 320  # 20m wire, one cell wide, diagonal

    out, _, fixed = remove_artifacts(h)

    assert (out[np.arange(10, 54), np.arange(10, 54)] == 300).all()
    assert fixed.sum() == 44


def test_diagonal_strip_survives_the_shape_gate():
    """A 45-degree wire has a square bounding box, so aspect ratio would reject it."""
    h = flat_terrain()
    for i in range(10, 54):
        h[i, i] = 320

    _, _, fixed = remove_artifacts(h)

    assert fixed[np.arange(10, 54), np.arange(10, 54)].all()


def test_preserves_buildings():
    h = flat_terrain()
    h[20:40, 20:40] = 320  # 20x20 block, 20m tall

    out, _, fixed = remove_artifacts(h)

    assert not fixed.any()
    np.testing.assert_array_equal(out, h)


def test_structuring_element_removes_features_narrower_than_k():
    """A k x k element removes features narrower than k, so 3px survives k=3."""
    h = flat_terrain()
    h[30:33, 30:33] = 340  # 3x3, 40m tall

    _, _, fixed_a = remove_artifacts(h, passes=((3, 3),), gate_shape=False)
    _, _, fixed_b = remove_artifacts(h, gate_shape=False)

    assert not fixed_a.any(), "a 3px feature should survive a 3px structuring element"
    assert fixed_b[30:33, 30:33].all(), "the k=5 pass should catch it"


def test_shape_gate_spares_compact_blobs():
    """A compact multi-pixel spike is shape-indistinguishable from a tree crown.

    Sparing it is the deliberate trade: it means a pylon mast survives, but it also
    means steep forest is not shaved. Tile 516_82 goes from 28.6% of pixels
    modified to 1.1% because of this.
    """
    h = flat_terrain()
    h[30:33, 30:33] = 340  # 3x3, 40m tall -- neither a pillar nor a strip

    _, _, ungated = remove_artifacts(h, gate_shape=False)
    _, _, gated = remove_artifacts(h)

    assert ungated.any()
    assert not gated.any()


def test_two_pixel_feature_is_removed_by_first_pass():
    h = flat_terrain()
    h[30:32, 30:32] = 340  # 2x2 -- narrower than the 3px element

    _, _, fixed = remove_artifacts(h, passes=((3, 3),), gate_shape=False)

    assert fixed[30:32, 30:32].all()


def test_nodata_does_not_destroy_neighbouring_terrain():
    """The checkerboard bug: nodata read as height 0 drags down real terrain."""
    h = flat_terrain()
    h[32, 32] = NODATA

    out, _, fixed = remove_artifacts(h)

    assert out[32, 32] == NODATA, "nodata must stay nodata"
    neighbourhood = out[28:37, 28:37]
    assert (neighbourhood[neighbourhood != NODATA] == 300).all(), (
        "terrain around a nodata cell must be untouched"
    )
    assert not fixed.any()


def test_does_not_prefer_any_2x2_quadrant():
    """Regression for the checkerboard: no quadrant may be modified preferentially."""
    rng = np.random.default_rng(0)
    h = (300 + rng.normal(0, 5, (200, 200))).astype(np.uint16)

    _, _, fixed = remove_artifacts(h)

    rates = [
        fixed[0::2, 0::2].mean(),
        fixed[0::2, 1::2].mean(),
        fixed[1::2, 0::2].mean(),
        fixed[1::2, 1::2].mean(),
    ]
    assert max(rates) - min(rates) < 0.02, f"quadrants modified unevenly: {rates}"


def test_noise_alone_is_not_treated_as_artifacts():
    """The old filter rewrote >50% of pixels on noisy ground. This must not.

    Sigma here is hard-surface lidar noise. Vegetation canopy has far more local
    relief than this and is genuinely affected by the filter -- see the preview
    measurements in the design doc.
    """
    rng = np.random.default_rng(1)
    h = (300 + rng.normal(0, 0.5, (200, 200))).astype(np.uint16)

    _, _, fixed = remove_artifacts(h)

    assert fixed.mean() < 0.01, f"{100 * fixed.mean():.1f}% of flat noisy ground rewritten"


def test_corrected_pixel_takes_neighbour_colour():
    h = flat_terrain()
    rgb = np.zeros((64, 64, 3), dtype=np.uint8)
    rgb[..., 1] = 120  # green ground
    h[32, 32] = 350
    rgb[32, 32] = (200, 200, 200)  # grey wire

    _, out_rgb, fixed = remove_artifacts(h, rgb)

    assert fixed[32, 32]
    np.testing.assert_array_equal(out_rgb[32, 32], (0, 120, 0))


def test_height_and_rgb_shapes_are_preserved():
    h = flat_terrain(size=37)
    rgb = np.zeros((37, 37, 3), dtype=np.uint8)

    out_h, out_rgb, fixed = remove_artifacts(h, rgb)

    assert out_h.shape == (37, 37)
    assert out_h.dtype == np.uint16
    assert out_rgb.shape == (37, 37, 3)
    assert out_rgb.dtype == np.uint8
    assert fixed.shape == (37, 37)
