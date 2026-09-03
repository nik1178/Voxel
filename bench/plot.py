# Written by AI (Claude, Anthropic) under the direction of Nik Jenič, who reviewed and tested it.
"""Derive figures + CSV tables + report.md from bench/results/*.json.

Reading results NEVER triggers benchmarking. Every figure has a CSV twin.
Run: venv\\Scripts\\python -m bench.plot [--results-dir ...] [--figures-dir ...]
"""
import argparse
import csv
import json
import statistics
import zlib
from collections import defaultdict
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

# --- dataviz: fixed-order categorical palette (validated, see dataviz skill) ---
CAT_COLORS = [
    "#2a78d6",  # blue
    "#eb6834",  # orange
    "#1baf7a",  # aqua
    "#eda100",  # yellow
    "#e87ba4",  # magenta
    "#008300",  # green
    "#4a3aa7",  # violet
    "#e34948",  # red
]
INK_PRIMARY = "#0b0b0b"
INK_SECONDARY = "#52514e"
INK_MUTED = "#898781"
GRIDLINE = "#e1e0d9"
SURFACE = "#fcfcfb"
STATUS_CRITICAL = "#d03b3b"

RENDER_TYPE_ORDER = ["mesh", "cubes", "planes", "greedy", "raycast", "hybrid"]
PITCH_ORDER = ["horizon", "down", "up"]
DATASET_BYTES = 74_825_000_000  # clean pyramid on disk, measured 2026-08-22 (was "~70 GiB")


def _color_for(label, order):
    """Fixed-order categorical color assignment (never cycled ad hoc).
    Falls back to a stable hash (crc32, not Python's per-process-salted
    hash()) so a label outside `order` still gets the same color across
    regenerations."""
    try:
        idx = order.index(label)
    except ValueError:
        idx = zlib.crc32(str(label).encode()) % len(CAT_COLORS)
    return CAT_COLORS[idx % len(CAT_COLORS)]


def _median_min_max(vals):
    vals = [v for v in vals if v is not None]
    if not vals:
        return None, None, None
    return statistics.median(vals), min(vals), max(vals)


def _style_axes(ax):
    ax.set_facecolor(SURFACE)
    ax.figure.set_facecolor(SURFACE)
    ax.grid(True, color=GRIDLINE, linewidth=0.8, zorder=0)
    ax.set_axisbelow(True)
    for spine in ("top", "right"):
        ax.spines[spine].set_visible(False)
    for spine in ("left", "bottom"):
        ax.spines[spine].set_color(INK_MUTED)
    ax.tick_params(colors=INK_SECONDARY)
    ax.xaxis.label.set_color(INK_PRIMARY)
    ax.yaxis.label.set_color(INK_PRIMARY)
    ax.title.set_color(INK_PRIMARY)


def _human_bytes(n):
    if n is None:
        return "n/a"
    n = float(n)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if abs(n) < 1024.0:
            return f"{n:.1f} {unit}"
        n /= 1024.0
    return f"{n:.1f} PB"


def load_results(results_dirs):
    """Load every *.json under one dir or a list of dirs; first run_id wins.

    Several dirs lets a campaign dir borrow baselines from another (E1 medians
    in bench/results for the E14 iGPU comparison, the hybrid E2 curve for E6).
    """
    if isinstance(results_dirs, (str, Path)):
        results_dirs = [results_dirs]
    out, seen = [], set()
    for d in results_dirs:
        for p in sorted(Path(d).glob("*.json")):
            r = json.loads(p.read_text(encoding="utf-8"))
            rid = r.get("run_id")
            if rid in seen:
                continue
            seen.add(rid)
            out.append(r)
    return out


def _median_rows(results, key_fn, metrics=("mean_fps", "p50_ms", "p95_ms", "p99_ms", "low1_fps")):
    """Group results, take the median across repeats for each metric.

    Amendment (design spec: "median across repeats, min-max as error band"):
    also stores <metric>_min / <metric>_max across the same repeat set, so
    every figure that plots a median can draw a min-max error band.
    Also carries failure bookkeeping (failed/device_lost) so E2/E3 can
    annotate timed-out or crashed cells without a second pass over results.
    """
    groups = defaultdict(list)
    for r in results:
        groups[key_fn(r)].append(r)
    rows = []
    # json key: group tuples may mix None with numbers (E5 viewDistance) —
    # plain tuple sort would TypeError.
    for key, rs in sorted(groups.items(), key=lambda kv: json.dumps(kv[0])):
        row = dict(key)
        row["repeats"] = len(rs)
        row["quiesced_all"] = all((r["quiesce"] or {}).get("quiesced") for r in rs)
        row["quiesce_ms"] = statistics.median(
            (r["quiesce"] or {}).get("ms", 0) for r in rs)
        row["quiesce_ms_min"] = min((r["quiesce"] or {}).get("ms", 0) for r in rs)
        row["quiesce_ms_max"] = max((r["quiesce"] or {}).get("ms", 0) for r in rs)
        for m in metrics:
            vals = [r["summary"][m] for r in rs if r["summary"].get("frames")]
            row[m] = statistics.median(vals) if vals else None
            row[f"{m}_min"] = min(vals) if vals else None
            row[f"{m}_max"] = max(vals) if vals else None
        row["failed"] = sum(1 for r in rs if r.get("error"))
        row["error_msgs"] = "; ".join(
            sorted({r["error"] for r in rs if r.get("error")}))
        row["device_lost_any"] = any(r.get("device_lost") for r in rs)
        rows.append(row)
    return rows


def table_e1(results):
    e1 = [r for r in results if r["experiment"] == "E1"]
    return _median_rows(e1, lambda r: (
        ("renderType", r["config"]["renderType"]),
        ("location", r["view"]["location"]),
        ("pitch", r["view"]["pitch"]),
    ))


def table_e2(results):
    e2 = [r for r in results if r["experiment"] == "E2"]
    return _median_rows(e2, lambda r: (("chunkSize", r["config"]["chunkSize"]),))


def table_e3(results):
    e3 = [r for r in results if r["experiment"] == "E3"]
    return _median_rows(e3, lambda r: (
        ("lodMin", r["config"]["lodMin"]), ("lodMax", r["config"]["lodMax"]),
    ))


def table_e4(results):
    e4 = [r for r in results if r["experiment"] == "E4"]
    return _median_rows(e4, lambda r: (
        ("sockets", r["config"]["sockets"]), ("location", r["view"]["location"]),
    ))


def table_e5(results):
    e5 = [r for r in results if r["experiment"] == "E5"]
    return _median_rows(e5, lambda r: (
        ("renderType", r["config"]["renderType"]), ("strategy", r["config"]["strategy"]),
        ("fx", r["config"]["fx"]), ("culling", r["config"]["culling"]),
        ("viewDistance", r["config"]["viewDistance"]),
    ))


def _write_csv(rows, path):
    if not rows:
        return
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)


def _errbars(rows, metric):
    """Asymmetric yerr = [median-min, max-median], clipped at 0 (repeat noise
    band; single-repeat groups collapse to a zero-height band)."""
    lo, hi = [], []
    for r in rows:
        med = r.get(metric)
        mn = r.get(f"{metric}_min")
        mx = r.get(f"{metric}_max")
        if med is None or mn is None or mx is None:
            lo.append(0)
            hi.append(0)
        else:
            lo.append(max(0.0, med - mn))
            hi.append(max(0.0, mx - med))
    return [lo, hi]


def _fail_group_counts(rows):
    """Rows that never quiesced or had an error/device-lost repeat."""
    return sum(1 for r in rows if r["failed"] or r["device_lost_any"] or not r["quiesced_all"])


# ==========================================================================
# E1 — render tactic shootout
# ==========================================================================

def _plot_e1(rows, figures_dir, report):
    _write_csv(rows, figures_dir / "E1_tactics.csv")

    render_types = sorted({r["renderType"] for r in rows},
                           key=lambda rt: RENDER_TYPE_ORDER.index(rt)
                           if rt in RENDER_TYPE_ORDER else 99)
    pitches = sorted({r["pitch"] for r in rows},
                      key=lambda p: PITCH_ORDER.index(p) if p in PITCH_ORDER else 99)
    locations = sorted({r["location"] for r in rows})

    # Small multiples (one panel per pitch, x = location) instead of one
    # renderType x (location, pitch) chart — with the full 6 x 3 x 3 E1
    # matrix a single flat chart runs to tens of inches wide.
    for metric, ylabel, fname in (
        ("mean_fps", "Mean FPS", "E1_tactics_fps.png"),
        ("p95_ms", "p95 frame time (ms)", "E1_tactics_p95.png"),
    ):
        n_facets = len(pitches)
        fig, axes = plt.subplots(1, n_facets, figsize=(max(4, 3.2 * n_facets), 4.5),
                                  sharey=True)
        axes = [axes] if n_facets == 1 else list(axes)
        n_bars = len(render_types)
        width = 0.8 / max(1, n_bars)
        x_base = range(len(locations))
        for ax, pitch in zip(axes, pitches):
            for i, rt in enumerate(render_types):
                xs = [x + (i - (n_bars - 1) / 2) * width for x in x_base]
                ys, yerr_lo, yerr_hi = [], [], []
                for loc in locations:
                    match = next((r for r in rows if r["location"] == loc
                                  and r["pitch"] == pitch and r["renderType"] == rt), None)
                    if match is None or match.get(metric) is None:
                        ys.append(0)
                        yerr_lo.append(0)
                        yerr_hi.append(0)
                    else:
                        ys.append(match[metric])
                        band = _errbars([match], metric)
                        yerr_lo.append(band[0][0])
                        yerr_hi.append(band[1][0])
                ax.bar(xs, ys, width=width, label=rt, color=_color_for(rt, RENDER_TYPE_ORDER),
                       yerr=[yerr_lo, yerr_hi], capsize=2, zorder=3)
            ax.set_xticks(list(x_base))
            ax.set_xticklabels(locations, fontsize=8)
            ax.set_title(pitch, fontsize=9, color=INK_SECONDARY)
            _style_axes(ax)
        axes[0].set_ylabel(ylabel)
        handles, labels_ = axes[0].get_legend_handles_labels()
        fig.legend(handles, labels_, loc="lower center", ncol=min(n_bars, 6),
                   frameon=False, fontsize=8, bbox_to_anchor=(0.5, -0.05))
        fig.suptitle(f"E1: render tactic shootout — {ylabel}")
        fig.tight_layout(rect=(0, 0.06, 1, 1))
        fig.savefig(figures_dir / fname, dpi=150, bbox_inches="tight")
        plt.close(fig)

    report.append("## E1 render tactic shootout\n")
    report.append(f"{len(rows)} (renderType, location, pitch) cells, "
                   f"{_fail_group_counts(rows)} with a failed/non-quiescing repeat.\n")
    report.append("See `E1_tactics.csv`, `E1_tactics_fps.png`, `E1_tactics_p95.png`.\n")


# ==========================================================================
# E2 — chunk size sweep
# ==========================================================================

def _plot_e2(rows, figures_dir, report):
    rows = sorted(rows, key=lambda r: r["chunkSize"])
    _write_csv(rows, figures_dir / "E2_sweep.csv")

    sizes = [r["chunkSize"] for r in rows]
    ok = [not (r["failed"] or r["device_lost_any"] or not r["quiesced_all"]) for r in rows]

    for metric, ylabel, fname in (
        ("mean_fps", "Mean FPS", "E2_sweep_fps.png"),
        ("quiesce_ms", "Time to quiescence (ms)", "E2_sweep_quiesce.png"),
    ):
        fig, ax = plt.subplots(figsize=(7, 4.5))
        yerr = _errbars(rows, metric)
        # Break the line at failed/non-quiescing sizes (they get their own
        # "x" scatter marker below) so the line only connects real cells.
        ys = [r.get(metric) if (o and r.get(metric) is not None) else float("nan")
              for r, o in zip(rows, ok)]
        bad_x = [s for s, o in zip(sizes, ok) if not o]
        bad_y = [r.get(metric) or 0 for r, o in zip(rows, ok) if not o]
        ax.errorbar(sizes, ys, yerr=yerr, fmt="-o", color=CAT_COLORS[0],
                     ecolor=CAT_COLORS[0], elinewidth=1, capsize=2, markersize=4,
                     label="median across repeats", zorder=3)
        if bad_x:
            ax.scatter(bad_x, bad_y, marker="x", s=70, color=STATUS_CRITICAL,
                        label="timed out / failed", zorder=4)
        ax.set_xscale("log")
        ax.set_xlabel("Chunk size (px, log scale)")
        ax.set_ylabel(ylabel)
        ax.set_title(f"E2: chunk size sweep — {ylabel}")
        ax.legend(frameon=False, fontsize=8)
        _style_axes(ax)
        fig.tight_layout()
        fig.savefig(figures_dir / fname, dpi=150, bbox_inches="tight")
        plt.close(fig)

    n_fail = sum(1 for o in ok if not o)
    report.append("## E2 chunk size sweep\n")
    report.append(f"{len(rows)} sizes swept ({sizes[0]}..{sizes[-1]}), {n_fail} timed out or failed.\n")
    if n_fail:
        report.append("Failed sizes: " + ", ".join(
            str(r["chunkSize"]) for r, o in zip(rows, ok) if not o) + "\n")
    report.append("See `E2_sweep.csv`, `E2_sweep_fps.png`, `E2_sweep_quiesce.png`.\n")


# ==========================================================================
# E3 — LODs are load-bearing
# ==========================================================================

def _counter_values(rs, *path):
    vals = []
    for r in rs:
        c = r.get("counters_after") or {}
        v = c
        ok = True
        for p in path:
            if not isinstance(v, dict) or p not in v:
                ok = False
                break
            v = v[p]
        if ok and v is not None:
            vals.append(v)
    return vals


def table_e3_with_counters(results):
    e3 = [r for r in results if r["experiment"] == "E3"]
    groups = defaultdict(list)
    for r in e3:
        groups[(r["config"]["lodMin"], r["config"]["lodMax"])].append(r)
    rows = table_e3(results)
    for row in rows:
        rs = groups[(row["lodMin"], row["lodMax"])]
        for field in ("chunksResident", "gpuBytes"):
            med, mn, mx = _median_min_max(_counter_values(rs, field))
            row[field] = med
            row[f"{field}_min"] = mn
            row[f"{field}_max"] = mx
    return rows


def _plot_e3(results, figures_dir, report):
    rows = table_e3_with_counters(results)
    if not rows:
        return
    rows = sorted(rows, key=lambda r: (r["lodMax"], r["lodMin"]))
    _write_csv(rows, figures_dir / "E3_lod.csv")

    x_labels = [f"{r['lodMin']}-{r['lodMax']}" for r in rows]
    x = list(range(len(rows)))
    ok = [not (r["failed"] or r["device_lost_any"] or not r["quiesced_all"]) for r in rows]

    fig, ax = plt.subplots(figsize=(7, 4.5))
    ys = [r.get("mean_fps") if r.get("mean_fps") is not None else 0 for r in rows]
    yerr = _errbars(rows, "mean_fps")
    colors = [CAT_COLORS[0] if o else STATUS_CRITICAL for o in ok]
    ax.bar(x, ys, color=colors, yerr=yerr, capsize=2, zorder=3)
    for xi, r, o in zip(x, rows, ok):
        if not o:
            label = (r["error_msgs"] or ("device_lost" if r["device_lost_any"] else "timeout"))[:24]
            ax.annotate(label, (xi, r.get("mean_fps") or 0),
                        xytext=(0, 6), textcoords="offset points", ha="center",
                        fontsize=6, color=STATUS_CRITICAL, rotation=90)
    ax.set_xticks(x)
    ax.set_xticklabels(x_labels, rotation=45, ha="right", fontsize=8)
    ax.set_xlabel("lodMin-lodMax  (quality rises left→right; 0-9 is the default)")
    ax.set_ylabel("Mean FPS")
    ax.set_title("E3: LOD sweep — mean FPS (red = failed/device-lost/timeout)")
    _style_axes(ax)
    fig.tight_layout()
    fig.savefig(figures_dir / "E3_lod_fps.png", dpi=150, bbox_inches="tight")
    plt.close(fig)

    # Two single-axis panels side by side (never a dual y-axis): resident
    # chunk count and GPU memory, the counters behind "without LODs nothing
    # can be done" for the no-LOD extreme cell.
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(11, 4.5))
    resident = [r.get("chunksResident") or 0 for r in rows]
    ax1.bar(x, resident, color=CAT_COLORS[2], yerr=_errbars(rows, "chunksResident"),
            capsize=2, zorder=3)
    ax1.set_xticks(x)
    ax1.set_xticklabels(x_labels, rotation=45, ha="right", fontsize=8)
    ax1.set_xlabel("lodMin-lodMax")
    ax1.set_ylabel("Resident chunks (count)")
    ax1.set_title("Resident chunk count")
    _style_axes(ax1)

    gpu_scale = 1024.0 ** 2  # display in MB
    gpu_mb = [(r.get("gpuBytes") or 0) / gpu_scale for r in rows]
    gpu_err_raw = _errbars(rows, "gpuBytes")
    gpu_err = [[v / gpu_scale for v in gpu_err_raw[0]], [v / gpu_scale for v in gpu_err_raw[1]]]
    ax2.bar(x, gpu_mb, color=CAT_COLORS[4], yerr=gpu_err, capsize=2, zorder=3)
    ax2.set_xticks(x)
    ax2.set_xticklabels(x_labels, rotation=45, ha="right", fontsize=8)
    ax2.set_xlabel("lodMin-lodMax")
    ax2.set_ylabel("GPU memory resident (MB)")
    ax2.set_title("GPU memory")
    _style_axes(ax2)

    fig.suptitle("E3: LOD sweep — scale counters")
    fig.tight_layout()
    fig.savefig(figures_dir / "E3_lod_counters.png", dpi=150, bbox_inches="tight")
    plt.close(fig)

    n_fail = sum(1 for o in ok if not o)
    report.append("## E3 LODs are load-bearing\n")
    report.append(f"{len(rows)} lodMin-lodMax cells, {n_fail} failed "
                   "(device_lost/timeout/error — that failure IS the result).\n")
    for r, o in zip(rows, ok):
        if not o:
            report.append(f"- {r['lodMin']}-{r['lodMax']}: "
                           f"device_lost={r['device_lost_any']} "
                           f"error={r['error_msgs'] or '(none)'}\n")
    report.append("See `E3_lod.csv`, `E3_lod_fps.png`, `E3_lod_counters.png`.\n")


# ==========================================================================
# E4 — transport (WebSocket vs HTTP)
# ==========================================================================

def _net_total_bytes(counters):
    if not counters:
        return None
    net = counters.get("net") or {}
    ws = (net.get("ws") or {}).get("bytes")
    http = (net.get("http") or {}).get("bytes")
    if ws is None and http is None:
        return None
    return (ws or 0) + (http or 0)


def _first_response_ms(counters):
    if not counters:
        return None
    net = counters.get("net") or {}
    configured_at = counters.get("configuredAt")
    candidates = [v for v in (
        (net.get("ws") or {}).get("firstResponseAt"),
        (net.get("http") or {}).get("firstResponseAt"),
    ) if v is not None]
    if not candidates or configured_at is None:
        return None
    return min(candidates) - configured_at


def table_e4_with_transport(results):
    e4 = [r for r in results if r["experiment"] == "E4"]
    groups = defaultdict(list)
    for r in e4:
        groups[(r["config"]["sockets"], r["view"]["location"])].append(r)
    rows = table_e4(results)
    for row in rows:
        rs = groups[(row["sockets"], row["location"])]
        bytes_vals = [_net_total_bytes(r.get("counters_before")) for r in rs]
        med, mn, mx = _median_min_max(bytes_vals)
        row["total_bytes"], row["total_bytes_min"], row["total_bytes_max"] = med, mn, mx
        first_vals = [_first_response_ms(r.get("counters_before")) for r in rs]
        med, mn, mx = _median_min_max(first_vals)
        row["first_response_ms"], row["first_response_ms_min"], row["first_response_ms_max"] = med, mn, mx
    return rows


def _plot_e4(results, figures_dir, report):
    rows = table_e4_with_transport(results)
    if not rows:
        return
    _write_csv(rows, figures_dir / "E4_transport.csv")

    def label(r):
        return f"{'WS' if r['sockets'] else 'HTTP'}\n{r['location']}"

    labels = [label(r) for r in rows]
    x = list(range(len(rows)))
    colors = [CAT_COLORS[0] if r["sockets"] else CAT_COLORS[1] for r in rows]

    for metric, ylabel, fname, fmt in (
        ("quiesce_ms", "Time to quiescence (ms)", "E4_transport_quiesce.png", None),
        ("first_response_ms", "Time to first response (ms)", "E4_transport_first_response.png", None),
        ("total_bytes", "Bytes transferred (to quiescence)", "E4_transport_bytes.png", _human_bytes),
    ):
        vals = [r.get(metric) for r in rows]
        if all(v is None for v in vals):
            continue
        fig, ax = plt.subplots(figsize=(6, 4.5))
        ax.bar(x, [v or 0 for v in vals], color=colors,
               yerr=_errbars(rows, metric), capsize=2, zorder=3)
        ax.set_xticks(x)
        ax.set_xticklabels(labels, fontsize=8)
        ax.set_ylabel(ylabel)
        ax.set_title(f"E4: transport — {ylabel}")
        if fmt:
            for xi, v in zip(x, vals):
                if v is not None:
                    ax.annotate(fmt(v), (xi, v), xytext=(0, 4),
                                textcoords="offset points", ha="center", fontsize=7,
                                color=INK_SECONDARY)
        _style_axes(ax)
        fig.tight_layout()
        fig.savefig(figures_dir / fname, dpi=150, bbox_inches="tight")
        plt.close(fig)

    report.append("## E4 transport (WebSocket vs HTTP)\n")
    for r in rows:
        tb = r.get("total_bytes")
        pct = f"{100.0 * tb / DATASET_BYTES:.4f}%" if tb else "n/a"
        report.append(f"- {'WS' if r['sockets'] else 'HTTP'} / {r['location']}: "
                       f"quiesce={r['quiesce_ms']:.0f}ms, "
                       f"bytes={_human_bytes(tb)} ({pct} of the ~70 GB pyramid)\n")
    report.append("See `E4_transport.csv` and `E4_transport_*.png`.\n")


# ==========================================================================
# E5 — ablations
# ==========================================================================

def _plot_e5(rows, figures_dir, report):
    _write_csv(rows, figures_dir / "E5_ablations.csv")

    def label(r):
        bits = [r["renderType"], r["strategy"]]
        if r["fx"]:
            bits.append("fx")
        if r["culling"]:
            bits.append("cull")
        if r["viewDistance"] is not None:
            bits.append(f"vd={r['viewDistance']}")
        return "\n".join(bits)

    labels = [label(r) for r in rows]
    x = list(range(len(rows)))
    colors = [_color_for(r["renderType"], RENDER_TYPE_ORDER) for r in rows]

    fig, ax = plt.subplots(figsize=(max(6, 1.2 * len(rows)), 4.5))
    yerr = _errbars(rows, "mean_fps")
    ys = [r.get("mean_fps") or 0 for r in rows]
    ax.bar(x, ys, color=colors, yerr=yerr, capsize=2, zorder=3)
    ax.set_xticks(x)
    ax.set_xticklabels(labels, fontsize=7)
    ax.set_ylabel("Mean FPS")
    ax.set_title("E5: ablations — mean FPS")
    _style_axes(ax)
    fig.tight_layout()
    fig.savefig(figures_dir / "E5_ablations_fps.png", dpi=150, bbox_inches="tight")
    plt.close(fig)

    report.append("## E5 ablations\n")
    report.append(f"{len(rows)} configurations. See `E5_ablations.csv`, `E5_ablations_fps.png`.\n")


def write_all(results_dirs, figures_dir):
    if isinstance(results_dirs, (str, Path)):
        results_dirs = [results_dirs]
    figures_dir = Path(figures_dir)
    figures_dir.mkdir(parents=True, exist_ok=True)
    results = load_results(results_dirs)
    report = ["# Benchmark report", ""]

    # --- E1: render tactic shootout ---
    rows = table_e1(results)
    if rows:
        _plot_e1(rows, figures_dir, report)

    # --- E2: chunk size sweep (line: mean_fps vs chunkSize, log-x; and
    #         quiesce_ms vs chunkSize; timeouts marked) ---
    rows = table_e2(results)
    if rows:
        _plot_e2(rows, figures_dir, report)

    # --- E3: lodMax sweep (mean_fps + counters vs lodMax; failures annotated
    #         with device_lost / error text) ---
    if any(r["experiment"] == "E3" for r in results):
        _plot_e3(results, figures_dir, report)

    # --- E4: transport (bars: quiesce_ms, first response, total bytes;
    #         headline: bytes-to-quiescence vs 70 GB dataset) ---
    if any(r["experiment"] == "E4" for r in results):
        _plot_e4(results, figures_dir, report)

    # --- E5: ablations (simple bars) ---
    rows = table_e5(results)
    if rows:
        _plot_e5(rows, figures_dir, report)

    # --- E6-E14: gap campaign (2026-08-23), one section per experiment ---
    from bench.plot_gap import write_gap_experiments  # local: avoids a circular import
    write_gap_experiments(results, figures_dir, report, results_dirs)

    # --- zero-run figures derived from whatever is loaded (E1 multi-metric,
    #     GPU-vs-wall, pacing, pitch, E2 bandwidth, load curves, noise, LOC) ---
    from bench.plot_derived import write_derived
    write_derived(results, figures_dir, report)

    (figures_dir / "report.md").write_text("\n".join(report), encoding="utf-8")


def main(argv=None):
    ap = argparse.ArgumentParser()
    root = Path(__file__).resolve().parent
    ap.add_argument("--results-dir", nargs="+", default=[str(root / "results")],
                    help="one or more results dirs; later dirs only add run ids "
                         "not already seen (use to borrow E1/E2 baselines)")
    ap.add_argument("--figures-dir", default=str(root / "figures"))
    args = ap.parse_args(argv)
    write_all(args.results_dir, args.figures_dir)


if __name__ == "__main__":
    main()
