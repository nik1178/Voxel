"""Benchmark driver: one config per fresh browser, checkpointed JSON results.

Usage:
    venv\\Scripts\\python -m bench.driver --experiments E0 --screenshots
    venv\\Scripts\\python -m bench.driver                  # full pending matrix
    venv\\Scripts\\python -m bench.driver --redo E1        # re-run all of E1
    venv\\Scripts\\python -m bench.driver --experiments E1 --vsync
"""
import argparse
import datetime
import json
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

import psutil
from playwright.sync_api import sync_playwright

from bench.matrix import LOCATIONS, PITCHES, build_matrix, pending
from bench.stats import aggregate

REPO_ROOT = Path(__file__).resolve().parent.parent
SERVER_URL = "http://localhost:8000"
VIEWPORT = {"width": 1920, "height": 1080}
CHROMIUM_ARGS = [
    "--disable-frame-rate-limit",
    "--disable-gpu-vsync",
    "--force-device-scale-factor=1",
]
QUIESCE_SAFETY_MS = 30000  # driver-side wait beyond the JS timeout


def chromium_args(vsync=False):
    """Return Chromium arguments for either uncapped or presentation-paced runs."""
    if vsync:
        return [a for a in CHROMIUM_ARGS
                if a not in ("--disable-gpu-vsync", "--disable-frame-rate-limit")]
    return list(CHROMIUM_ARGS)


def presentation_mode(vsync=False):
    """Persist the presentation policy with the result it produced."""
    return {"vsync": vsync, "frame_rate_limit": vsync}


def fail(msg):
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(1)


def assert_no_pyramid_rebuild(allow_rebuild=False):
    for p in psutil.process_iter(["cmdline"]):
        cmdline = " ".join(p.info["cmdline"] or [])
        if "build_quad_tree" in cmdline:
            if allow_rebuild:
                print("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!")
                print("!! WARNING: build_quad_tree.py is running (--allow-rebuild set) !!")
                print("!! Results are PLUMBING-VALIDATION ONLY. Numbers are meaningless !!")
                print("!! under disk/CPU contention from the concurrent pyramid rebuild. !!")
                print("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!")
                return
            fail("build_quad_tree.py is running. Benchmarks and pyramid rebuilds "
                 "must never run concurrently. Finish or stop the rebuild first.")


def git_rev():
    return subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=REPO_ROOT,
                          capture_output=True, text=True).stdout.strip()


def git_dirty():
    """True if any code that affects a measurement has uncommitted changes."""
    try:
        out = subprocess.check_output(
            ["git", "status", "--porcelain", "--", "public", "server.py", "python", "bench/*.py"],
            cwd=REPO_ROOT, text=True)
        return bool(out.strip())
    except Exception:
        return None


def viewport_for(config):
    """New-cell-only 'viewport': [w, h] config key; default is the E1 viewport."""
    vp = config.get("viewport")
    return {"width": vp[0], "height": vp[1]} if vp else dict(VIEWPORT)


def check_gpu_vendor(result, expected):
    """None if OK, else an error message. 'any' disables the check."""
    if expected == "any":
        return None
    vendor = ((result.get("provenance") or {}).get("adapterInfo") or {}).get("vendor")
    if vendor != expected:
        return (f"GPU vendor is {vendor!r}, expected {expected!r} -- fix the Playwright "
                f"Chromium GpuPreference registry entry (see bench/README.md) and rerun")
    return None


def aggregate_js(rec):
    return aggregate(rec.get("jsFrameTimesMs") or [])


def fetch_server_stats():
    """GET /bench_stats: per-request server timing since the last GET (resets)."""
    try:
        with urllib.request.urlopen(SERVER_URL + "/bench_stats", timeout=10) as r:
            return json.loads(r.read())
    except Exception as e:
        return {"error": str(e)}


def server_alive():
    try:
        with urllib.request.urlopen(SERVER_URL + "/", timeout=2) as r:
            return r.status == 200
    except Exception:
        return False


def start_server():
    if server_alive():
        print("Server already running; using it.")
        return None
    proc = subprocess.Popen(
        [str(REPO_ROOT / "venv" / "Scripts" / "python"), "server.py"],
        cwd=REPO_ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(60):
        if server_alive():
            return proc
        time.sleep(1)
    proc.kill()
    fail("Flask server did not come up within 60s")


def fetch_lod_dir():
    """Verify which pyramid the running server actually serves. A server
    without /bench_info is stale — it predates this check and must be
    restarted with the current server.py before benchmarking."""
    try:
        with urllib.request.urlopen(SERVER_URL + "/bench_info", timeout=5) as r:
            data = json.loads(r.read().decode())
        lod_dir = data["lod_dir"]
        if not isinstance(lod_dir, str) or not lod_dir:
            raise ValueError(f"bad lod_dir value: {lod_dir!r}")
        return lod_dir
    except Exception as e:
        fail(f"/bench_info unreachable or malformed ({type(e).__name__}: {e}). "
             "The server is stale (missing /bench_info) or misconfigured; "
             "restart it with the current server.py before benchmarking.")


def resolve_view(view):
    """Location name + pitch name -> the exact pose handed to __bench.teleport."""
    loc = LOCATIONS[view["location"]]
    pitch = PITCHES[view["pitch"]]
    if view["pitch"] == "horizon":
        pitch = loc.get("horizonPitch", pitch)
    resolved = {"y": loc["y"], "yaw": loc["yaw"], "pitch": pitch}
    # A location is pinned either by real-world coords or by a hand-framed world
    # position; teleport accepts both.
    if "position" in loc:
        resolved["position"] = loc["position"]
    else:
        resolved["latLng"] = loc["latLng"]
    return resolved


def run_one(playwright, run, args, lod_dir):
    """Run a single config in a fresh browser. Never raises; failures are results."""
    result = {
        "run_id": run.run_id, "experiment": run.experiment, "repeat": run.repeat,
        "config": run.config, "view": run.view,
        # The literal pose, not just its name: run_id hashes only the view NAME,
        # so without this a later coordinate fix is invisible in the data.
        "resolved_view": resolve_view(run.view),
        "started_at": datetime.datetime.now().isoformat(timespec="seconds"),
        "git_rev": git_rev(), "git_dirty": git_dirty(), "lod_dir": lod_dir,
        "quiesce": None, "summary": {"frames": 0}, "gpu_summary": {"frames": 0},
        "js_summary": {"frames": 0}, "server_stats": None,
        "raw": {"frameDtsMs": [], "gpuFrameTimesMs": [], "jsFrameTimesMs": [], "loadCurve": []},
        "counters_before": None, "counters_after": None,
        "provenance": None, "device_lost": None, "error": None,
        "presentation": presentation_mode(args.vsync),
    }
    browser = None
    try:
        browser = playwright.chromium.launch(
            headless=False, args=chromium_args(args.vsync))
        context = browser.new_context(viewport=viewport_for(run.config), device_scale_factor=1)
        page = context.new_page()
        page.goto(SERVER_URL + "/", wait_until="load")
        page.wait_for_function(
            "window.__bench?.ready === true && "
            "window.__bench?.gameManager?.renderer?.initialized === true",
            timeout=60000)

        page.evaluate("cfg => window.__bench.configure(cfg)", run.config)
        fetch_server_stats()  # drain: exclude pre-configure loads from server_stats
        page.evaluate("v => window.__bench.teleport(v)", resolve_view(run.view))
        result["provenance"] = page.evaluate("() => window.__bench.getProvenance()")

        timeout_ms = run.config.get("timeoutS", 600) * 1000
        # page.evaluate has no timeout of its own: it awaits the returned Promise
        # indefinitely, so page.set_default_timeout does NOT bound it (it only
        # bounds other Playwright calls like goto/wait_for_function). The actual
        # guard is the in-page Promise.race below: a rejection timer races the
        # real promise, so a hung PROMISE becomes a rejected evaluate that the
        # except block below records as an error result. This does NOT protect
        # against a wedged page main thread (a synchronous JS hang would block
        # the watchdog's own setTimeout too) — that residual risk is accepted.
        page.set_default_timeout(timeout_ms + QUIESCE_SAFETY_MS)
        result["quiesce"] = page.evaluate(
            """t => Promise.race([
                window.__bench.waitForQuiescence({timeoutMs: t}),
                new Promise((_, reject) => setTimeout(
                    () => reject(new Error('waitForQuiescence watchdog: exceeded ' + (t + 30000) + 'ms')),
                    t + 30000)),
            ])""", timeout_ms)
        result["raw"]["loadCurve"] = result["quiesce"].pop("loadCurve", [])

        record_watchdog_ms = args.warmup_ms + args.record_ms + 30000
        rec = page.evaluate(
            """o => Promise.race([
                window.__bench.record(o),
                new Promise((_, reject) => setTimeout(
                    () => reject(new Error('record watchdog: exceeded ' + o.watchdogMs + 'ms')),
                    o.watchdogMs)),
            ])""",
            {"warmupMs": args.warmup_ms, "durationMs": args.record_ms, "watchdogMs": record_watchdog_ms})
        result["raw"]["frameDtsMs"] = rec["frameDtsMs"]
        result["raw"]["gpuFrameTimesMs"] = rec["gpuFrameTimesMs"]
        result["raw"]["jsFrameTimesMs"] = rec.get("jsFrameTimesMs", [])
        result["counters_before"] = rec["countersBefore"]
        result["counters_after"] = rec["countersAfter"]
        result["summary"] = aggregate(rec["frameDtsMs"])
        result["gpu_summary"] = aggregate(rec["gpuFrameTimesMs"])
        result["js_summary"] = aggregate_js(rec)
        result["server_stats"] = fetch_server_stats()
        result["device_lost"] = page.evaluate("() => window.__deviceLost")

        if args.screenshots or run.screenshot:
            shots = Path(args.results_dir) / "shots"
            shots.mkdir(parents=True, exist_ok=True)
            # Hide the HUD (same as pressing Escape) so the picture is terrain only.
            # Measurement is over by now, so this cannot affect the numbers.
            page.evaluate("() => document.getElementById('ui')?.classList.add('invisible')")
            page.wait_for_timeout(300)
            page.screenshot(path=str(shots / f"{run.run_id}.png"))
    except Exception as e:  # timeout, crash, device-lost tab death: record it
        result["error"] = f"{type(e).__name__}: {e}"
    finally:
        if browser:
            try:
                browser.close()
            except Exception:
                pass
    return result


def write_result(result, results_dir):
    results_dir = Path(results_dir)
    results_dir.mkdir(parents=True, exist_ok=True)
    (results_dir / f"{result['run_id']}.json").write_text(
        json.dumps(result, indent=1))
    with open(results_dir / "manifest.jsonl", "a") as f:
        f.write(json.dumps({
            "run_id": result["run_id"], "experiment": result["experiment"],
            "quiesced": (result["quiesce"] or {}).get("quiesced"),
            "mean_fps": result["summary"].get("mean_fps"),
            "error": result["error"],
            "finished_at": datetime.datetime.now().isoformat(timespec="seconds"),
        }) + "\n")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--experiments",
                    help="comma list, e.g. E0,E1, or a group: overnight, igpu (default: all)")
    ap.add_argument("--redo", help="run id or experiment name to force re-run")
    ap.add_argument("--screenshots", action="store_true")
    ap.add_argument("--vsync", action="store_true",
                    help="keep vsync and Chromium's frame-rate limit enabled; "
                         "use a separate --results-dir for this paced campaign")
    ap.add_argument("--results-dir", default=str(REPO_ROOT / "bench" / "results"))
    ap.add_argument("--record-ms", type=int, default=20000)
    ap.add_argument("--warmup-ms", type=int, default=5000)
    ap.add_argument("--expect-gpu", default="nvidia", choices=["nvidia", "intel", "any"],
                    help="abort (without writing) if provenance.adapterInfo.vendor differs; "
                         "use 'intel' for the iGPU campaign")
    ap.add_argument("--allow-rebuild", action="store_true",
                     help="plumbing smoke tests only: proceed even if "
                          "build_quad_tree.py is running (results invalid)")
    args = ap.parse_args(argv)

    assert_no_pyramid_rebuild(allow_rebuild=args.allow_rebuild)

    experiments = args.experiments.split(",") if args.experiments else None
    runs = build_matrix(experiments)
    if args.redo:
        runs = [r for r in runs
                if r.run_id == args.redo or r.experiment == args.redo]
        if not runs:
            fail(f"--redo matched nothing: {args.redo}")
    else:
        before = len(runs)
        runs = pending(runs, args.results_dir)
        print(f"{before - len(runs)} runs already done (checkpointed), "
              f"{len(runs)} to go.")
    if not runs:
        print("Nothing to do.")
        return

    server_proc = start_server()
    try:
        lod_dir = fetch_lod_dir()
        print(f"Server-reported lod_dir: {lod_dir}")
        with sync_playwright() as pw:
            for i, run in enumerate(runs, 1):
                print(f"[{i}/{len(runs)}] {run.run_id} "
                      f"({run.config['renderType']}, {run.view})...", flush=True)
                t0 = time.time()
                result = run_one(pw, run, args, lod_dir)
                if not result["error"]:
                    msg = check_gpu_vendor(result, args.expect_gpu)
                    if msg:
                        fail(msg)  # never write a result measured on the wrong GPU
                write_result(result, args.results_dir)
                status = ("ERROR " + result["error"]) if result["error"] else (
                    f"quiesced={result['quiesce']['quiesced']} "
                    f"mean_fps={result['summary'].get('mean_fps', 0):.1f}")
                print(f"    {status}  ({time.time() - t0:.0f}s)")
    finally:
        if server_proc:
            server_proc.kill()


if __name__ == "__main__":
    main()
