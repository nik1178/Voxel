import json
from pathlib import Path

from bench.matrix import build_matrix, pending, run_id, BASE_CONFIG, E2_SIZES


def test_run_id_is_deterministic_and_config_sensitive():
    cfg = dict(BASE_CONFIG)
    view = {"location": "ljubljana", "pitch": "horizon"}
    a = run_id("E1", cfg, view, 0)
    b = run_id("E1", cfg, view, 0)
    assert a == b
    assert a.startswith("E1-") and a.endswith("-r0")
    cfg2 = dict(cfg, chunkSize=cfg["chunkSize"] + 2)
    assert run_id("E1", cfg2, view, 0) != a


def test_all_chunk_sizes_even():
    for s in E2_SIZES:
        assert s % 2 == 0
    for run in build_matrix():
        assert run.config["chunkSize"] % 2 == 0


def test_matrix_shapes():
    e1 = [r for r in build_matrix(["E1"])]
    # 6 render types x 3 locations x 3 pitches x 3 repeats
    assert len(e1) == 6 * 3 * 3 * 3
    e0 = build_matrix(["E0"])
    assert len(e0) == 1
    # E0 comes first even in a full shuffled matrix
    assert build_matrix()[0].experiment == "E0"


def test_matrix_deterministic_order():
    assert [r.run_id for r in build_matrix()] == [r.run_id for r in build_matrix()]


def test_radius_runs_have_finite_view_distance():
    for run in build_matrix():
        if run.config["strategy"] == "radius":
            assert run.config["viewDistance"] is not None


def test_pending_skips_existing(tmp_path: Path):
    runs = build_matrix(["E1"])
    done = runs[3]
    (tmp_path / f"{done.run_id}.json").write_text(json.dumps({"run_id": done.run_id}))
    left = pending(runs, tmp_path)
    assert len(left) == len(runs) - 1
    assert all(r.run_id != done.run_id for r in left)


# --- gap campaign (2026-08-23) ---
import glob
import os

from bench.matrix import GROUPS, LOCATIONS, E2_REPEAT_SIZES, E5_REPEAT_CELLS


def test_existing_run_ids_unchanged():
    """The sha1 ids on disk must be reproduced exactly by the current matrix
    (BASE_CONFIG gained no keys; E1-E5 cells untouched)."""
    on_disk = set()
    for d in ("bench/results", "bench/results-full-sweep",
              "bench/results-e4-before-slash-fix"):
        on_disk.update(os.path.basename(p)[:-5]
                       for p in glob.glob(os.path.join(d, "E[0-5]-*.json")))
    assert len(on_disk) > 200, "expected the committed E0-E5 results on disk"
    enumerated = {r.run_id for r in build_matrix(["E0", "E1", "E2", "E3", "E4", "E5"])}
    missing = on_disk - enumerated
    assert not missing, f"matrix no longer enumerates {sorted(missing)[:5]}..."


def test_new_experiment_shapes():
    assert len(build_matrix(["E6"])) == 2 * 5 + 3          # greedy/raycast x5 sizes, mesh x3
    assert len(build_matrix(["E7"])) == 5 * 2              # 5 types x fx off/on
    e8 = build_matrix(["E8"])
    assert len(e8) == 3 * 2 + 6                            # low view x3 types x2 reps + 6 E1 types
    assert all(r.screenshot for r in e8)
    assert len(build_matrix(["E9"])) == 5 * 2 * 2          # hybridNear x 2 views x 2 reps
    e10 = build_matrix(["E10"])
    assert len(e10) == 6 * 3 + 3 * 2                       # 6 types x 3 viewports (+ r1 for 3 fast types at 720/1440)
    assert all(isinstance(r.config["viewport"], list) for r in e10)
    assert len(build_matrix(["E11"])) == 2 * 3
    assert len(build_matrix(["E12"])) == 4 + 2
    assert len(build_matrix(["E13"])) == 3
    assert len(build_matrix(["E14"])) == 6 * 2 * 2


def test_repeat_extensions_reuse_existing_ids():
    e2 = build_matrix(["E2"])
    for s in E2_REPEAT_SIZES:
        reps = sorted(r.repeat for r in e2 if r.config["chunkSize"] == s)
        assert reps == [0, 1, 2]
    e5 = build_matrix(["E5"])
    assert sum(1 for r in e5 if r.repeat > 0) == 2 * len(E5_REPEAT_CELLS)


def test_groups_expand():
    ov = build_matrix(["overnight"])
    assert {r.experiment for r in ov} == set(GROUPS["overnight"])
    assert {r.experiment for r in build_matrix(["igpu"])} == {"E14"}


def test_new_keys_only_in_new_cells():
    for r in build_matrix(["E0", "E1", "E2", "E3", "E4", "E5"]):
        for k in ("hybridNear", "maxLoading", "viewport"):
            assert k not in r.config


def test_ljubljana_low_view():
    assert LOCATIONS["ljubljana_low"]["y"] < LOCATIONS["ljubljana"]["y"]
