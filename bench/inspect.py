# Written by AI (Claude, Anthropic) under the direction of Nik Jenič, who reviewed and tested it.
r"""Interactive inspector: sit in each of the 9 E1 views and look around.

Opens the SAME browser, flags, viewport and config the benchmark uses, so what
you see is what E1 measured. Arrow keys step through the views; mouse+WASD are
the normal game controls.

Usage:
    venv\Scripts\python -m bench.inspect
    venv\Scripts\python -m bench.inspect --render-type raycast
    venv\Scripts\python -m bench.inspect --smoke     # non-interactive plumbing check
"""
import argparse

from playwright.sync_api import sync_playwright

from bench.driver import (CHROMIUM_ARGS, SERVER_URL, VIEWPORT, fetch_lod_dir,
                          resolve_view, start_server)
from bench.matrix import BASE_CONFIG, E1_LOCATIONS, LOCATIONS, PITCHES

HUD_JS = r"""
(views) => {
  const QUIET_POLLS = 20, POLL_MS = 200;   // must match bench-api.js
  const hud = document.createElement('div');
  hud.style.cssText = 'position:fixed;top:12px;left:12px;z-index:99999;' +
    'font:13px/1.45 ui-monospace,monospace;background:rgba(0,0,0,.72);color:#eee;' +
    'padding:10px 12px;border-radius:6px;pointer-events:none;white-space:pre';
  document.body.appendChild(hud);
  const st = { i: 0, views, fps: 0, worst: 0, low1: 0, quiet: 0, settled: false,
               spin: false, qms: 0, qmsWorst: 0 };
  window.__inspect = st;
  const gm = () => window.__bench.gameManager;
  let last = performance.now(), prev = last, frames = 0, dts = [];
  const reset = () => { frames = 0; dts = []; last = prev = performance.now();
                        st.fps = 0; st.worst = 0; st.low1 = 0;
                        st.qms = 0; st.qmsWorst = 0; };
  const go = (i) => {
    st.i = (i + views.length) % views.length;
    window.__bench.teleport(views[st.i].pose);
    st.quiet = 0; st.settled = false; reset();
  };
  st.go = go;
  addEventListener('keydown', (e) => {
    if (e.code === 'ArrowUp')   { go(st.i - 1); e.preventDefault(); e.stopPropagation(); }
    if (e.code === 'ArrowDown') { go(st.i + 1); e.preventDefault(); e.stopPropagation(); }
    if (e.code === 'KeyR')      { go(st.i);     e.preventDefault(); e.stopPropagation(); }
    // DIAGNOSTIC: code-driven yaw. If this pan looks smooth while dragging the
    // mouse does not, the problem is input delivery, not frame presentation.
    if (e.code === 'KeyP')      { st.spin = !st.spin; e.preventDefault(); e.stopPropagation(); }
  }, true);

  // Mirrors bench-api.waitForQuiescence. E1 only ever measured a scene that had
  // been quiet for QUIET_POLLS consecutive strategy passes, so an FPS read
  // before that is NOT comparable to the campaign numbers -- hence the gate.
  let lastPasses = -1;
  setInterval(() => {
    const s = gm().renderer.chunkManager.getStrategyStats();
    if (s.passes === lastPasses) return;
    lastPasses = s.passes;
    const quietPass = !s.initializing && s.queuedLastPass === 0 &&
                      s.destroyedLastPass === 0 && s.loading === 0;
    st.quiet = quietPass ? st.quiet + 1 : 0;
    const nowSettled = st.quiet >= QUIET_POLLS;
    if (nowSettled && !st.settled) reset();
    st.settled = nowSettled;
  }, POLL_MS);

  // DIAGNOSTIC: how far behind the GPU queue is. Per-pass timestamp queries and
  // rAF deltas both measure frame PRODUCTION; neither sees a present queue that
  // is dozens of frames deep. Hundreds of ms of drain time while p50 frame time
  // stays at 7 ms means the screen is showing frames the counters already
  // counted as finished.
  let qBusy = false;
  setInterval(() => {
    if (qBusy) return;
    qBusy = true;
    const t0 = performance.now();
    gm().renderer.device.queue.onSubmittedWorkDone().then(() => {
      st.qms = performance.now() - t0;
      if (st.qms > st.qmsWorst) st.qmsWorst = st.qms;
      qBusy = false;
    }).catch(() => { qBusy = false; });
  }, 1000);

  const deg = (r) => (r * 180 / Math.PI).toFixed(1);
  const tick = () => {
    frames++;
    const now = performance.now();
    const dt = now - prev;
    dts.push(dt);
    prev = now;
    if (st.spin) gm().player.camera.transform.rotation[1] += 0.8 * dt / 1000;
    if (dts.length > 2000) dts.shift();
    if (now - last >= 500) {
      st.fps = frames * 1000 / (now - last);
      // A mean hides hitches: 400 smooth frames plus one 100 ms stall still
      // averages ~660 fps. p99 frame time and the 1% low are what you FEEL,
      // and they are what the campaign reports too.
      const sorted = dts.slice().sort((a, b) => a - b);
      const p99 = sorted[Math.min(sorted.length - 1,
                                  Math.ceil(sorted.length * 0.99) - 1)] || 0;
      st.worst = sorted[sorted.length - 1] || 0;
      st.low1 = p99 > 0 ? 1000 / p99 : 0;
      frames = 0; last = now;
    }
    const v = views[st.i], t = gm().player.camera.transform;
    const cm = gm().renderer.chunkManager, s = cm.getStrategyStats();
    hud.textContent =
      '[' + (st.i + 1) + '/' + views.length + ']  ' + v.label + '\n' +
      'bench pose  y=' + v.pose.y + '  pitch=' + deg(v.pose.pitch) + '°  yaw=' + deg(v.pose.yaw) + '°\n' +
      'now         x=' + t.translation[0].toFixed(0) + '  y=' + t.translation[1].toFixed(0) + '  z=' + t.translation[2].toFixed(0) + '\n' +
      '            pitch=' + deg(t.rotation[0]) + '°  yaw=' + deg(t.rotation[1]) + '°\n' +
      (st.settled
        ? 'SETTLED   mean ' + st.fps.toFixed(0) + ' fps   1% low ' + st.low1.toFixed(0) +
          ' fps   worst ' + st.worst.toFixed(0) + ' ms\n'
        : 'settling ' + st.quiet + '/' + QUIET_POLLS + '   (NOT comparable to E1 yet)\n') +
      'chunks ' + cm.getChunkData().size + ' resident, ' + s.loading + ' loading\n' +
      'gpu queue drain ' + st.qms.toFixed(1) + ' ms (worst ' + st.qmsWorst.toFixed(0) + ' ms)\n' +
      'auto-pan ' + (st.spin ? 'ON' : 'off') + '\n' +
      '↑/↓ view   R reset pose   P auto-pan   click canvas to look';
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  go(0);
}
"""


def build_views(only_view=None):
    """The 9 E1 views, in a stable readable order (location major, pitch minor)."""
    if only_view:
        return [{"label": f"{only_view} / horizon", "location": only_view, "pitch": "horizon",
                 "pose": resolve_view({"location": only_view, "pitch": "horizon"})}]
    return [{"label": f"{loc} / {pitch}",
             "location": loc, "pitch": pitch,
             "pose": resolve_view({"location": loc, "pitch": pitch})}
            for loc in E1_LOCATIONS for pitch in PITCHES]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--render-type", default="hybrid",
                    help="render type to inspect in (default: hybrid)")
    ap.add_argument("--view", help="inspect a specific location instead of the E1 grid")
    ap.add_argument("--smoke", action="store_true",
                    help="step through all 9 views non-interactively and exit")
    # Presentation-side knobs. The campaign runs with BOTH off (i.e. vsync and
    # the frame-rate limit disabled, viewport emulated to 1920x1080). They exist
    # so a human can tell whether what the eye sees diverges from what the frame
    # counters report -- see bench/README.md.
    ap.add_argument("--vsync", action="store_true",
                    help="keep vsync and the frame-rate limit ON (campaign runs "
                         "with them off, which lets rAF outrun presentation)")
    ap.add_argument("--no-viewport", action="store_true",
                    help="use the real window size instead of the emulated "
                         "1920x1080 viewport the campaign uses")
    args = ap.parse_args()

    views = build_views(args.view)
    config = dict(BASE_CONFIG, renderType=args.render_type)

    chromium_args = [a for a in CHROMIUM_ARGS
                     if not (args.vsync and a in ("--disable-gpu-vsync",
                                                  "--disable-frame-rate-limit"))]
    ctx_kwargs = ({"no_viewport": True} if args.no_viewport
                  else {"viewport": VIEWPORT, "device_scale_factor": 1})

    proc = start_server()
    print(f"Server lod_dir: {fetch_lod_dir()}")
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=False, args=chromium_args)
            page = browser.new_context(**ctx_kwargs).new_page()
            page.goto(SERVER_URL + "/", wait_until="load")
            page.wait_for_function(
                "window.__bench?.ready === true && "
                "window.__bench?.gameManager?.renderer?.initialized === true",
                timeout=60000)
            prov = page.evaluate("() => window.__bench.getProvenance()")
            vendor = (prov.get("adapterInfo") or {}).get("vendor")
            print(f"GPU vendor: {vendor}"
                  + ("" if vendor == "nvidia" else "   <-- NOT nvidia, see bench/README.md"))

            page.evaluate("cfg => window.__bench.configure(cfg)", config)
            page.evaluate(HUD_JS, views)
            print(f"Inspecting in '{args.render_type}'. 9 views: "
                  + ", ".join(v["label"] for v in views))

            if args.smoke:
                # Wait for real quiescence per view, exactly as the campaign did.
                # Counts read before that are meaningless for comparison.
                print(f"  {'view':<22} {'quiesced':<9} {'resident':<9} {'drawn':<10} secs")
                for i in range(len(views)):
                    page.evaluate("i => window.__inspect.go(i)", i)
                    q = page.evaluate(
                        "() => window.__bench.waitForQuiescence({ timeoutMs: 120000 })")
                    s = page.evaluate(
                        "() => { const r = window.__bench.gameManager.renderer;"
                        " return { resident: r.chunkManager.getChunkData().size,"
                        " drawn: r.frameStats?.instancesDrawn ?? null }; }")
                    print(f"  {views[i]['label']:<22} {str(q['quiesced']):<9} "
                          f"{s['resident']:<9} {str(s['drawn']):<10} {q['ms'] / 1000:.0f}")
                browser.close()
                return

            print("\nArrow Up/Down = change view, R = reset pose, click canvas to look.")
            print("Close the browser window (or Ctrl+C) when done.\n")
            try:
                page.wait_for_event("close", timeout=0)
            except KeyboardInterrupt:
                pass
    finally:
        if proc:
            proc.terminate()


if __name__ == "__main__":
    main()
