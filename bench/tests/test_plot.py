# Written by AI (Claude, Anthropic) under the direction of Nik Jenič, who reviewed and tested it.
import json
from pathlib import Path

from bench.plot import load_results, table_e1, write_all


def _fake_result(run_id, experiment, render_type, location, pitch, mean_fps, repeat,
                 config_overrides=None):
    config = {"renderType": render_type, "strategy": "quad", "chunkSize": 128,
              "viewDistance": None, "lodMin": 0, "lodMax": 9, "fx": False,
              "culling": False, "sockets": True, "timeoutS": 600}
    config.update(config_overrides or {})
    counters = {"chunksResident": 100, "gpuBytes": 1_000_000, "jsHeapBytes": 50_000_000,
                "emptyChunks": 3, "byLod": {"1": {"bytes": 80000, "messages": 1, "n404": 0, "resident": 1},
                                             "9": {"bytes": 600000, "messages": 10, "n404": 0, "resident": 10}},
                "meshStats": {"count": 11, "parseMs": 5.0, "stitchMs": 1.0, "meshMs": 20.0, "uploadMs": 2.0},
                "frameStats": {"instancesDrawn": 1000, "chunksRendered": 100},
                "configuredAt": 1000.0,
                "net": {"ws": {"bytes": 5_000_000, "messages": 11, "firstResponseAt": 1200.0},
                        "http": {"bytes": 0, "requests": 0, "firstResponseAt": None,
                                 "phases": {"n": 0}}}}
    return {
        "run_id": run_id, "experiment": experiment, "repeat": repeat,
        "config": config,
        "view": {"location": location, "pitch": pitch},
        "quiesce": {"quiesced": True, "ms": 30000.0},
        "summary": {"frames": 1000, "mean_fps": mean_fps, "p50_ms": 1000 / mean_fps,
                    "p95_ms": 1500 / mean_fps, "p99_ms": 2000 / mean_fps,
                    "low1_fps": mean_fps / 2},
        "gpu_summary": {"frames": 0},
        "js_summary": {"frames": 0},
        "server_stats": {"count": 11, "mean_ms": 30.0, "p50_ms": 28.0, "p95_ms": 60.0},
        "raw": {"frameDtsMs": [], "gpuFrameTimesMs": [], "jsFrameTimesMs": [],
                "loadCurve": [{"t": 0, "chunksResident": 0, "wsBytes": 0, "wsMessages": 0,
                               "httpRequests": 0, "loading": 1, "initializing": True, "jsHeapBytes": 1},
                              {"t": 200, "chunksResident": 64, "wsBytes": 5_000_000, "wsMessages": 11,
                               "httpRequests": 0, "loading": 0, "initializing": False, "jsHeapBytes": 2}]},
        "counters_before": counters,
        "counters_after": counters,
        "provenance": {}, "device_lost": None, "error": None,
    }


def _make_results_dir(tmp_path: Path):
    d = tmp_path / "results"
    d.mkdir()
    i = 0
    for rt, fps in [("greedy", 300.0), ("mesh", 40.0)]:
        for rep, jitter in [(0, 0.0), (1, 5.0), (2, -5.0)]:
            r = _fake_result(f"E1-{i:08d}-r{rep}", "E1", rt, "ljubljana",
                             "horizon", fps + jitter, rep)
            (d / f"{r['run_id']}.json").write_text(json.dumps(r))
            i += 1
    return d


def test_load_results(tmp_path):
    d = _make_results_dir(tmp_path)
    results = load_results(d)
    assert len(results) == 6


def test_table_e1_medians_repeats(tmp_path):
    results = load_results(_make_results_dir(tmp_path))
    rows = table_e1(results)
    assert len(rows) == 2  # greedy + mesh, one row per (renderType, location, pitch)
    greedy = next(r for r in rows if r["renderType"] == "greedy")
    assert greedy["mean_fps"] == 300.0  # median of 295/300/305
    assert greedy["repeats"] == 3


def test_write_all_produces_figures_and_csvs(tmp_path):
    d = _make_results_dir(tmp_path)
    figs = tmp_path / "figures"
    write_all(d, figs)
    assert (figs / "report.md").exists()
    pngs = list(figs.glob("E1_*.png"))
    csvs = list(figs.glob("E1_*.csv"))
    assert pngs, "no E1 figures produced"
    assert csvs, "no E1 csv produced"


# --- gap campaign (2026-08-23) ---

def test_write_all_with_new_experiments(tmp_path):
    d = tmp_path / "results"; d.mkdir()
    def put(r): (d / f"{r['run_id']}.json").write_text(json.dumps(r))
    put(_fake_result("E6-00000001-r0", "E6", "greedy", "ljubljana", "horizon", 80.0, 0, {"chunkSize": 128}))
    put(_fake_result("E6-00000002-r0", "E6", "greedy", "ljubljana", "horizon", 90.0, 0, {"chunkSize": 256}))
    put(_fake_result("E7-00000003-r0", "E7", "greedy", "ljubljana", "horizon", 80.0, 0, {"fx": False}))
    put(_fake_result("E7-00000004-r0", "E7", "greedy", "ljubljana", "horizon", 60.0, 0, {"fx": True}))
    put(_fake_result("E8-00000005-r0", "E8", "hybrid", "ljubljana_low", "horizon", 300.0, 0))
    put(_fake_result("E9-00000006-r0", "E9", "hybrid", "ljubljana", "horizon", 300.0, 0, {"hybridNear": 9}))
    put(_fake_result("E9-00000007-r0", "E9", "hybrid", "ljubljana", "horizon", 100.0, 0, {"hybridNear": 0}))
    put(_fake_result("E10-00000008-r0", "E10", "raycast", "ljubljana", "horizon", 300.0, 0, {"viewport": [1280, 720]}))
    put(_fake_result("E10-00000009-r0", "E10", "raycast", "ljubljana", "horizon", 295.0, 0, {"viewport": [1920, 1080]}))
    put(_fake_result("E10-0000000a-r0", "E10", "raycast", "ljubljana", "horizon", 290.0, 0, {"viewport": [2560, 1440]}))
    put(_fake_result("E11-0000000b-r0", "E11", "hybrid", "ljubljana", "horizon", 200.0, 0, {"strategy": "radius", "viewDistance": 1000}))
    put(_fake_result("E11-0000000c-r0", "E11", "hybrid", "ljubljana", "horizon", 250.0, 0, {"strategy": "quad", "viewDistance": 1000}))
    put(_fake_result("E12-0000000d-r0", "E12", "hybrid", "ljubljana", "horizon", 200.0, 0, {"maxLoading": 4}))
    put(_fake_result("E12-0000000e-r0", "E12", "hybrid", "ljubljana", "horizon", 200.0, 0, {"maxLoading": 1, "sockets": False}))
    put(_fake_result("E13-0000000f-r0", "E13", "hybrid", "alps", "horizon", 200.0, 0))
    put(_fake_result("E14-00000010-r0", "E14", "mesh", "alps", "horizon", 20.0, 0))
    figs = tmp_path / "figs"
    write_all([d], figs)
    for name in ["E6_chunksize_by_type.png", "E6_chunksize_by_type.csv",
                 "E7_fx_by_type.png", "E7_fx_by_type.csv", "E8_low_view_fps.csv",
                 "E9_hybrid_near.png", "E10_resolution.png", "E11_radius_vs_quad.png",
                 "E12_max_loading.png", "E13_by_lod.png", "E13_by_lod.csv", "E14_igpu.png",
                 "report.md"]:
        assert (figs / name).exists(), name
    report = (figs / "report.md").read_text(encoding="utf-8")
    for exp in ["E6", "E7", "E8", "E9", "E10", "E11", "E12", "E13", "E14"]:
        assert f"## {exp}" in report, exp


def test_load_results_multiple_dirs_dedupes(tmp_path):
    a = tmp_path / "a"; b = tmp_path / "b"; a.mkdir(); b.mkdir()
    r = _fake_result("E1-00000001-r0", "E1", "greedy", "ljubljana", "horizon", 80.0, 0)
    (a / "x.json").write_text(json.dumps(r)); (b / "y.json").write_text(json.dumps(r))
    assert len(load_results([a, b])) == 1


def test_old_results_without_new_fields_still_plot(tmp_path):
    """Results written before 2026-08-23 lack js_summary/byLod/loadCurve/etc."""
    d = tmp_path / "results"; d.mkdir()
    r = _fake_result("E6-00000001-r0", "E6", "greedy", "ljubljana", "horizon", 80.0, 0)
    for k in ("js_summary", "server_stats"):
        r.pop(k)
    r["raw"] = {"frameDtsMs": [], "gpuFrameTimesMs": []}
    for k in ("emptyChunks", "byLod", "meshStats", "jsHeapBytes"):
        r["counters_after"].pop(k)
    r["counters_after"]["net"]["http"].pop("phases")
    (d / "x.json").write_text(json.dumps(r))
    write_all([d], tmp_path / "figs")


def test_zero_run_figures(tmp_path):
    d = _make_results_dir(tmp_path)  # E1 greedy+mesh with repeats
    for i, fps in enumerate((380.0, 395.0)):  # the noise figure needs >=2 hybrid default cells
        r = _fake_result(f"E5-0000000{i}-r{i}", "E5", "hybrid", "ljubljana", "horizon", fps, i)
        (d / f"{r['run_id']}.json").write_text(json.dumps(r))
    figs = tmp_path / "figs"
    write_all([d], figs)
    for name in ["E1_multimetric.csv", "gpu_vs_wall.png", "pacing.png",
                 "pitch_invariance.png", "noise.csv", "load_curves.png", "loc_table.csv"]:
        assert (figs / name).exists(), name
    report = (figs / "report.md").read_text(encoding="utf-8")
    assert "## E1 multi-metric table" in report
    assert "## Simplicity proxy" in report
