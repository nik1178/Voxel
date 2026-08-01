"""Benchmark driver: one config per fresh browser, checkpointed JSON results.

Usage:
    venv\\Scripts\\python -m bench.driver --experiments E0 --screenshots
    venv\\Scripts\\python -m bench.driver                  # full pending matrix
    venv\\Scripts\\python -m bench.driver --redo E1        # re-run all of E1
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
    loc = LOCATIONS[view["location"]]
    return {
        "latLng": loc["latLng"], "y": loc["y"], "yaw": loc["yaw"],
        "pitch": PITCHES[view["pitch"]],
    }


def run_one(playwright, run, args, lod_dir):
    """Run a single config in a fresh browser. Never raises; failures are results."""
    result = {
        "run_id": run.run_id, "experiment": run.experiment, "repeat": run.repeat,
        "config": run.config, "view": run.view,
        "started_at": datetime.datetime.now().isoformat(timespec="seconds"),
        "git_rev": git_rev(), "lod_dir": lod_dir,
        "quiesce": None, "summary": {"frames": 0}, "gpu_summary": {"frames": 0},
        "raw": {"frameDtsMs": [], "gpuFrameTimesMs": []},
        "counters_before": None, "counters_after": None,
        "provenance": None, "device_lost": None, "error": None,
    }
    browser = None
    try:
        browser = playwright.chromium.launch(headless=False, args=CHROMIUM_ARGS)
        context = browser.new_context(viewport=VIEWPORT, device_scale_factor=1)
        page = context.new_page()
        page.goto(SERVER_URL + "/", wait_until="load")
        page.wait_for_function(
            "window.__bench?.ready === true && "
            "window.__bench?.gameManager?.renderer?.initialized === true",
            timeout=60000)

        page.evaluate("cfg => window.__bench.configure(cfg)", run.config)
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
        result["counters_before"] = rec["countersBefore"]
        result["counters_after"] = rec["countersAfter"]
        result["summary"] = aggregate(rec["frameDtsMs"])
        result["gpu_summary"] = aggregate(rec["gpuFrameTimesMs"])
        result["device_lost"] = page.evaluate("() => window.__deviceLost")

        if args.screenshots:
            shots = Path(args.results_dir) / "shots"
            shots.mkdir(parents=True, exist_ok=True)
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
    ap.add_argument("--experiments", help="comma list, e.g. E0,E1 (default: all)")
    ap.add_argument("--redo", help="run id or experiment name to force re-run")
    ap.add_argument("--screenshots", action="store_true")
    ap.add_argument("--results-dir", default=str(REPO_ROOT / "bench" / "results"))
    ap.add_argument("--record-ms", type=int, default=20000)
    ap.add_argument("--warmup-ms", type=int, default=5000)
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
