# Terrain Preprocessing: Gap Filling, Artifact Removal, Quadtree Rebuild

Date: 2026-07-20
Status: Approved (design)

## Problem

Three defects in the served terrain, all traceable to the base-level `.hmap` data:

1. **Checkerboard ground.** `ChunkQuadBuilder.remove_artifacts` runs at request time on
   delta-LOD chunks. For `lod > 1`, `binary_to_heightmap` only populates TR/BL/BR; the TL
   quadrant (even row, even col) is left as zeros because the client stitches it from the
   parent chunk. The filter reads those zeros as neighbours at height 0. BR pixels have 4
   TL neighbours (all four diagonals), TR and BL have 2, so BR trips the `diffs >= 5`
   threshold far more often. Measured on synthetic terrain with sd=5 noise: TR 54%, BL 53%,
   BR 83% of pixels corrupted. One quadrant of every 2x2 cell sinks, producing the
   checkerboard.

2. **Pillars and powerline strips.** The converter takes the top-most lidar return per cell.
   Wires, poles and pylons therefore become terrain.

3. **Water renders as pits.** Water absorbs the 1064nm pulse, so rivers and lakes produce no
   returns. Those cells are `height = 0` and the mesher draws a floor-level crater.

Plus 4 missing base chunks (`511_35`, `511_36`, `511_41`, `511_42`) whose LAZ files exist but
were never converted.

## Measurements

Taken from the live dataset, not assumed.

- 14,731 LAZ tiles in `E:/gkot`; 14,727 `.hmap` files in `public/map/100`. 4 missing, 0
  orphans, 0 wrong-size files.
- Point counts are large: `GKOT_421_108` has 72.9M points, `GKOT_511_35` has 22.4M. The
  converter's per-point Python dict loop is the likely reason those 4 were never completed.
- `X.min()` equals `tile_x * 1000` exactly on the tiles checked, so existing chunks are not
  misaligned. Deriving origin from the filename is still preferred as it removes the
  failure mode for partial edge tiles.
- Nodata across a 120-chunk random sample: mean 1.0%; 7 chunks >1%, 5 >5%, 2 >20%.

### Water vs coverage gap

Water surfaces are level, so the two banks facing each other across a hole sit at the same
elevation. Unsurveyed terrain continues across the gap, so the far bank does not match.
Per-row nodata runs, restricted to runs >= 20px with data on both sides:

| Tile | Median width | Bank diff median | Bank diff p90 | Verdict |
|---|---|---|---|---|
| `555_161` | 279px | 0.0m | 4.0m | Water |
| `561_145` | 245px | 0.0m | 0.4m | Water |
| `544_85` | 51px | 0.0m | 1.0m | Water |
| `512_161` | 42px | 0.0m | 11m | Water |
| `506_36` | 57px | 5.0m | 11m | Mixed |
| `486_157` | 200px | 28m | 43m | Coverage gap |

`486_157`'s W and S neighbour tiles do not exist — it is the Italian border.

**Width does not discriminate.** `555_161` is 279px-wide water; `486_157` is a 200px-wide
gap. A width cap would fill the gap and reject the lake. Bank symmetry is the signal.

### Where bank symmetry is not enough

Bank symmetry classifies the tiles above correctly but has a floor, found during
implementation. The gap along the *eastern* edge of `486_157` measures a median bank
difference of 0.0m and p90 4.0m — identical to a lake — because the terrain either side
happens to sit at the same elevation. The 28m figure above comes from the western wedge of
the same tile, not this strip.

That strip only becomes measurable at all because `read_with_margin` pulls a far bank from
`487_157`, which does exist. Two attempts to fix this within the bank test failed:
requiring per-pixel run evidence changed nothing, and requiring evidence on both axes
dropped the `555_161` lake from 39% filled to 20%, leaving a pit in the middle of a lake.

The signal that does work is independent of height: **a survey gap runs off the edge of the
survey, into a tile that was never flown. Water stops at a shoreline, not at a tile
boundary.** Neighbour-tile existence is checked directly rather than inferred from margin
contents, since a neighbour that exists can still be nodata where a lake continues into it.

With the veto: `486_157` fills 0.6% (was 13.1%), `555_161` still fills 39.1%, and the six
other measured tiles are unchanged.

## Design

### Pipeline

Per base chunk, in order:

```
decode uint8x5 -> (rgb uint8, height uint16)
  -> classify nodata components (water | gap)
  -> fill water components (harmonic inpaint from rim, flat water colour)
  -> remove artifacts (two-pass top-hat)
  -> re-encode
  -> feed into quadtree
```

Water fill runs before artifact removal: it shrinks the nodata region the morphological
opening has to route around.

### Script 1: `python/convert_missing_chunks.py`

Enumerates `E:/gkot/GKOT_{x}_{z}.laz`, diffs against `public/map/100/{x}_{z}.hmap`, converts
only what is absent. Reuses `ChunkBinaryManager.heightmap_to_binary` so output is
byte-identical in format to existing chunks.

Two changes to the conversion itself:

- **Vectorized max-return selection.** `np.lexsort((Z, cell_index))`, then take the last
  entry of each cell group, replacing the per-point Python dict loop.
- **Origin from filename** (`tile_x * 1000`), not `X.min()`.

Idempotent and resumable. `--dry-run` lists what it would convert.

### Script 2: `python/build_quad_tree.py`

Replaces `createQuadTree.py`. Keeps the existing sparse recursive structure and the
subsample-for-parent scheme — that is structurally required by the delta format, since the
client stitches TL from the parent, so parent pixels must be exactly the child's TL pixels
and not an average.

New: at the base level each chunk is decoded, passed through gap filling and artifact
removal, and re-encoded before entering the pyramid. Filtering once at full resolution means
every LOD inherits clean data.

Cleaned base data is **not persisted**. `public/map/100/` stays as the raw source of truth;
cleaning happens in memory during the build. Saves ~73GB.

`--preview x z` renders before/after PNGs plus a difference map for a single chunk, for
verification before the 14k-file batch run.

### Module: `python/artifact_filter.py`

Standalone and independently testable.

**Artifact removal — two-pass grayscale top-hat:**

```
pass A: opened = grey_opening(H, 3);  spike = H - opened;  fix where spike > 3m
pass B: opened = grey_opening(H, 5);  spike = H - opened;  fix where spike > 15m
```

Pass B's structuring element must be strictly wider than pass A's. Opening is idempotent for
a given SE, so a second pass at the same `k` with a higher threshold flags a subset of what
pass A already fixed — it would be a no-op.

A pixel survives opening only if the structuring element fits inside its feature, so a 1px
powerline of any length or orientation and a 1px pillar both vanish, while wide plateaus
(buildings, terrain) are untouched. Pass B catches pylons, which are wider but much taller:
up to 2px wide, standing more than 15m above their surroundings.

**Shape gate.** The top-hat alone removes every thin positive feature, and in steep forest a
conifer crown is one — it stands ~20m above the canopy gaps around it, exactly like a wire.
No height threshold separates them: sweeping pass A from 3m to 12m only takes tile 516_82
from 28.6% of pixels modified to 18.0%, while powerline recall stays flat. Height is not the
discriminating variable.

Shape is, and it matches what was actually asked for — single-cell pillars and long strips.
A tree crown is neither. Components of the mask are kept only if they are at most
MAX_PILLAR_PX pixels (a pillar) or span at least MIN_STRIP_SPAN pixels at a mean thickness
of at most MAX_STRIP_THICKNESS (a strip).

Thickness is measured as pixel count over span, not bounding-box aspect ratio. A 45-degree
wire has a square bounding box, so an aspect test rejects exactly the diagonal powerlines
this is meant to catch. Pixel count over span is orientation independent: a line of any
angle gives ~1, a compact blob gives ~span.

Fixed pixels take height from `opened` and RGB from their nearest untouched neighbour, so a
lowered powerline pixel does not leave a wire-coloured streak on the ground.

**Nodata is excluded.** Erosion takes a local minimum, so a nodata cell at height 0 would
drag the opened surface to 0 across its neighbourhood, flag surrounding real terrain as
spikes, and delete it — the same failure mode as the checkerboard bug. Nodata is filled with
a high sentinel before erosion and is never itself modified.

**Chunk borders read a 3px margin** from the four neighbouring `.hmap` files via `np.memmap`,
reading edge slices only. Without it, wire stubs survive along every chunk seam, producing a
faint grid.

### Module: `python/water_fill.py`

1. Label nodata connected components (`scipy.ndimage.label`).
2. For each component, sample horizontal and vertical runs and compute the median and p90
   height difference between opposing banks. Runs terminating at the array edge measure
   nothing and are skipped.
3. Classify as water if median <= 2m and p90 <= 8m. Otherwise coverage gap.
4. Veto any component touching a chunk edge whose neighbouring tile does not exist.
5. Water components: harmonic (Laplace) inpaint from the rim. Initialised from the nearest
   known value, which is already exact for level water and follows a river's downstream
   gradient, then relaxed to remove nearest-neighbour seams. RGB set to a single tunable
   water constant — interpolating rim colour would smear grass green across a lake.
6. Coverage gaps: left untouched.

Errors lean toward not filling. A false leave is a pit, which is today's behaviour; a false
fill is invented terrain, which the user explicitly scoped out.

Thresholds are module constants, tunable without touching call sites.

### Also in scope

Delete `ChunkQuadBuilder.remove_artifacts` and its call at `chunk_quad_builder.py:164`.
Cleaning at base level makes it redundant, and leaving it in place keeps the checkerboard.

### Dependencies

Add `scipy` — `ndimage.grey_opening` for the top-hat passes, `ndimage.label` for nodata
component classification, `ndimage.distance_transform_edt` for nearest-donor colour repair
and inpaint initialisation. Add `pillow` for `--preview` rendering and `pytest` for the test
suite. Create `requirements.txt` pinning the deps in use.

## Verification

- Unit tests for `artifact_filter` and `water_fill` on synthetic fixtures: a known pillar, a
  known diagonal wire, a level-banked hole, a sloped-bank hole, a nodata cell adjacent to
  real terrain.
- A regression test for the checkerboard: assert that filtering does not preferentially
  modify any one 2x2 quadrant.
- `--preview` on a real tile with visible powerlines, reviewed before the batch run.
- After the pyramid rebuild, load the map in the browser and confirm the ground is flat.

## Measured results

Verified against real chunks, not fixtures.

**Artifact removal.** On `543_113` the removed set includes four parallel transmission
conductors running the full height of the chunk, wire-grey RGB(125,125,120), dropped by a
mean of 22.6m (max 38m).

Effect of the shape gate, percentage of pixels modified:

| Tile | Terrain | Ungated | Gated | Powerline px kept |
|---|---|---|---|---|
| `516_82` | steep dense forest | 28.58% | **1.17%** | 0 |
| `489_83` | forest | 22.61% | **2.44%** | 0 |
| `543_113` | powerlines | 3.56% | **1.94%** | **2322** |
| `471_94` | mixed | 1.76% | 1.12% | 797 |
| `524_122` | open, flat | 0.82% | 0.50% | 85 |
| `555_161` | lake and wires | 1.18% | 0.64% | 2339 |

The gate removes the forest damage entirely while retaining every powerline pixel.

**Water fill.** `555_161` fills 39.1% of 40.5% nodata, correctly rendering a lake with its
causeway preserved. `486_157` fills 0.6% of 36.3%, correctly leaving the survey gap.

**Converter.** `511_35` converted in 41s (22.4M points, 100% cell coverage) versus hours for
the dict loop. Seam continuity against existing neighbours is median 1.0m / p95 7–11m,
matching the 1.0m / 7–8m measured between two pre-existing chunks, which confirms alignment.

## Known risks and limits

- **Compact multi-pixel spikes now survive, including pylon masts.** This is the deliberate
  trade the shape gate makes: a pylon mast and a conifer crown are shape-indistinguishable,
  and sparing both is worth far more than removing both. The conductors between pylons are
  still removed, which is the visually dominant artifact. This also resolves the church
  steeple risk flagged earlier — a steeple is compact, so the gate spares it.
- **Residual forest effect is ~1–2.5% of pixels**, mostly genuine isolated spikes.
- **The survey-edge veto only catches gaps that touch a survey boundary.** A flat-banked gap
  entirely interior to a covered region would still fill. The measured data says the large
  holes are all at boundaries, and `--preview` is the check for exceptions.
- **Unclassifiable components are left as pits.** A component with fewer than four
  measurable runs — for instance one confined to a chunk corner — has too little evidence to
  judge. `555_161` retains 1.4% nodata for this reason, visible as a block in one corner.
- **Cross-tile water consistency.** A lake spans tiles and each is filled independently.
  Because water is level the results should agree closely, but seams are possible.
- **A cell at exactly 0m elevation is indistinguishable from nodata.** This is inherent to
  the existing on-disk format, not introduced here, but it matters on the coast.

## Follow-up, not in scope

Coverage gaps still render as pits. Filling them is wrong — `486_157` would fabricate 200px
of terrain across a 28m elevation change. The correct fix is the client not emitting quads
for nodata cells, a change to `chunk-mesher.js` and the shader. Tracked separately.
