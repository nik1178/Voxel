# Written by AI (Claude, Anthropic) under the direction of Nik Jenič, who reviewed and tested it.
"""Frame-time aggregation. Pure functions, no I/O."""
import math


def _percentile_nearest_rank(sorted_vals, p):
    # Nearest-rank: smallest value with at least p% of data at or below it.
    k = max(1, math.ceil(p / 100.0 * len(sorted_vals)))
    return sorted_vals[k - 1]


def aggregate(frame_dts_ms):
    n = len(frame_dts_ms)
    if n == 0:
        return {"frames": 0}
    total = sum(frame_dts_ms)
    s = sorted(frame_dts_ms)
    # "1% low FPS": mean FPS over the slowest 1% of frames (at least one frame).
    k = max(1, math.ceil(n / 100.0))
    worst = s[-k:]
    return {
        "frames": n,
        "mean_fps": 1000.0 * n / total,
        "p50_ms": _percentile_nearest_rank(s, 50),
        "p95_ms": _percentile_nearest_rank(s, 95),
        "p99_ms": _percentile_nearest_rank(s, 99),
        "low1_fps": 1000.0 * k / sum(worst),
    }
