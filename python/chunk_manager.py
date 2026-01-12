import os
from python.laz_converter import LazConverter
from python.util.vprint import vprint
from os import path

class ChunkManager:
    
    extension = ".hmap"
    
    def __init__(self, chunk_size=100, voxel_size=100, data_dir="map", laz_dir="laz_files", verbose=False):
        self.chunk_size = chunk_size
        self.voxel_size = voxel_size
        self.data_dir = data_dir
        self.laz_dir = laz_dir
        self.LazConverter = LazConverter()
        self.verbose = verbose
        self.voxel_dir = os.path.join(self.data_dir, str(self.voxel_size))
        
        self.check_chunk_dir()
    
    def check_chunk_dir(self):
        
        if not os.path.exists(self.data_dir):
            os.makedirs(self.data_dir)
            os.makedirs(self.voxel_dir)
        elif not os.path.exists(self.voxel_dir):
            os.makedirs(self.voxel_dir)
    
    def chunk_string(self, x, z):
        return os.path.join(self.data_dir, str(self.voxel_size), f"{x}_{z}{self.extension}")
    
    def laz_path(self, x, z):
        return os.path.join(self.laz_dir, f"GKOT_{x}_{z}.laz")
    
    def chunk_exists(self, x, z):
        # Check if path data_dir/<voxel_size>/<x>_<z>.png exists
        return os.path.isfile(self.chunk_string(x, z))

    def get_chunk(self, x, z):
        vprint(self.verbose, f"Requesting chunk at ({x}, {z})")
        
        if not self.chunk_exists(x, z):
            result = self.generate_chunk(x, z)
            if result == 404:
                return 404
        
        # Open and return the chunk file
        vprint(self.verbose, f"Loading chunk at ({x}, {z}) from disk")
        with open(self.chunk_string(x, z), "rb") as f:
            return f.read()

    def generate_chunk(self, x, z):
        vprint(self.verbose, f"Generating chunk at ({x}, {z})")
        # Placeholder for chunk generation logic
        if not os.path.isfile(self.laz_path(x, z)):
            vprint(self.verbose, f"LAZ file not found for chunk at ({x}, {z})")
            return 404
        
        heightmap = self.LazConverter.laz_to_hmap(
            laz_file=self.laz_path(x, z),
            voxel_size=self.voxel_size,
            verbose=self.verbose
        )
        
        binary_data = self.LazConverter.build_heightmap_binary(heightmap, verbose=self.verbose)
        
        with open(self.chunk_string(x, z), "wb") as f:
            f.write(binary_data)

if __name__ == "__main__":
    BASE_DIR = path.dirname(path.abspath(__file__))
    chunk_dir = path.join(BASE_DIR, "..", "public", "map")
    laz_dir = path.join("E:", "gkot")
    ChunkManager = ChunkManager(chunk_size=1000, voxel_size=100, data_dir=chunk_dir, laz_dir=laz_dir, verbose=True)
    ChunkManager.generate_chunk(461, 101)