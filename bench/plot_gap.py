# Written by AI (Claude, Anthropic) under the direction of Nik Jenič, who reviewed and tested it.
"""Figures + CSV + report sections for the gap-campaign experiments E6-E14.

Called from bench.plot.write_all; never imported standalone (it takes the
shared palette / helpers from bench.plot). Every function tolerates results
written before 2026-08-23 (missing new fields) and skips silently when an
experiment has no results.
"""
import statistics
from pathlib import Path

import matplotlib.pyplot as plt

from bench import plot as P

LOD9_TILES = 14731            # LOD-9 (1 km) tiles in the served pyramid
E6_REFERENCE_SIZES = {64, 128, 200, 256, 512}
VIEWPORT_ORDER = ["1280x720", "1920x1080", "2560x1440"]
HYBRID_NEAR_ORDER = [9, 25, 81, 225, 0]
HYBRID_NEAR_LABELS = ["9", "25", "81", "225", "all"]


# --------------------------------------------------------------------------
# shared helpers
# --------------------------------------------------------------------------

def _cfg(r, key, default=None):
    return r["config"].get(key, default)


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
    report.append("Files: " + ", ".join(f"`{f}`" for f in files) + "\n")


def _rows_for(results, experiment, key_fn):
    return P._median_rows([r for r in results if r["experiment"] == experiment], key_fn)


def _save(fig, figures_dir, name):
    fig.tight_layout()
    fig.savefig(Path(figures_dir) / name, dpi=150, bbox_inches="tight")
    plt.close(fig)


def _first(rows, **match):
    for r in rows:
        if all(r.get(k) == v for k, v in match.items()):
            return r
    return None


def _vp_label(vp):
    return "x".join(str(v) for v in (vp or [1920, 1080]))


# --------------------------------------------------------------------------
# E6 chunk size x render type
# --------------------------------------------------------------------------

def plot_e6(results, figures_dir, report):
    rows = _rows_for(results, "E6", lambda r: (("renderType", _cfg(r, "renderType")),
                                                ("chunkSize", _cfg(r, "chunkSize"))))
    if not rows:
        return
    # hybrid's E2 curve (same view, same config) as the reference line
    rows += [dict(r, renderType="hybrid (E2)") for r in P.table_e2(results)
             if r["chunkSize"] in E6_REFERENCE_SIZES]
    P._write_csv(rows, Path(figures_dir) / "E6_chunksize_by_type.csv")
    types = sorted({r["renderType"] for r in rows},
                   key=lambda t: P.RENDER_TYPE_ORDER.index(t.split()[0]))
    fig, ax = plt.subplots(figsize=(7, 4.5))
    peaks = {}
    for rt in types:
        pts = sorted([r for r in rows if r["renderType"] == rt and r.get("mean_fps")],
                     key=lambda r: r["chunkSize"])
        if not pts:
            continue
        ax.errorbar([p["chunkSize"] for p in pts], [p["mean_fps"] for p in pts],
                    yerr=P._errbars(pts, "mean_fps"), marker="o", capsize=2, label=rt,
                    color=P._color_for(rt.split()[0], P.RENDER_TYPE_ORDER),
                    linestyle="--" if "(E2)" in rt else "-")
        peaks[rt] = max(pts, key=lambda r: r["mean_fps"])["chunkSize"]
    ax.set_xscale("log", base=2)
    ax.set_xlabel("chunk size (px)")
    ax.set_ylabel("mean FPS")
    ax.set_title("E6: chunk size × render type (ljubljana/horizon)")
    ax.legend(fontsize=8)
    P._style_axes(ax)
    _save(fig, figures_dir, "E6_chunksize_by_type.png")
    _section(report, "E6 chunk size × render type",
             "Does the chunk-size optimum found in E2 (hybrid only) hold for GPU-bound tactics? "
             "One line per render type, mean FPS vs chunk size; the hybrid E2 curve is the dashed "
             "reference when those results are loaded. Read: where each line peaks. "
             f"Peak chunk size per type: {peaks}.",
             ["E6_chunksize_by_type.png", "E6_chunksize_by_type.csv"])


# --------------------------------------------------------------------------
# E7 fx x render type
# --------------------------------------------------------------------------

def plot_e7(results, figures_dir, report):
    rows = _rows_for(results, "E7", lambda r: (("renderType", _cfg(r, "renderType")),
                                                ("fx", _cfg(r, "fx"))))
    if not rows:
        return
    # hybrid x fx is the E5 pair (same view/config)
    for r in P.table_e5(results):
        if (r["renderType"] == "hybrid" and r["strategy"] == "quad" and not r["culling"]
                and r["viewDistance"] is None):
            rows.append(dict(r))
    out = []
    for t in P.RENDER_TYPE_ORDER:
        off = _first(rows, renderType=t, fx=False)
        on = _first(rows, renderType=t, fx=True)
        if off and on and off.get("mean_fps") and on.get("mean_fps"):
            out.append({"renderType": t, "fps_off": off["mean_fps"], "fps_on": on["mean_fps"],
                        "ms_off": 1000 / off["mean_fps"], "ms_on": 1000 / on["mean_fps"],
                        "fx_cost_ms": 1000 / on["mean_fps"] - 1000 / off["mean_fps"],
                        "fx_cost_pct": 100 * (off["mean_fps"] - on["mean_fps"]) / off["mean_fps"]})
    P._write_csv(out, Path(figures_dir) / "E7_fx_by_type.csv")
    if out:
        fig, (a1, a2) = plt.subplots(1, 2, figsize=(10, 4.2))
        x = list(range(len(out)))
        w = 0.38
        a1.bar([i - w / 2 for i in x], [o["fps_off"] for o in out], w, label="fx off",
               color=P.INK_MUTED, zorder=3)
        a1.bar([i + w / 2 for i in x], [o["fps_on"] for o in out], w, label="fx on",
               color=P.CAT_COLORS[1], zorder=3)
        a1.set_xticks(x)
        a1.set_xticklabels([o["renderType"] for o in out])
        a1.set_ylabel("mean FPS")
        a1.set_yscale("log")
        a1.legend(fontsize=8)
        P._style_axes(a1)
        a2.bar(x, [o["fx_cost_ms"] for o in out], zorder=3,
               color=[P._color_for(o["renderType"], P.RENDER_TYPE_ORDER) for o in out])
        a2.set_xticks(x)
        a2.set_xticklabels([o["renderType"] for o in out])
        a2.set_ylabel("fx cost (ms per frame)")
        P._style_axes(a2)
        fig.suptitle("E7: FX post-processing × render type")
        _save(fig, figures_dir, "E7_fx_by_type.png")
    _section(report, "E7 fx × render type",
             "Does the FX pass compose with every tactic? Left: FPS with fx off/on (log). Right: "
             "the same difference in ms per frame — if those bars are ~equal, fx is a fixed "
             "per-frame cost (4 full-screen passes) that only *looks* expensive on fast tactics.",
             ["E7_fx_by_type.png", "E7_fx_by_type.csv"])


# --------------------------------------------------------------------------
# E8 quality evidence (screenshots + low-view FPS)
# --------------------------------------------------------------------------

def plot_e8(results, figures_dir, report, shots_dirs):
    e8 = [r for r in results if r["experiment"] == "E8"]
    if not e8:
        return
    rows = P._median_rows(e8, lambda r: (("renderType", _cfg(r, "renderType")),
                                         ("location", r["view"]["location"])))
    P._write_csv(rows, Path(figures_dir) / "E8_low_view_fps.csv")

    def shot(run_id):
        for d in shots_dirs:
            p = Path(d) / "shots" / f"{run_id}.png"
            if p.exists():
                return plt.imread(p)
        return None

    panels = []
    for loc in ("ljubljana", "ljubljana_low"):
        for rt in P.RENDER_TYPE_ORDER:
            r = next((x for x in e8 if _cfg(x, "renderType") == rt
                      and x["view"]["location"] == loc and x["repeat"] == 0), None)
            img = shot(r["run_id"]) if r else None
            if img is not None:
                panels.append((f"{rt} @ {loc}", img, r["summary"].get("mean_fps")))
    files = ["E8_low_view_fps.csv"]
    if panels:
        cols = 3
        nrows = -(-len(panels) // cols)
        fig, axes = plt.subplots(nrows, cols, figsize=(4.4 * cols, 2.7 * nrows), squeeze=False)
        flat = list(axes.flat)
        for ax, (title, img, fps) in zip(flat, panels):
            ax.imshow(img)
            ax.set_title(f"{title} — {fps:.0f} FPS" if fps else title, fontsize=8)
            ax.axis("off")
        for ax in flat[len(panels):]:
            ax.axis("off")
        _save(fig, figures_dir, "E8_quality_grid.png")
        files.insert(0, "E8_quality_grid.png")
    low = [r for r in rows if r["location"] == "ljubljana_low" and r.get("mean_fps")]
    low_txt = ", ".join(f"{r['renderType']} {r['mean_fps']:.0f} FPS" for r in low)
    _section(report, "E8 quality evidence",
             "What each tactic actually looks like (same frame, same view), and the low pass over "
             "Ljubljana where hybrid's greedy near field fills the frame. Compare hybrid vs raycast "
             "vs greedy at ljubljana_low: same speed + visibly more near detail is the 'hybrid wins "
             "on quality' claim; identical pictures at the 4 km view explain why E1 could not see it. "
             f"Low-view FPS: {low_txt or 'n/a'}.",
             files)


# --------------------------------------------------------------------------
# E9 hybridNear sweep
# --------------------------------------------------------------------------

def plot_e9(results, figures_dir, report):
    e9 = [r for r in results if r["experiment"] == "E9"]
    if not e9:
        return
    rows = P._median_rows(e9, lambda r: (("hybridNear", _cfg(r, "hybridNear")),
                                         ("location", r["view"]["location"])))
    for row in rows:
        rs = [r for r in e9 if _cfg(r, "hybridNear") == row["hybridNear"]
              and r["view"]["location"] == row["location"]]
        row["instancesDrawn"] = statistics.median(
            [_counter(r, "frameStats", "instancesDrawn", default=0) for r in rs])
    P._write_csv(rows, Path(figures_dir) / "E9_hybrid_near.csv")
    fig, (a1, a2) = plt.subplots(1, 2, figsize=(10, 4.2))
    for i, loc in enumerate(sorted({r["location"] for r in rows})):
        pts = [_first(rows, location=loc, hybridNear=n) for n in HYBRID_NEAR_ORDER]
        xs = [k for k, p in enumerate(pts) if p and p.get("mean_fps")]
        if not xs:
            continue
        sel = [pts[k] for k in xs]
        a1.errorbar(xs, [p["mean_fps"] for p in sel], yerr=P._errbars(sel, "mean_fps"),
                    marker="o", capsize=2, label=loc, color=P.CAT_COLORS[i])
        a2.plot(xs, [max(1, p["instancesDrawn"]) for p in sel], marker="s", label=loc,
                color=P.CAT_COLORS[i])
    for ax, yl in ((a1, "mean FPS"), (a2, "greedy instances drawn / frame")):
        ax.set_xticks(range(len(HYBRID_NEAR_ORDER)))
        ax.set_xticklabels(HYBRID_NEAR_LABELS)
        ax.set_xlabel("hybridNear (chunks drawn greedy)")
        ax.set_ylabel(yl)
        ax.legend(fontsize=8)
        P._style_axes(ax)
    a2.set_yscale("log")
    fig.suptitle("E9: hybrid near-field knob")
    _save(fig, figures_dir, "E9_hybrid_near.png")
    _section(report, "E9 hybridNear sweep",
             "The 'do greedy and raycast compose?' experiment: how many nearest chunks hybrid draws "
             "with greedy meshes (the rest is raymarched). 'all' = pure greedy through the hybrid "
             "path. Left: FPS; right: greedy instances actually drawn (log). Read: how far the knob "
             "can go before FPS leaves the raycast plateau, at the 4 km view and at the low pass.",
             ["E9_hybrid_near.png", "E9_hybrid_near.csv"])


# --------------------------------------------------------------------------
# E10 resolution scaling
# --------------------------------------------------------------------------

def plot_e10(results, figures_dir, report):
    rows = _rows_for(results, "E10", lambda r: (("renderType", _cfg(r, "renderType")),
                                                 ("viewport", _vp_label(_cfg(r, "viewport")))))
    if not rows:
        return
    for row in rows:
        base = _first(rows, renderType=row["renderType"], viewport="1920x1080")
        row["fps_rel_1080p"] = ((row["mean_fps"] / base["mean_fps"])
                                if base and base.get("mean_fps") and row.get("mean_fps") else None)
    P._write_csv(rows, Path(figures_dir) / "E10_resolution.csv")
    types = [t for t in P.RENDER_TYPE_ORDER if any(r["renderType"] == t for r in rows)]
    fig, (a1, a2) = plt.subplots(1, 2, figsize=(11, 4.2))
    w = 0.26
    for j, vp in enumerate(VIEWPORT_ORDER):
        xs = [i + (j - 1) * w for i in range(len(types))]
        vals = [(_first(rows, renderType=t, viewport=vp) or {}).get("mean_fps") or 0 for t in types]
        rel = [(_first(rows, renderType=t, viewport=vp) or {}).get("fps_rel_1080p") or 0 for t in types]
        a1.bar(xs, vals, w, label=vp, color=P.CAT_COLORS[j], zorder=3)
        a2.bar(xs, rel, w, label=vp, color=P.CAT_COLORS[j], zorder=3)
    a1.set_yscale("log")
    a2.axhline(1.0, color=P.INK_MUTED, lw=0.8)
    for ax, yl in ((a1, "mean FPS"), (a2, "FPS relative to 1080p")):
        ax.set_xticks(range(len(types)))
        ax.set_xticklabels(types)
        ax.set_ylabel(yl)
        ax.legend(fontsize=7)
        P._style_axes(ax)
    fig.suptitle("E10: resolution scaling")
    _save(fig, figures_dir, "E10_resolution.png")
    _section(report, "E10 resolution scaling",
             "Pixel count ×4 from 720p to 1440p. A GPU-bound tactic loses FPS roughly with pixel "
             "count; a CPU-bound tactic (raycast/hybrid at this view) stays flat. Right panel is "
             "normalised to 1080p, so 'flat ≈ 1.0' = CPU-bound.",
             ["E10_resolution.png", "E10_resolution.csv"])


# --------------------------------------------------------------------------
# E11 radius vs quad
# --------------------------------------------------------------------------

def plot_e11(results, figures_dir, report):
    e11 = [r for r in results if r["experiment"] == "E11"]
    if not e11:
        return
    rows = P._median_rows(e11, lambda r: (("strategy", _cfg(r, "strategy")),
                                          ("viewDistance", _cfg(r, "viewDistance"))))
    for row in rows:
        rs = [r for r in e11 if _cfg(r, "strategy") == row["strategy"]
              and _cfg(r, "viewDistance") == row["viewDistance"]]
        row["chunksResident"] = statistics.median(
            [_counter(r, "chunksResident", default=0) for r in rs])
        row["bytes"] = statistics.median(
            [P._net_total_bytes(r.get("counters_after") or {}) or 0 for r in rs])
    P._write_csv(rows, Path(figures_dir) / "E11_radius_vs_quad.csv")
    vds = sorted({r["viewDistance"] for r in rows})
    fig, axes = plt.subplots(1, 3, figsize=(12, 4))
    panels = (("mean_fps", "mean FPS"), ("quiesce_ms", "time to quiescence (ms)"),
              ("chunksResident", "chunks resident"))
    for ax, (metric, yl) in zip(axes, panels):
        for j, st in enumerate(("quad", "radius")):
            vals = [(_first(rows, strategy=st, viewDistance=vd) or {}).get(metric) or 0 for vd in vds]
            ax.bar([i + (j - 0.5) * 0.38 for i in range(len(vds))], vals, 0.38, label=st,
                   color=P.CAT_COLORS[j], zorder=3)
        ax.set_xticks(range(len(vds)))
        ax.set_xticklabels([str(v) for v in vds])
        ax.set_xlabel("view distance (m)")
        ax.set_ylabel(yl)
        ax.legend(fontsize=8)
        P._style_axes(ax)
    fig.suptitle("E11: radius vs quad strategy")
    _save(fig, figures_dir, "E11_radius_vs_quad.png")
    _section(report, "E11 radius vs quad",
             "Both strategies at view distances where the radius strategy actually converges "
             "(E5's 50 km radius cell needs ~610 k chunks and is a non-result). Caveat for the text: "
             "radius uses the server's v1 path (raw uncleaned map/100; LOD limits are no-ops). "
             "Read: FPS, load time and resident chunks side by side.",
             ["E11_radius_vs_quad.png", "E11_radius_vs_quad.csv"])


# --------------------------------------------------------------------------
# E12 maxLoading sweep
# --------------------------------------------------------------------------

def _transport(r):
    return "ws" if _cfg(r, "sockets") else "http"


def plot_e12(results, figures_dir, report):
    e12 = [r for r in results if r["experiment"] == "E12"]
    if not e12:
        return
    rows = P._median_rows(e12, lambda r: (("transport", _transport(r)),
                                          ("maxLoading", _cfg(r, "maxLoading"))))
    for row in rows:
        rs = [r for r in e12 if _transport(r) == row["transport"]
              and _cfg(r, "maxLoading") == row["maxLoading"]]
        msgs = [(_counter(r, "net", "ws", "messages", default=0) or 0)
                + (_counter(r, "net", "http", "requests", default=0) or 0) for r in rs]
        row["messages"] = statistics.median(msgs)
        row["msg_per_s"] = (row["messages"] / (row["quiesce_ms"] / 1000)) if row["quiesce_ms"] else None
        row["server_mean_ms"] = statistics.median(
            [((r.get("server_stats") or {}).get("mean_ms") or 0) for r in rs])
    P._write_csv(rows, Path(figures_dir) / "E12_max_loading.csv")
    fig, (a1, a2) = plt.subplots(1, 2, figsize=(10, 4.2))
    for j, tr in enumerate(("ws", "http")):
        pts = sorted([r for r in rows if r["transport"] == tr], key=lambda r: r["maxLoading"])
        if not pts:
            continue
        a1.plot([p["maxLoading"] for p in pts], [p["quiesce_ms"] / 1000 for p in pts],
                marker="o", label=tr, color=P.CAT_COLORS[j])
        a2.plot([p["maxLoading"] for p in pts], [p["msg_per_s"] or 0 for p in pts],
                marker="o", label=tr, color=P.CAT_COLORS[j])
    a1.set_ylabel("time to quiescence (s)")
    a2.set_ylabel("chunk responses / s")
    for ax in (a1, a2):
        ax.set_xlabel("maxLoading (concurrent chunk requests)")
        ax.set_xscale("log", base=2)
        ax.legend(fontsize=8)
        P._style_axes(ax)
    fig.suptitle("E12: loader concurrency")
    _save(fig, figures_dir, "E12_max_loading.png")
    srv = ", ".join(f"{r['transport']}@{r['maxLoading']}: {r['server_mean_ms']:.0f} ms"
                    for r in rows if r.get("server_mean_ms"))
    _section(report, "E12 maxLoading sweep",
             "Is streaming limited by the client's serial loader (maximumChunksLoading=1) or by the "
             "server? If quiesce time barely moves with 2-8 concurrent requests, the server "
             "(whole-tile decode per request, no cache) is the ceiling. Server-side mean per-request "
             f"cost: {srv or 'n/a'}.",
             ["E12_max_loading.png", "E12_max_loading.csv"])


# --------------------------------------------------------------------------
# E13 per-LOD residency
# --------------------------------------------------------------------------

def plot_e13(results, figures_dir, report):
    e13 = [r for r in results if r["experiment"] == "E13" and not r.get("error")]
    if not e13:
        return
    rows = []
    for r in e13:
        by_lod = _counter(r, "byLod", default={}) or {}
        for lod, s in sorted(by_lod.items(), key=lambda kv: int(kv[0])):
            rows.append({"location": r["view"]["location"], "lod": int(lod),
                         "resident": s.get("resident", 0), "bytes": s.get("bytes", 0),
                         "messages": s.get("messages", 0), "n404": s.get("n404", 0),
                         "emptyChunks_total": _counter(r, "emptyChunks", default=0)})
    P._write_csv(rows, Path(figures_dir) / "E13_by_lod.csv")
    files = ["E13_by_lod.csv"]
    if rows:
        locs = sorted({x["location"] for x in rows})
        lods = sorted({x["lod"] for x in rows})
        fig, ax = plt.subplots(figsize=(7, 4.2))
        bottom = [0] * len(locs)
        for k, lod in enumerate(lods):
            vals = [next((x["resident"] for x in rows if x["location"] == l and x["lod"] == lod), 0)
                    for l in locs]
            ax.bar(locs, vals, bottom=bottom, label=f"LOD {lod}",
                   color=P.CAT_COLORS[k % len(P.CAT_COLORS)], zorder=3)
            bottom = [b + v for b, v in zip(bottom, vals)]
        ax.set_ylabel("chunks resident at quiescence")
        ax.legend(fontsize=7)
        ax.set_title("E13: resident chunks per LOD")
        P._style_axes(ax)
        _save(fig, figures_dir, "E13_by_lod.png")
        files.insert(0, "E13_by_lod.png")
    lod9 = {l: sum(x["resident"] for x in rows if x["location"] == l and x["lod"] == 9)
            for l in sorted({x["location"] for x in rows})}
    empty = {r["view"]["location"]: _counter(r, "emptyChunks", default=0) for r in e13}
    _section(report, "E13 per-LOD residency",
             "How much of the pyramid a single view actually touches. LOD-9 (1 km base tiles) "
             f"resident per location, of {LOD9_TILES} tiles in the dataset: {lod9}. All-zero "
             f"(outside-survey) chunks resident: {empty}. The CSV has bytes/requests per LOD.",
             files)


# --------------------------------------------------------------------------
# E14 iGPU
# --------------------------------------------------------------------------

def plot_e14(results, figures_dir, report):
    e14 = [r for r in results if r["experiment"] == "E14"]
    if not e14:
        return
    rows = P._median_rows(e14, lambda r: (("renderType", _cfg(r, "renderType")),
                                          ("location", r["view"]["location"])))
    ref = {(r["renderType"], r["location"]): r for r in P.table_e1(results)
           if r["pitch"] == "horizon"}
    for row in rows:
        b = ref.get((row["renderType"], row["location"]))
        row["rtx_mean_fps"] = b["mean_fps"] if b else None
        row["igpu_over_rtx"] = ((row["mean_fps"] / b["mean_fps"])
                                if b and b.get("mean_fps") and row.get("mean_fps") else None)
    P._write_csv(rows, Path(figures_dir) / "E14_igpu.csv")
    locs = sorted({r["location"] for r in rows})
    types = [t for t in P.RENDER_TYPE_ORDER if any(r["renderType"] == t for r in rows)]
    fig, axes = plt.subplots(1, len(locs), figsize=(5.5 * len(locs), 4.2), squeeze=False)
    for ax, loc in zip(axes[0], locs):
        ig = [(_first(rows, renderType=t, location=loc) or {}).get("mean_fps") or 0 for t in types]
        rx = [(_first(rows, renderType=t, location=loc) or {}).get("rtx_mean_fps") or 0 for t in types]
        if any(rx):
            ax.bar([i - 0.2 for i in range(len(types))], rx, 0.4, label="RTX 3070 Ti (E1)",
                   color=P.INK_MUTED, zorder=3)
            ax.bar([i + 0.2 for i in range(len(types))], ig, 0.4, label="Iris Xe (E14)",
                   color=P.CAT_COLORS[0], zorder=3)
        else:
            ax.bar(range(len(types)), ig, 0.6, label="Iris Xe (E14)", color=P.CAT_COLORS[0], zorder=3)
        ax.set_xticks(range(len(types)))
        ax.set_xticklabels(types)
        ax.set_title(loc)
        ax.set_ylabel("mean FPS")
        ax.set_yscale("log")
        ax.legend(fontsize=7)
        P._style_axes(ax)
    fig.suptitle("E14: integrated GPU vs discrete")
    _save(fig, figures_dir, "E14_igpu.png")
    _section(report, "E14 iGPU generalisation",
             "Same tactics on the laptop's Intel Iris Xe (log FPS). RTX bars appear when the E1 "
             "results dir is also loaded. Read: does the ORDER of tactics survive a ~10x weaker GPU, "
             "and which tactics fall below interactive rates.",
             ["E14_igpu.png", "E14_igpu.csv"])


def write_gap_experiments(results, figures_dir, report, results_dirs):
    """Entry point used by bench.plot.write_all."""
    plot_e6(results, figures_dir, report)
    plot_e7(results, figures_dir, report)
    plot_e8(results, figures_dir, report, results_dirs)
    plot_e9(results, figures_dir, report)
    plot_e10(results, figures_dir, report)
    plot_e11(results, figures_dir, report)
    plot_e12(results, figures_dir, report)
    plot_e13(results, figures_dir, report)
    plot_e14(results, figures_dir, report)
