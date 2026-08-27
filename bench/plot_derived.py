"""Zero-run figures: derived from result JSONs already on disk (mostly E1/E2).

Called from bench.plot.write_all after the per-experiment sections. Everything
here tolerates old results (pre 2026-08-23) that lack js_summary, loadCurve,
jsHeapBytes and so on -- those panels simply show less.
"""
import statistics
from pathlib import Path

import matplotlib.pyplot as plt

from bench import plot as P
from bench.loc import table as loc_table

DEFAULT_VIEW = {"location": "ljubljana", "pitch": "horizon"}
# The default cell's config, spelled out here (plot must not import the matrix).
DEFAULT_CELL = {"renderType": "hybrid", "strategy": "quad", "chunkSize": 128,
                "viewDistance": None, "lodMin": 0, "lodMax": 9, "fx": False,
                "culling": False, "sockets": True}


def _counter(r, *path, default=None):
    cur = r.get("counters_after") or {}
    for p in path:
        if not isinstance(cur, dict) or p not in cur:
            return default
        cur = cur[p]
    return default if cur is None else cur


def _section(report, title, what_it_shows, files):
    report.append(f"## {title}\n")
    report.append(what_it_shows.strip() + "\n")
    if files:
        report.append("Files: " + ", ".join(f"`{f}`" for f in files) + "\n")


def _save(fig, figures_dir, name):
    fig.tight_layout()
    fig.savefig(Path(figures_dir) / name, dpi=150, bbox_inches="tight")
    plt.close(fig)


def _e1_default_view(results, rt=None):
    return [r for r in results if r["experiment"] == "E1" and r["view"] == DEFAULT_VIEW
            and (rt is None or r["config"].get("renderType") == rt)
            and r["summary"].get("frames") and not r.get("error")]


# --------------------------------------------------------------------------
# E1 multi-metric table (+ feeds gpu_vs_wall and pacing)
# --------------------------------------------------------------------------

def plot_e1_multimetric(results, figures_dir, report):
    rows = []
    for rt in P.RENDER_TYPE_ORDER:
        rs = _e1_default_view(results, rt)
        if not rs:
            continue

        def med(f):
            return statistics.median([f(r) for r in rs])

        rows.append({
            "renderType": rt,
            "mean_fps": med(lambda r: r["summary"]["mean_fps"]),
            "low1_fps": med(lambda r: r["summary"]["low1_fps"]),
            "p99_ms": med(lambda r: r["summary"]["p99_ms"]),
            "gpu_MB": med(lambda r: (_counter(r, "gpuBytes", default=0) or 0) / 1e6),
            "js_heap_MB": med(lambda r: (_counter(r, "jsHeapBytes", default=0) or 0) / 1e6),
            "draw_calls": med(lambda r: _counter(r, "frameStats", "chunksRendered", default=0) or 0),
            "instances_drawn": med(lambda r: _counter(r, "frameStats", "instancesDrawn", default=0) or 0),
            "quiesce_s": med(lambda r: ((r.get("quiesce") or {}).get("ms") or 0) / 1000),
            "gpu_p50_ms": med(lambda r: (r.get("gpu_summary") or {}).get("p50_ms") or 0),
            "js_p50_ms": med(lambda r: (r.get("js_summary") or {}).get("p50_ms") or 0),
            "n": len(rs),
        })
    if not rows:
        return rows
    P._write_csv(rows, Path(figures_dir) / "E1_multimetric.csv")
    hdr = list(rows[0].keys())
    report.append("## E1 multi-metric table (ljubljana/horizon, medians over repeats)\n")
    report.append("Speed is one axis; GPU memory, JS heap, draw calls, instances and load time are "
                  "the others. `instances_drawn` is triangles for mesh. `js_p50_ms` is only "
                  "non-zero for runs made after 2026-08-23.\n")
    report.append("| " + " | ".join(hdr) + " |")
    report.append("|" + "---|" * len(hdr))
    for r in rows:
        report.append("| " + " | ".join(
            f"{v:.1f}" if isinstance(v, float) else str(v) for v in r.values()) + " |")
    report.append("")
    return rows


def plot_gpu_vs_wall(rows, figures_dir, report):
    rows = [r for r in rows if r.get("mean_fps")]
    if not rows:
        return
    P._write_csv(rows, Path(figures_dir) / "gpu_vs_wall.csv")
    fig, ax = plt.subplots(figsize=(7.5, 4.2))
    x = list(range(len(rows)))
    w = 0.27
    ax.bar([i - w for i in x], [1000 / r["mean_fps"] for r in rows], w,
           label="wall frame (1000/FPS)", color=P.INK_MUTED, zorder=3)
    ax.bar(x, [r["gpu_p50_ms"] for r in rows], w, label="GPU terrain pass p50",
           color=P.CAT_COLORS[0], zorder=3)
    if any(r["js_p50_ms"] for r in rows):
        ax.bar([i + w for i in x], [r["js_p50_ms"] for r in rows], w, label="JS render() p50",
               color=P.CAT_COLORS[1], zorder=3)
    ax.set_xticks(x)
    ax.set_xticklabels([r["renderType"] for r in rows])
    ax.set_ylabel("ms per frame")
    ax.set_yscale("log")
    ax.legend(fontsize=7)
    ax.set_title("Where the frame time goes (E1, ljubljana/horizon)")
    P._style_axes(ax)
    _save(fig, figures_dir, "gpu_vs_wall.png")
    _section(report, "GPU vs wall frame time",
             "If the GPU bar ≈ the wall bar the tactic is GPU-bound; if the GPU bar is a fraction "
             "of the wall bar (raycast, hybrid) the frame is CPU-bound — the JS bar (runs made after "
             "2026-08-23) shows how much of it is main-thread JS. GPU samples come from one "
             "timestamp readback in flight, terrain pass only — treat as indicative.",
             ["gpu_vs_wall.png", "gpu_vs_wall.csv"])


def plot_pacing(rows, figures_dir, report):
    rows = [r for r in rows if r.get("mean_fps")]
    if not rows:
        return
    P._write_csv(rows, Path(figures_dir) / "pacing.csv")
    fig, ax = plt.subplots(figsize=(7, 4.2))
    x = list(range(len(rows)))
    ax.bar([i - 0.2 for i in x], [r["mean_fps"] for r in rows], 0.4, label="mean FPS",
           color=P.INK_MUTED, zorder=3)
    ax.bar([i + 0.2 for i in x], [r["low1_fps"] for r in rows], 0.4, label="1% low FPS",
           color=P.STATUS_CRITICAL, zorder=3)
    ax.set_xticks(x)
    ax.set_xticklabels([r["renderType"] for r in rows])
    ax.set_ylabel("FPS")
    ax.legend(fontsize=8)
    ax.set_title("Frame pacing: mean vs 1% low (E1, ljubljana/horizon)")
    P._style_axes(ax)
    _save(fig, figures_dir, "pacing.png")
    _section(report, "Frame pacing",
             "Mean FPS next to the 1 % low. The fast tactics share a 1 % low of ~50-60 FPS "
             "regardless of their mean: they are capped by periodic main-thread stalls (the "
             "chunk-manager update loop), not by rendering. Slow tactics have none.",
             ["pacing.png", "pacing.csv"])


# --------------------------------------------------------------------------
# pitch invariance (E1, ljubljana)
# --------------------------------------------------------------------------

def plot_pitch_invariance(results, figures_dir, report):
    rows = [r for r in P.table_e1(results) if r["location"] == "ljubljana" and r.get("mean_fps")]
    if not rows:
        return
    P._write_csv(rows, Path(figures_dir) / "pitch_invariance.csv")
    types = [t for t in P.RENDER_TYPE_ORDER if any(r["renderType"] == t for r in rows)]
    fig, ax = plt.subplots(figsize=(7, 4.2))
    w = 0.27
    for j, p in enumerate(P.PITCH_ORDER):
        vals = [next((r["mean_fps"] for r in rows if r["renderType"] == t and r["pitch"] == p), 0)
                for t in types]
        ax.bar([i + (j - 1) * w for i in range(len(types))], vals, w, label=p,
               color=P.CAT_COLORS[j], zorder=3)
    ax.set_xticks(range(len(types)))
    ax.set_xticklabels(types)
    ax.set_ylabel("mean FPS")
    ax.set_yscale("log")
    ax.legend(fontsize=8)
    ax.set_title("Pitch invariance = no frustum culling (E1, ljubljana)")
    P._style_axes(ax)
    _save(fig, figures_dir, "pitch_invariance.png")
    _section(report, "Pitch invariance",
             "Looking straight up (empty sky) costs the same as looking at terrain: nothing is "
             "frustum-culled, and the loader downloads the same bytes regardless of pitch. The "
             "up-vs-horizon gap is the upper bound on what frustum culling could buy.",
             ["pitch_invariance.png", "pitch_invariance.csv"])


# --------------------------------------------------------------------------
# E2 bandwidth
# --------------------------------------------------------------------------

def plot_e2_bandwidth(results, figures_dir, report):
    e2 = [r for r in results if r["experiment"] == "E2" and not r.get("error")
          and (r.get("quiesce") or {}).get("quiesced")]
    rows = []
    for r in sorted(e2, key=lambda r: (r["config"]["chunkSize"], r["repeat"])):
        q = (r["quiesce"] or {}).get("ms") or 0
        b = P._net_total_bytes(r.get("counters_after") or {}) or 0
        m = ((_counter(r, "net", "ws", "messages", default=0) or 0)
             + (_counter(r, "net", "http", "requests", default=0) or 0))
        rows.append({"chunkSize": r["config"]["chunkSize"], "repeat": r["repeat"], "bytes": b,
                     "MB": b / 1e6, "messages": m, "quiesce_s": q / 1000,
                     "msg_per_s": (m / (q / 1000)) if q else None,
                     "MB_per_s": (b / 1e6 / (q / 1000)) if q else None,
                     "dataset_pct": 100 * b / P.DATASET_BYTES})
    if not rows:
        return
    P._write_csv(rows, Path(figures_dir) / "E2_bandwidth.csv")
    r0 = [x for x in rows if x["repeat"] == 0]
    fig, (a1, a2) = plt.subplots(1, 2, figsize=(10, 4.2))
    a1.plot([x["chunkSize"] for x in r0], [x["MB"] for x in r0], "o-", color=P.CAT_COLORS[0])
    a1.set_ylabel("bytes to quiescence (MB)")
    a1.set_yscale("log")
    a2.plot([x["chunkSize"] for x in r0], [x["msg_per_s"] or 0 for x in r0], "o-",
            color=P.CAT_COLORS[1], label="responses / s")
    a2b = a2.twinx()
    a2b.plot([x["chunkSize"] for x in r0], [x["MB_per_s"] or 0 for x in r0], "s--",
             color=P.CAT_COLORS[2], label="MB / s")
    a2b.set_ylabel("MB / s")
    a2.set_ylabel("responses / s")
    a2.legend(loc="upper left", fontsize=7)
    a2b.legend(loc="upper right", fontsize=7)
    for ax in (a1, a2):
        ax.set_xscale("log", base=2)
        ax.set_xlabel("chunk size (px)")
        P._style_axes(ax)
    fig.suptitle("E2: streaming cost vs chunk size")
    _save(fig, figures_dir, "E2_bandwidth.png")
    _section(report, "E2 bandwidth",
             "Bytes downloaded until the view is complete, and the request/throughput rates. The "
             "responses/s plateau at small sizes is the fixed per-request cost (the server decodes "
             "a whole tile per request); the MB/s plateau at large sizes is the decode/transfer "
             "ceiling. `dataset_pct` is the share of the served pyramid one view touches.",
             ["E2_bandwidth.png", "E2_bandwidth.csv"])


# --------------------------------------------------------------------------
# load curves (runs with raw.loadCurve)
# --------------------------------------------------------------------------

def plot_load_curves(results, figures_dir, report):
    rs = [r for r in results if (r.get("raw") or {}).get("loadCurve")]
    if not rs:
        return
    seen, picks = set(), []
    for r in rs:  # one curve per (experiment, renderType, location); first run wins
        k = (r["experiment"], r["config"].get("renderType"), r["view"]["location"])
        if k not in seen:
            seen.add(k)
            picks.append(r)
    picks = picks[:8]
    fig, (a1, a2) = plt.subplots(1, 2, figsize=(10, 4.2))
    for i, r in enumerate(picks):
        c = r["raw"]["loadCurve"]
        t = [s["t"] / 1000 for s in c]
        lab = f"{r['experiment']} {r['config'].get('renderType')} {r['view']['location']}"
        col = P.CAT_COLORS[i % len(P.CAT_COLORS)]
        a1.plot(t, [s.get("wsBytes", 0) / 1e6 for s in c], label=lab, color=col)
        a2.plot(t, [s.get("chunksResident", 0) for s in c], label=lab, color=col)
    a1.set_ylabel("bytes received (MB)")
    a2.set_ylabel("chunks resident")
    for ax in (a1, a2):
        ax.set_xlabel("time since configure (s)")
        ax.legend(fontsize=6)
        P._style_axes(ax)
    fig.suptitle("Streaming: load curves to quiescence")
    _save(fig, figures_dir, "load_curves.png")
    _section(report, "Load curves",
             "Bytes and resident chunks over time from configure to quiescence (runs made after "
             "2026-08-23 carry `raw.loadCurve`). The first flat segment is the serial 64-base-chunk "
             "init; the knee is 'country visible at coarse LOD'; the tail is refinement near the "
             "camera.",
             ["load_curves.png"])


# --------------------------------------------------------------------------
# noise band (every replicate of the default cell)
# --------------------------------------------------------------------------

def plot_noise(results, figures_dir, report):
    rs = [r for r in results if r["view"] == DEFAULT_VIEW and not r.get("error")
          and r["summary"].get("frames")
          and {k: r["config"].get(k) for k in DEFAULT_CELL} == DEFAULT_CELL
          and not any(k in r["config"] for k in ("hybridNear", "maxLoading", "viewport"))]
    if len(rs) < 2:
        return
    rs.sort(key=lambda r: r.get("started_at") or "")
    fps = [r["summary"]["mean_fps"] for r in rs]
    mean = statistics.mean(fps)
    sd = statistics.stdev(fps)
    rows = [{"run_id": r["run_id"], "experiment": r["experiment"],
             "mean_fps": r["summary"]["mean_fps"], "started_at": r.get("started_at")} for r in rs]
    P._write_csv(rows, Path(figures_dir) / "noise.csv")
    fig, ax = plt.subplots(figsize=(6.5, 3.8))
    ax.plot(range(len(fps)), fps, "o", color=P.CAT_COLORS[0], zorder=3)
    ax.axhline(mean, color=P.INK_MUTED)
    ax.axhspan(mean - sd, mean + sd, color=P.GRIDLINE, alpha=0.6)
    ax.set_xlabel("replicate (chronological, across experiments)")
    ax.set_ylabel("mean FPS")
    ax.set_title(f"Repeatability: hybrid/ljubljana/horizon, n={len(fps)}, CV={100 * sd / mean:.1f}%")
    P._style_axes(ax)
    _save(fig, figures_dir, "noise.png")
    _section(report, "Noise band",
             f"Every replicate of the default cell across all loaded experiments: {mean:.1f} ± "
             f"{sd:.1f} FPS (CV {100 * sd / mean:.1f} %). Differences smaller than ~2 CV are not "
             "findings.",
             ["noise.png", "noise.csv"])


# --------------------------------------------------------------------------
# simplicity proxy (LOC)
# --------------------------------------------------------------------------

def write_loc_table(figures_dir, report):
    rows = loc_table()
    P._write_csv(rows, Path(figures_dir) / "loc_table.csv")
    report.append("## Simplicity proxy (LOC)\n")
    report.append("Non-blank, non-comment lines each tactic needs beyond the shared core "
                  "(`bench/loc.py`). No field standard exists; this is the stated proxy.\n")
    report.append("| tactic | loc | files |")
    report.append("|---|---|---|")
    for r in rows:
        report.append(f"| {r['tactic']} | {r['loc']} | {r['files']} |")
    report.append("")


def write_derived(results, figures_dir, report):
    """Entry point used by bench.plot.write_all."""
    mm = plot_e1_multimetric(results, figures_dir, report)
    plot_gpu_vs_wall(mm, figures_dir, report)
    plot_pacing(mm, figures_dir, report)
    plot_pitch_invariance(results, figures_dir, report)
    plot_e2_bandwidth(results, figures_dir, report)
    plot_load_curves(results, figures_dir, report)
    plot_noise(results, figures_dir, report)
    write_loc_table(figures_dir, report)
