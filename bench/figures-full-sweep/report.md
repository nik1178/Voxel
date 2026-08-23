# Benchmark report

## E1 render tactic shootout

54 (renderType, location, pitch) cells, 0 with a failed/non-quiescing repeat.

See `E1_tactics.csv`, `E1_tactics_fps.png`, `E1_tactics_p95.png`.

## E2 chunk size sweep

22 sizes swept (2..1000), 2 timed out or failed.

Failed sizes: 2, 4

See `E2_sweep.csv`, `E2_sweep_fps.png`, `E2_sweep_quiesce.png`.

## E3 LODs are load-bearing

17 lodMin-lodMax cells, 4 failed (device_lost/timeout/error — that failure IS the result).

- 6-9: device_lost=False error=(none)

- 7-9: device_lost=False error=(none)

- 8-9: device_lost=False error=(none)

- 9-9: device_lost=False error=(none)

See `E3_lod.csv`, `E3_lod_fps.png`, `E3_lod_counters.png`.

## E4 transport (WebSocket vs HTTP)

- WS / alps: quiesce=22816ms, bytes=43.8 MB (0.0610% of the ~70 GB pyramid)

- WS / ljubljana: quiesce=19643ms, bytes=42.6 MB (0.0594% of the ~70 GB pyramid)

See `E4_transport.csv` and `E4_transport_*.png`.

## E5 ablations

6 configurations. See `E5_ablations.csv`, `E5_ablations_fps.png`.
