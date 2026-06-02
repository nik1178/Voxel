from flask import Flask, send_from_directory, Response
from flask_sock import Sock
from python.chunk_manager import ChunkManager
from os import path
import json
import struct

from python.util.vprint import vprint

app = Flask(__name__, static_folder="public", static_url_path="")
sock = Sock(app)

BASE_DIR = path.dirname(path.abspath(__file__))
chunk_dir = path.join(BASE_DIR, "public", "map")
laz_dir = path.join("E:", "gkot")
verbose = False
chunk_manager = ChunkManager(chunk_size=1000, voxel_size=100, data_dir=chunk_dir, laz_dir=laz_dir, verbose=verbose)

@app.route("/get_chunk/<int:x>/<int:z>/<int:chunk_size>/<int:lod>/<string:version>/", methods=["GET"])
def get_chunk(x, z, chunk_size, lod, version):
    data = chunk_manager.get_chunk(x, z, chunk_size=chunk_size, lod=lod, version=version)
    vprint(verbose, "GOT DATA: ", type(data))
    if data == 404:
        return Response("Chunk not found", status=404)
    return Response(data, mimetype='application/octet-stream')

@sock.route('/ws/chunks')
def chunk_socket(ws):
    while True:
        # 1. Receive JSON request from client
        message = ws.receive()
        if not message:
            break
            
        try:
            req = json.loads(message)
            x = int(req['x'])
            z = int(req['z'])
            chunk_size = int(req.get('chunk_size', 1000))
            lod = int(req.get('lod', 0))
            version = req.get('version', 'quad')
            request_id = int(req['requestId']) # Correlation ID
        except (ValueError, KeyError, TypeError):
            continue
        # 2. Fetch chunk data
        data = chunk_manager.get_chunk(x, z, chunk_size=chunk_size, lod=lod, version=version)
        
        if data == 404:
            # Send error status header with 0 bytes of payload
            # Header: 4 bytes RequestID (int32), 4 bytes Status (int32)
            header = struct.pack('<ii', request_id, 404)
            ws.send(header)
        else:
            # 3. Pack header + chunk data and send as a single binary frame
            # Header: 4 bytes RequestID (int32), 4 bytes Status (200 OK)
            header = struct.pack('<ii', request_id, 200)
            ws.send(header + data)

@app.route("/")
def home():
    return send_from_directory(app.static_folder, "index.html")

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000, debug=verbose)