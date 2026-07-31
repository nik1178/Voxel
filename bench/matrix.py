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

# y in world units (~meters). yaw values are provisional until E0 screenshots
# confirm each view shows what it should (adjust here only).
LOCATIONS = {
    "ljubljana": {"latLng": [46.0489, 14.5086], "y": 4000, "yaw": math.pi},
    "alps":      {"latLng": [46.3783, 13.8367], "y": 5000, "yaw": math.pi},
    # NE corner looking back across the whole country (raycast long-view case)
    "ne_plain":  {"latLng": [46.6457, 16.1686], "y": 3000, "yaw": math.pi / 2},
}

PITCHES = {"horizon": 0.0, "down": -math.pi / 2, "up": math.pi / 2}

RENDER_TYPES = ["mesh", "cubes", "planes", "greedy", "raycast", "hybrid"]

E2_SIZES = [1000, 900, 800, 700, 600, 512, 500, 400, 300, 256, 200, 128, 100, 64, 50, 32, 20, 16, 10]
E2_FAIL_SIZES = [8, 4, 2]        # expected to time out: (1000/size)^2 serial base loads
E2_RENDER_TYPE = "greedy"        # PROVISIONAL: set to the E1 winner after E1 review
E2_FAIL_TIMEOUT_S = 900

E1_REPEATS = 3
E4_REPEATS = 3
E5_RADIUS_VIEW_DISTANCE = 50000  # radius + Infinity hangs the tab

DEFAULT_VIEW = {"location": "ljubljana", "pitch": "horizon"}


@dataclass(frozen=True)
class Run:
    run_id: str
    experiment: str
    repeat: int
    config: dict
    view: dict


def run_id(experiment, config, view, repeat):
    canonical = json.dumps({"config": config, "view": view}, sort_keys=True)
    digest = hashlib.sha1(canonical.encode()).hexdigest()[:8]
    return f"{experiment}-{digest}-r{repeat}"


def _mk(experiment, config, view, repeat=0):
    return Run(run_id(experiment, config, view, repeat), experiment, repeat, config, view)


def _e0():
    return [_mk("E0", dict(BASE_CONFIG, renderType="greedy"), dict(DEFAULT_VIEW))]


def _e1():
    runs = []
    for rt in RENDER_TYPES:
        for loc in LOCATIONS:
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
    return runs


def _e3():
    runs = [_mk("E3", dict(BASE_CONFIG, renderType=E2_RENDER_TYPE, lodMax=m),
                dict(DEFAULT_VIEW)) for m in range(9, 0, -1)]
    # The no-LOD extreme: base resolution everywhere. Expected to die; the
    # failure mode (timeout / device lost) IS the result.
    runs.append(_mk("E3", dict(BASE_CONFIG, renderType=E2_RENDER_TYPE,
                               lodMin=9, lodMax=9, timeoutS=900), dict(DEFAULT_VIEW)))
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
    return runs


_BUILDERS = {"E0": _e0, "E1": _e1, "E2": _e2, "E3": _e3, "E4": _e4, "E5": _e5}


def build_matrix(experiments=None):
    experiments = experiments or list(_BUILDERS)
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
