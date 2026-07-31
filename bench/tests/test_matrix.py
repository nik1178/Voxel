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
