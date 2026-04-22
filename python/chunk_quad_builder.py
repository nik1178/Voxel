import os
from python.util.vprint import vprint
from python.chunk_binary_manager import ChunkBinaryManager
import numpy as np
from python.laz_converter import LazConverter
from multiprocessing import Process, Queue
import time

class ChunkQuadBuilder:
    extension = ".hmap"
    
    def __init__(self, voxel_size, data_dir, verbose=False):
        self.voxel_size = voxel_size
        self.data_dir = data_dir
        self.verbose = verbose
        
        self.chunk_binary_manager = ChunkBinaryManager(verbose)
    
    def chunk_string(self, lod, x, z):
        return os.path.join(self.data_dir, "lod_output", str(lod), f"{x}_{z}{self.extension}")
    
    def read_heightmap(self, lod, x, z):
        # Check if chunk binary exists
        chunk_path = self.chunk_string(lod, x, z)
        if not os.path.exists(chunk_path):
            vprint(self.verbose, f"Chunk binary not found at {chunk_path}")
            return 404
        
        with open(self.chunk_string(lod, x, z), "rb") as f:
            heightmap_data = f.read()
            return heightmap_data
    
    # Returns the chunk binary data for the requested chunk at (x, z) [based on chunk_size] and LOD
    def get_chunk(self, x, z, chunk_size=1000, lod=1, verbose=False):
        # Implementation to build chunk from heightmap data
        
        return self.read_heightmap(lod, x, z)