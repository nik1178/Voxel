# Benchmark report

## E1 render tactic shootout

54 (renderType, location, pitch) cells, 0 with a failed/non-quiescing repeat.

See `E1_tactics.csv`, `E1_tactics_fps.png`, `E1_tactics_p95.png`.

## E1 multi-metric table (ljubljana/horizon, medians over repeats)

Speed is one axis; GPU memory, JS heap, draw calls, instances and load time are the others. `instances_drawn` is triangles for mesh. `js_p50_ms` is only non-zero for runs made after 2026-08-23.

| renderType | mean_fps | low1_fps | p99_ms | gpu_MB | js_heap_MB | draw_calls | instances_drawn | quiesce_s | gpu_p50_ms | js_p50_ms | n |
|---|---|---|---|---|---|---|---|---|---|---|---|
| mesh | 209.5 | 49.7 | 11.6 | 1600.5 | 104.3 | 544 | 46255616 | 25.1 | 4.6 | 0 | 3 |
| cubes | 37.8 | 24.7 | 34.4 | 53.5 | 247.4 | 544 | 8912896 | 24.6 | 26.3 | 0 | 3 |
| planes | 26.0 | 15.4 | 52.8 | 53.5 | 254.0 | 544 | 44564480 | 25.0 | 38.0 | 0 | 3 |
| greedy | 85.0 | 44.8 | 16.7 | 162.5 | 268.1 | 544 | 13627591 | 19.2 | 11.7 | 0 | 3 |
| raycast | 380.5 | 50.9 | 13.2 | 53.5 | 228.5 | 544 | 544 | 22.1 | 1.0 | 0 | 3 |
| hybrid | 390.2 | 51.5 | 15.3 | 162.5 | 240.8 | 544 | 204942 | 17.7 | 1.0 | 0 | 3 |

## GPU vs wall frame time

If the GPU bar ≈ the wall bar the tactic is GPU-bound; if the GPU bar is a fraction of the wall bar (raycast, hybrid) the frame is CPU-bound — the JS bar (runs made after 2026-08-23) shows how much of it is main-thread JS. GPU samples come from one timestamp readback in flight, terrain pass only — treat as indicative.

Files: `gpu_vs_wall.png`, `gpu_vs_wall.csv`

## Frame pacing

Mean FPS next to the 1 % low. The fast tactics share a 1 % low of ~50-60 FPS regardless of their mean: they are capped by periodic main-thread stalls (the chunk-manager update loop), not by rendering. Slow tactics have none.

Files: `pacing.png`, `pacing.csv`

## Pitch invariance

Looking straight up (empty sky) costs the same as looking at terrain: nothing is frustum-culled, and the loader downloads the same bytes regardless of pitch. The up-vs-horizon gap is the upper bound on what frustum culling could buy.

Files: `pitch_invariance.png`, `pitch_invariance.csv`

## Noise band

Every replicate of the default cell across all loaded experiments: 389.0 ± 13.4 FPS (CV 3.4 %). Differences smaller than ~2 CV are not findings.

Files: `noise.png`, `noise.csv`

## Simplicity proxy (LOC)

Non-blank, non-comment lines each tactic needs beyond the shared core (`bench/loc.py`). No field standard exists; this is the stated proxy.

| tactic | loc | files |
|---|---|---|
| mesh | 20 | mesh-shader.wgsl |
| cubes | 48 | instanced-cubes-shader.wgsl |
| planes | 136 | instanced-shader.wgsl |
| greedy | 286 | instanced-greedy-shader.wgsl + greedy-mesher.js |
| raycast | 132 | ray-shader.wgsl |
| hybrid | 418 | instanced-greedy-shader.wgsl + greedy-mesher.js + ray-shader.wgsl |
| fx | 116 | fx-shader.wgsl |
| shared core | 1981 | renderer.js + chunk-mesher.js + hmap-loader.js + chunk-quad-strategy.js + chunk-websocket.js + chunk-manager.js + chunk.js |
