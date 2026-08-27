from bench.stats import aggregate


def test_aggregate_uniform_frames():
    # 100 frames at exactly 10ms => 100 FPS everywhere
    r = aggregate([10.0] * 100)
    assert r["frames"] == 100
    assert abs(r["mean_fps"] - 100.0) < 1e-9
    assert r["p50_ms"] == 10.0
    assert r["p95_ms"] == 10.0
    assert r["p99_ms"] == 10.0
    assert abs(r["low1_fps"] - 100.0) < 1e-9


def test_aggregate_hitches_dominate_percentiles_not_mean():
    # 99 fast frames + 1 huge hitch. mean_fps uses N/sum (Jensen-safe).
    dts = [10.0] * 99 + [510.0]
    r = aggregate(dts)
    assert abs(r["mean_fps"] - (100 * 1000.0 / (99 * 10.0 + 510.0))) < 1e-9
    assert r["p50_ms"] == 10.0
    # With exactly 1% hitching, inclusive nearest-rank p99 is the 99th of 100 sorted values (still 10.0).
    # The hitch itself is captured by low1_fps below — that's what the 1%-low metric is for.
    assert r["p99_ms"] == 10.0
    # low1: mean FPS of the slowest 1% (here: the single 510ms frame)
    assert abs(r["low1_fps"] - (1000.0 / 510.0)) < 1e-9


def test_aggregate_empty():
    assert aggregate([]) == {"frames": 0}


def test_percentile_nearest_rank():
    r = aggregate([float(i) for i in range(1, 101)])  # 1..100 ms
    assert r["p50_ms"] == 50.0
    assert r["p95_ms"] == 95.0
    assert r["p99_ms"] == 99.0
