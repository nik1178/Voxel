# E4 HTTP cells measured BEFORE the trailing-slash fix

Measured 2026-08-21 with `public/hmap-loader.js` fetching `/get_chunk/.../quad`
(no trailing slash). Flask's route is declared with the slash, so every chunk
request was answered **308 Permanent Redirect** and re-issued: two round trips per
chunk, each on a fresh `Connection: close` TCP connection from the Werkzeug dev
server. WebSocket has neither cost, which is what produced "WS 5x faster than HTTP".

Kept as evidence for that paragraph of the thesis. **Not thesis numbers.** The six
cells are re-run (pending again in `bench/results-full-sweep`) after the fix
(commit bd557b9); the new runs carry `counters_after.net.http.phases` with
`redirect_p50 == 0` as the proof.
