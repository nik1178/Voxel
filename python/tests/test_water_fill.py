import numpy as np

from python.chunk_io import NODATA
from python.water_fill import WATER_COLOUR, fill_water


def sloping_terrain(size=120, drop=60):
    """Terrain descending along the column axis."""
    cols = np.linspace(400, 400 - drop, size)
    return np.tile(cols, (size, 1)).astype(np.uint16)


def test_fills_level_banked_hole():
    """A river: banks on both sides sit at the same elevation."""
    h = np.full((120, 120), 300, dtype=np.uint16)
    h[:, 40:70] = NODATA  # 30px wide channel through level ground

    out, _, filled = fill_water(h)

    assert filled[:, 40:70].all()
    assert (out[:, 40:70] == 300).all()
    assert not (out == NODATA).any()


def test_leaves_sloped_banked_hole_alone():
    """A survey gap: terrain continues across, so the banks disagree."""
    h = sloping_terrain()
    h[:, 40:70] = NODATA  # hole spans a ~15m elevation change

    out, _, filled = fill_water(h)

    assert not filled.any()
    assert (out[:, 40:70] == NODATA).all(), "must not fabricate terrain across a gap"


def test_fills_river_and_leaves_gap_in_the_same_chunk():
    h = np.full((120, 120), 300, dtype=np.uint16)
    h[:, 10:25] = NODATA  # level-banked river
    h[:, 60:90] = NODATA
    h[:, 90:] = 380  # far side 80m higher -> that second hole is a gap

    out, _, filled = fill_water(h)

    assert filled[:, 10:25].all()
    assert not filled[:, 60:90].any()
    assert (out[:, 10:25] == 300).all()
    assert (out[:, 60:90] == NODATA).all()


def test_fills_scattered_dropouts_regardless():
    h = np.full((120, 120), 300, dtype=np.uint16)
    rng = np.random.default_rng(0)
    rows = rng.integers(1, 119, 40)
    cols = rng.integers(1, 119, 40)
    h[rows, cols] = NODATA

    out, _, filled = fill_water(h)

    assert filled[rows, cols].all()
    assert (out[rows, cols] == 300).all()


def test_filled_water_never_written_as_nodata():
    """A filled value of 0 would be re-read as a hole on the next pass."""
    h = np.full((60, 60), 1, dtype=np.uint16)
    h[:, 20:40] = NODATA

    out, _, filled = fill_water(h)

    assert filled.any()
    assert not (out[filled] == NODATA).any()


def test_filled_water_gets_water_colour():
    h = np.full((120, 120), 300, dtype=np.uint16)
    rgb = np.zeros((120, 120, 3), dtype=np.uint8)
    rgb[..., 1] = 120
    h[:, 40:70] = NODATA

    _, out_rgb, filled = fill_water(h, rgb)

    assert (out_rgb[filled] == np.array(WATER_COLOUR, dtype=np.uint8)).all()
    assert (out_rgb[~filled][..., 1] == 120).all()


def test_river_fill_follows_a_downstream_gradient():
    """A sloping river should not be flattened to one level."""
    h = np.zeros((120, 120), dtype=np.uint16)
    for row in range(120):
        h[row, :] = 300 - row // 4  # banks drop along the river's length
    h[:, 50:60] = NODATA

    out, _, filled = fill_water(h)

    assert filled[:, 50:60].all()
    assert out[10, 55] > out[110, 55], "fill should descend with the banks"
    for row in (10, 60, 110):
        assert abs(int(out[row, 55]) - int(h[row, 49])) <= 1


def test_survey_edge_veto_blocks_a_level_banked_gap():
    """The case the bank test cannot see.

    Tile 486_157's eastern gap measures a median bank difference of 0.0m, the same
    as a lake, because the terrain either side sits at the same elevation. Only the
    fact that the neighbouring tile was never surveyed distinguishes them.
    """
    # Modelled as the pipeline actually sees it: the chunk ends at column 110 and
    # columns 111+ are margin read from the neighbouring tile. That margin is what
    # supplies a far bank and makes the gap measurable at all -- and it measures
    # level, because the terrain either side is at the same elevation.
    h = np.full((120, 120), 300, dtype=np.uint16)
    h[:, 90:111] = NODATA

    _, _, filled_without = fill_water(h)

    veto = np.zeros(h.shape, dtype=bool)
    veto[:, 110] = True  # chunk's last column; the tile beyond it was never surveyed
    _, _, filled_with = fill_water(h, veto=veto)

    assert filled_without.any(), "precondition: the bank test alone would fill this"
    assert not filled_with.any(), "a component touching a survey edge must be left"


def test_veto_does_not_block_water_away_from_the_edge():
    h = np.full((120, 120), 300, dtype=np.uint16)
    h[40:70, 40:70] = NODATA  # interior lake

    veto = np.zeros(h.shape, dtype=bool)
    veto[:, -1] = True

    _, _, filled = fill_water(h, veto=veto)

    assert filled[40:70, 40:70].all()


def test_no_nodata_is_a_no_op():
    h = np.full((40, 40), 300, dtype=np.uint16)
    out, _, filled = fill_water(h)

    assert not filled.any()
    np.testing.assert_array_equal(out, h)
