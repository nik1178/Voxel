# Benchmark report

## E2 chunk size sweep

22 sizes swept (2..1000), 2 timed out or failed.

Failed sizes: 2, 4

See `E2_sweep.csv`, `E2_sweep_fps.png`, `E2_sweep_quiesce.png`.

## E3 LODs are load-bearing

10 lodMin-lodMax cells, 7 failed (device_lost/timeout/error — that failure IS the result).

- 0-2: device_lost=False error=(none)

- 0-3: device_lost=False error=(none)

- 0-4: device_lost=False error=(none)

- 0-5: device_lost=False error=(none)

- 0-6: device_lost=False error=(none)

- 0-7: device_lost=False error=(none)

- 9-9: device_lost=False error=(none)

See `E3_lod.csv`, `E3_lod_fps.png`, `E3_lod_counters.png`.

## E4 transport (WebSocket vs HTTP)

- HTTP / alps: quiesce=97344ms, bytes=44.0 MB (0.0613% of the ~70 GB pyramid)

- HTTP / ljubljana: quiesce=95557ms, bytes=42.8 MB (0.0597% of the ~70 GB pyramid)

- WS / alps: quiesce=22816ms, bytes=43.8 MB (0.0610% of the ~70 GB pyramid)

- WS / ljubljana: quiesce=19643ms, bytes=42.6 MB (0.0594% of the ~70 GB pyramid)

See `E4_transport.csv` and `E4_transport_*.png`.

## E5 ablations

6 configurations. See `E5_ablations.csv`, `E5_ablations_fps.png`.
