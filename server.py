from flask import Flask, send_from_directory, Response
from python.chunk_manager import ChunkManager
from os import path

from python.util.vprint import vprint

app = Flask(__name__, static_folder="public", static_url_path="")
BASE_DIR = path.dirname(path.abspath(__file__))
chunk_dir = path.join(BASE_DIR, "public", "map")
laz_dir = path.join("E:", "gkot")
verbose = True
ChunkManager = ChunkManager(chunk_size=1000, voxel_size=100, data_dir=chunk_dir, laz_dir=laz_dir, verbose=verbose)

@app.route("/get_chunk/<int:x>/<int:z>/<int:chunk_size>/<int:lod>/<string:version>/", methods=["GET"])
def get_chunk(x, z, chunk_size, lod, version):
    data = ChunkManager.get_chunk(x, z, chunk_size=chunk_size, lod=lod, version=version)
    vprint(verbose, "GOT DATA: ", type(data))
    if data == 404:
        return Response("Chunk not found", status=404)
    return Response(data, mimetype='application/octet-stream')

@app.route("/")
def home():
    return send_from_directory(app.static_folder, "index.html")

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000, debug=verbose)