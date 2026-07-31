import json
from pathlib import Path

from bench.plot import load_results, table_e1, write_all


def _fake_result(run_id, experiment, render_type, location, pitch, mean_fps, repeat):
    return {
        "run_id": run_id, "experiment": experiment, "repeat": repeat,
        "config": {"renderType": render_type, "strategy": "quad", "chunkSize": 128,
                   "viewDistance": None, "lodMin": 0, "lodMax": 9, "fx": False,
                   "culling": False, "sockets": True, "timeoutS": 600},
        "view": {"location": location, "pitch": pitch},
        "quiesce": {"quiesced": True, "ms": 30000.0},
        "summary": {"frames": 1000, "mean_fps": mean_fps, "p50_ms": 1000 / mean_fps,
                    "p95_ms": 1500 / mean_fps, "p99_ms": 2000 / mean_fps,
                    "low1_fps": mean_fps / 2},
        "gpu_summary": {"frames": 0},
        "raw": {"frameDtsMs": [], "gpuFrameTimesMs": []},
        "counters_before": {"chunksResident": 100, "gpuBytes": 1_000_000,
                            "net": {"ws": {"bytes": 5_000_000}, "http": {"bytes": 0}}},
        "counters_after": {"chunksResident": 100, "gpuBytes": 1_000_000,
                           "net": {"ws": {"bytes": 5_000_000}, "http": {"bytes": 0}}},
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
