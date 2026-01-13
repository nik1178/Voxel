import os
from python.laz_converter import LazConverter
from python.util.vprint import vprint
from os import path
from python.chunk_binary_manager import ChunkBinaryManager
from python.chunk_builder import ChunkBuilder

class ChunkManager:
    
    extension = ".hmap"
    
    def __init__(self, chunk_size=100, voxel_size=100, data_dir="map", laz_dir="laz_files", verbose=False):
        self.chunk_size = chunk_size
        self.voxel_size = voxel_size
        self.data_dir = data_dir
        self.laz_dir = laz_dir
        self.chunk_builder = ChunkBuilder(voxel_size, data_dir, verbose)
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

    def get_chunk(self, x, z, chunk_size=1000, lod=0):
        vprint(self.verbose, f"Requesting chunk at ({x}, {z})")
        
        heightmap_binary = self.chunk_builder.get_chunk(x, z, chunk_size=chunk_size, lod=lod, verbose=self.verbose)
        return heightmap_binary

