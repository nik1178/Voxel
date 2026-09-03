# Written by AI (Claude, Anthropic) under the direction of Nik Jenič, who reviewed and tested it.
"""Experiment matrix: every benchmark run, deterministically enumerated.

A Run's identity is the sha1 of its canonical config+view JSON, so re-running
the driver after a crash (or a machine power-off) skips completed runs.
"""
import hashlib
import json
import math
import random
from dataclasses import dataclass
from pathlib import Path

SHUFFLE_SEED = 1337

# --- Shared tables (the JS side has its own copy of nothing: views resolve here) ---

BASE_CONFIG = {
    "renderType": "hybrid", "strategy": "quad", "chunkSize": 128,
    "viewDistance": None,  # null => Infinity client-side
    "lodMin": 0, "lodMax": 9,
    "fx": False, "culling": False, "sockets": True,
    "timeoutS": 600,
}

# y in world units (~meters). Views VERIFIED BY EYE 2026-08-19 via bench.inspect
# (the "provisional until confirmed" note that used to sit here was never acted
# on before E1 ran -- two of the three views were wrong; see below).
LOCATIONS = {
    "ljubljana": {"latLng": [46.0489, 14.5086], "y": 4000, "yaw": math.pi},
    # Was latLng [46.3783, 13.8367] -- the real-world geographic centre of the
    # Alps, which lies OUTSIDE the Slovenian dataset. Replaced with a hand-framed
    # world position inside the data, looking at actual alpine terrain.
    "alps":      {"position": [-49409, 97036], "y": 1358,
                  "yaw": math.radians(211.4), "horizonPitch": math.radians(-7.4)},
    # NE corner looking back across the whole country (raycast long-view case).
    # Was yaw pi/2, which pointed off the edge of the map into empty space.
    "ne_plain":  {"latLng": [46.6457, 16.1686], "y": 3000, "yaw": math.radians(305)},
    # Low pass over Ljubljana: the only view where hybrid's greedy near field
    # (hybridNear chunks of 128 m) fills the frame. y is ~300 m above the basin
    # (~298 m a.s.l.). VERIFY BY EYE with bench.inspect / the E8 smoke screenshot.
    "ljubljana_low": {"latLng": [46.0489, 14.5086], "y": 600, "yaw": math.pi},
}

# "horizon" is dead level unless a location overrides it with "horizonPitch"
# (needed where level flight would stare over the terrain rather than at it).
PITCHES = {"horizon": 0.0, "down": -math.pi / 2, "up": math.pi / 2}

RENDER_TYPES = ["mesh", "cubes", "planes", "greedy", "raycast", "hybrid"]
# The E1 view grid. Pinned so adding a LOCATION (ljubljana_low, 2026-08-23)
# cannot silently add E1 cells.
E1_LOCATIONS = ["ljubljana", "alps", "ne_plain"]

E2_SIZES = [1000, 900, 800, 700, 600, 512, 500, 400, 300, 256, 200, 128, 100, 64, 50, 32, 20, 16, 10]
E2_FAIL_SIZES = [8, 4, 2]        # expected to time out: (1000/size)^2 serial base loads
# E1 (2026-08-19) was a dead heat: hybrid 362.4 FPS vs raycast 364.6 FPS averaged
# over the 9 views (4 cell wins each, mesh takes alps/horizon), inside the +-3.4%
# run-to-run band. Hybrid is the pick on quality, not speed: greedy near-field.
E2_RENDER_TYPE = "hybrid"
E2_FAIL_TIMEOUT_S = 900

E1_REPEATS = 3
E4_REPEATS = 3
E5_RADIUS_VIEW_DISTANCE = 50000  # radius + Infinity hangs the tab

DEFAULT_VIEW = {"location": "ljubljana", "pitch": "horizon"}
LOW_VIEW = {"location": "ljubljana_low", "pitch": "horizon"}

# --- New-cell-only config keys (NEVER add these to BASE_CONFIG: it would
# change every existing run id). JS defaults == today's hard-coded behaviour:
#   hybridNear  int   renderer.js: how many nearest chunks hybrid draws greedy
#                     (default 9; 0 = all chunks, i.e. pure greedy via hybrid)
#   maxLoading  int   chunk-quad-strategy.js maximumChunksLoading (default 1)
#   viewport    [w,h] Playwright viewport (default 1920x1080)

E2_REPEAT_SIZES = [100, 128, 200, 256, 300]       # +r1,r2: is the peak real?
E5_REPEAT_CELLS = [  # configs whose E5 conclusion sat inside the noise band
    dict(fx=True), dict(fx=False),
    dict(strategy="quad", viewDistance=E5_RADIUS_VIEW_DISTANCE),
]
E6_SIZES = [64, 128, 200, 256, 512]
E6_MESH_SIZES = [128, 256, 512]                    # mesh @1000 would need ~10 GB
E7_TYPES = ["mesh", "cubes", "planes", "greedy", "raycast"]  # hybrid x fx is E5
E8_TYPES = ["hybrid", "raycast", "greedy"]
E9_HYBRID_NEAR = [9, 25, 81, 225, 0]               # 0 = all chunks greedy
E10_VIEWPORTS = [[1280, 720], [1920, 1080], [2560, 1440]]
E10_REPEAT_TYPES = ["raycast", "hybrid", "mesh"]   # noisy tactics get r1 at 720/1440
E11_VIEW_DISTANCES = [1000, 2000, 5000]
E12_MAX_LOADING_WS = [1, 2, 4, 8]
E12_MAX_LOADING_HTTP = [1, 4]
E14_LOCATIONS = ["ljubljana", "alps"]
E14_REPEATS = 2

# Campaign aliases for --experiments (expanded in build_matrix).
GROUPS = {
    "overnight": ["E2", "E5", "E6", "E7", "E8", "E9", "E10", "E11", "E12", "E13"],
    "igpu": ["E14"],
}


@dataclass(frozen=True)
class Run:
    run_id: str
    experiment: str
    repeat: int
    config: dict
    view: dict
    screenshot: bool = False  # always screenshot this run (E8 quality evidence)


def run_id(experiment, config, view, repeat):
    canonical = json.dumps({"config": config, "view": view}, sort_keys=True)
    digest = hashlib.sha1(canonical.encode()).hexdigest()[:8]
    return f"{experiment}-{digest}-r{repeat}"


def _mk(experiment, config, view, repeat=0, screenshot=False):
    return Run(run_id(experiment, config, view, repeat), experiment, repeat,
               config, view, screenshot)


def _e0():
    return [_mk("E0", dict(BASE_CONFIG, renderType="greedy"), dict(DEFAULT_VIEW))]


def _e1():
    runs = []
    for rt in RENDER_TYPES:
        for loc in E1_LOCATIONS:
            for pitch in PITCHES:
                for rep in range(E1_REPEATS):
                    runs.append(_mk("E1", dict(BASE_CONFIG, renderType=rt),
                                    {"location": loc, "pitch": pitch}, rep))
    return runs


def _e2():
    runs = [_mk("E2", dict(BASE_CONFIG, renderType=E2_RENDER_TYPE, chunkSize=s),
                dict(DEFAULT_VIEW)) for s in E2_SIZES]
    runs += [_mk("E2", dict(BASE_CONFIG, renderType=E2_RENDER_TYPE, chunkSize=s,
                            timeoutS=E2_FAIL_TIMEOUT_S), dict(DEFAULT_VIEW))
             for s in E2_FAIL_SIZES]
    runs += [_mk("E2", dict(BASE_CONFIG, renderType=E2_RENDER_TYPE, chunkSize=s),
                 dict(DEFAULT_VIEW), rep)
             for s in E2_REPEAT_SIZES for rep in (1, 2)]
    return runs


# At chunkSize 128 a LOD-n chunk is 128 * 2^(9-n) m: LOD 5 = 2 km (~5k chunks over
# Slovenia), LOD 6 = 1 km (~20k). Smoke-tested 2026-08-22: 6-9 crashes the tab
# (heap) at ~590 s, 8-9 is still loading at 900 s with 12k chunks resident. They
# are kept as results -- the wall IS the finding, same as 9-9 -- with the long
# timeout. Delete 7 and 8 here to save ~30 min if the boundary alone is enough.
E3_LODMIN_SLOW = {6, 7, 8}


def _e3():
    # Two sweeps that meet at the default 0-9 cell. Reading the x axis left to
    # right, quality only ever goes UP:
    #   0-X (X = 1..8): cap the detail NEAR the player, far field unchanged.
    #   X-9 (X = 2..8): full detail near the player, far field never coarser
    #                   than X -- "what if quality didn't fall off with distance".
    # lodMin 0 and 1 are the same cell as 0-9 (base chunks are LOD 1), so the
    # X-9 sweep starts at 2; 9-9 below is its endpoint.
    base = dict(BASE_CONFIG, renderType=E2_RENDER_TYPE)
    runs = [_mk("E3", dict(base, lodMax=m), dict(DEFAULT_VIEW)) for m in range(9, 0, -1)]
    runs += [_mk("E3", dict(base, lodMin=m,
                            timeoutS=900 if m in E3_LODMIN_SLOW else BASE_CONFIG["timeoutS"]),
                 dict(DEFAULT_VIEW)) for m in range(2, 9)]
    # The no-LOD extreme: base resolution everywhere. Expected to die; the
    # failure mode (timeout / device lost) IS the result.
    runs.append(_mk("E3", dict(base, lodMin=9, lodMax=9, timeoutS=900), dict(DEFAULT_VIEW)))
    return runs


def _e4():
    runs = []
    for sockets in (True, False):
        for loc in ("ljubljana", "alps"):
            for rep in range(E4_REPEATS):
                runs.append(_mk("E4", dict(BASE_CONFIG, renderType=E2_RENDER_TYPE,
                                           sockets=sockets),
                                {"location": loc, "pitch": "horizon"}, rep))
    return runs


def _e5():
    base = dict(BASE_CONFIG, renderType=E2_RENDER_TYPE)
    runs = [
        _mk("E5", dict(base, fx=True), dict(DEFAULT_VIEW)),
        _mk("E5", dict(base, fx=False), dict(DEFAULT_VIEW)),
        _mk("E5", dict(base, renderType="planes", culling=True), dict(DEFAULT_VIEW)),
        _mk("E5", dict(base, renderType="planes", culling=False), dict(DEFAULT_VIEW)),
        _mk("E5", dict(base, strategy="radius",
                       viewDistance=E5_RADIUS_VIEW_DISTANCE), dict(DEFAULT_VIEW)),
        _mk("E5", dict(base, strategy="quad",
                       viewDistance=E5_RADIUS_VIEW_DISTANCE), dict(DEFAULT_VIEW)),
    ]
    runs += [_mk("E5", dict(base, **cell), dict(DEFAULT_VIEW), rep)
             for cell in E5_REPEAT_CELLS for rep in (1, 2)]
    return runs


# E6: does the chunk-size optimum move with render type? E2 is hybrid-only;
# hybrid has the smallest per-chunk cost, so GPU-bound tactics may peak elsewhere.
def _e6():
    runs = [_mk("E6", dict(BASE_CONFIG, renderType=rt, chunkSize=s), dict(DEFAULT_VIEW))
            for rt in ("greedy", "raycast") for s in E6_SIZES]
    runs += [_mk("E6", dict(BASE_CONFIG, renderType="mesh", chunkSize=s), dict(DEFAULT_VIEW))
             for s in E6_MESH_SIZES]
    return runs


# E7: does fx compose with every tactic? fx is 4 extra full-screen passes, so
# its cost should be ~constant ms: huge for fast tactics, nil for slow ones.
def _e7():
    return [_mk("E7", dict(BASE_CONFIG, renderType=rt, fx=fx), dict(DEFAULT_VIEW))
            for rt in E7_TYPES for fx in (False, True)]


# E8: quality evidence. Screenshots of every tactic at the E1 view, and a low
# pass where hybrid's near field actually fills the frame.
def _e8():
    runs = [_mk("E8", dict(BASE_CONFIG, renderType=rt), dict(LOW_VIEW), rep, screenshot=True)
            for rt in E8_TYPES for rep in (0, 1)]
    runs += [_mk("E8", dict(BASE_CONFIG, renderType=rt), dict(DEFAULT_VIEW), screenshot=True)
             for rt in RENDER_TYPES]
    return runs


# E9: do greedy and raycast compose? Speed vs the near-detail knob.
def _e9():
    return [_mk("E9", dict(BASE_CONFIG, renderType="hybrid", hybridNear=n), dict(v), rep)
            for n in E9_HYBRID_NEAR for v in (DEFAULT_VIEW, LOW_VIEW) for rep in (0, 1)]


# E10: CPU- vs GPU-bound. Resolution should not move CPU-bound tactics.
def _e10():
    runs = [_mk("E10", dict(BASE_CONFIG, renderType=rt, viewport=vp), dict(DEFAULT_VIEW))
            for rt in RENDER_TYPES for vp in E10_VIEWPORTS]
    runs += [_mk("E10", dict(BASE_CONFIG, renderType=rt, viewport=vp), dict(DEFAULT_VIEW), 1)
             for rt in E10_REPEAT_TYPES for vp in (E10_VIEWPORTS[0], E10_VIEWPORTS[2])]
    return runs


# E11: radius vs quad at distances where radius actually converges (E5's 50 km
# radius cell is a non-result: 609 961 chunks needed). Radius = raw map/100 path.
def _e11():
    return [_mk("E11", dict(BASE_CONFIG, renderType=E2_RENDER_TYPE, strategy=st, viewDistance=vd),
                dict(DEFAULT_VIEW))
            for st in ("radius", "quad") for vd in E11_VIEW_DISTANCES]


# E12: is quiesce time throttle-bound or server-bound?
def _e12():
    base = dict(BASE_CONFIG, renderType=E2_RENDER_TYPE)
    runs = [_mk("E12", dict(base, maxLoading=n), dict(DEFAULT_VIEW)) for n in E12_MAX_LOADING_WS]
    runs += [_mk("E12", dict(base, sockets=False, maxLoading=n), dict(DEFAULT_VIEW))
             for n in E12_MAX_LOADING_HTTP]
    return runs


# E13: per-LOD / empty-chunk counter backfill, one run per location.
def _e13():
    return [_mk("E13", dict(BASE_CONFIG, renderType=E2_RENDER_TYPE),
                {"location": loc, "pitch": "horizon"}) for loc in E1_LOCATIONS]


# E14: does the ranking hold on the integrated GPU? Run with
# --results-dir bench/results-igpu --expect-gpu intel (see README).
def _e14():
    return [_mk("E14", dict(BASE_CONFIG, renderType=rt), {"location": loc, "pitch": "horizon"}, rep)
            for rt in RENDER_TYPES for loc in E14_LOCATIONS for rep in range(E14_REPEATS)]


_BUILDERS = {"E0": _e0, "E1": _e1, "E2": _e2, "E3": _e3, "E4": _e4, "E5": _e5,
             "E6": _e6, "E7": _e7, "E8": _e8, "E9": _e9, "E10": _e10,
             "E11": _e11, "E12": _e12, "E13": _e13, "E14": _e14}


def build_matrix(experiments=None):
    experiments = experiments or list(_BUILDERS)
    expanded = []
    for e in experiments:
        expanded += GROUPS.get(e, [e])
    experiments = expanded
    runs = []
    for exp in experiments:
        runs.extend(_BUILDERS[exp]())
    # Deterministic shuffle so thermal drift over a night doesn't correlate
    # with any single factor. E0 (the pilot) always runs first.
    rng = random.Random(SHUFFLE_SEED)
    e0 = [r for r in runs if r.experiment == "E0"]
    rest = [r for r in runs if r.experiment != "E0"]
    rng.shuffle(rest)
    return e0 + rest


def pending(runs, results_dir):
    results_dir = Path(results_dir)
    return [r for r in runs if not (results_dir / f"{r.run_id}.json").exists()]
