import time
from flask import Flask, send_from_directory, Response
from flask_sock import Sock
from python.chunk_manager import ChunkManager
from os import path
import json
import struct
import mimetypes

mimetypes.add_type('application/json', '.json')
mimetypes.add_type('application/javascript', '.js')

from python.util.vprint import vprint

app = Flask(__name__, static_folder="public", static_url_path="")
sock = Sock(app)

BASE_DIR = path.dirname(path.abspath(__file__))
chunk_dir = path.join(BASE_DIR, "public", "map")
laz_dir = path.join("E:", "gkot")
verbose = False
chunk_manager = ChunkManager(chunk_size=1000, voxel_size=100, data_dir=chunk_dir, laz_dir=laz_dir, verbose=verbose,
                             lod_dir="lod_output_clean")

# Benchmark instrumentation: per-request server-side chunk cost, drained by
# GET /bench_stats (the driver calls it once after configure to reset, once
# after record to collect). Shared by the HTTP route and the WS thread pool.
import threading
_req_lock = threading.Lock()
_req_times = []  # (ms, lod, is404) since the last /bench_stats GET


def _timed_get_chunk(x, z, chunk_size, lod, version):
    t0 = time.perf_counter()
    data = chunk_manager.get_chunk(x, z, chunk_size=chunk_size, lod=lod, version=version)
    with _req_lock:
        _req_times.append(((time.perf_counter() - t0) * 1000.0, lod, data == 404))
    return data

@app.route("/get_chunk/<int:x>/<int:z>/<int:chunk_size>/<int:lod>/<string:version>/", methods=["GET"])
def get_chunk(x, z, chunk_size, lod, version):
    data = _timed_get_chunk(x, z, chunk_size, lod, version)
    vprint(verbose, "GOT DATA: ", type(data))
    if data == 404:
        return Response("Chunk not found", status=404)
    return Response(data, mimetype='application/octet-stream')

@sock.route('/ws/chunks')
def chunk_socket(ws):
    import threading
    from concurrent.futures import ThreadPoolExecutor

    executor = ThreadPoolExecutor(max_workers=8)
    write_lock = threading.Lock()

    def process_and_send(req, request_id):
        try:
            start_time = time.time()
            x = int(req['x'])
            z = int(req['z'])
            chunk_size = int(req.get('chunk_size', 1000))
            lod = int(req.get('lod', 0))
            version = req.get('version', 'quad')
            
            data = _timed_get_chunk(x, z, chunk_size, lod, version)
            
            if data == 404:
                header = struct.pack('<ii', request_id, 404)
                payload = header
            else:
                header = struct.pack('<ii', request_id, 200)
                payload = header + data
            
            with write_lock:
                ws.send(payload)
            end_time = time.time()
            vprint(verbose, "Chunk loaded in ", end_time - start_time)
        except Exception as e:
            try:
                header = struct.pack('<ii', request_id, 500)
                with write_lock:
                    ws.send(header)
            except Exception:
                pass

    try:
        while True:
            # 1. Receive JSON request from client
            message = ws.receive()
            if not message:
                break
                
            try:
                req = json.loads(message)
                request_id = int(req['requestId']) # Correlation ID
                # Offload the chunk loading to the thread pool so the loop doesn't block
                executor.submit(process_and_send, req, request_id)
            except (ValueError, KeyError, TypeError):
                continue
    finally:
        executor.shutdown(wait=False)

@app.route("/")
def home():
    return send_from_directory(app.static_folder, "index.html")

@app.route("/bench_info")
def bench_info():
    return {"lod_dir": chunk_manager.chunk_quad_builder.lod_dir}


@app.route("/bench_stats")
def bench_stats():
    """Per-request server timing since the previous call; reading resets."""
    with _req_lock:
        rows = list(_req_times)
        _req_times.clear()
    ms = sorted(r[0] for r in rows)

    def pct(p):
        if not ms:
            return None
        k = max(1, -(-p * len(ms) // 100))  # nearest rank, ceil
        return ms[k - 1]

    by_lod = {}
    for t, lod, is404 in rows:
        s = by_lod.setdefault(str(lod), {"count": 0, "total_ms": 0.0, "n404": 0})
        s["count"] += 1
        s["total_ms"] += t
        s["n404"] += int(is404)
    return {"count": len(ms), "mean_ms": (sum(ms) / len(ms)) if ms else None,
            "p50_ms": pct(50), "p95_ms": pct(95), "max_ms": ms[-1] if ms else None,
            "by_lod": by_lod}

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000, debug=verbose)