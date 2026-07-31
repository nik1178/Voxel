import os
from python.util.vprint import vprint
from python.chunk_binary_manager import ChunkBinaryManager
import numpy as np
from python.laz_converter import LazConverter
from multiprocessing import Process, Queue
import time

class ChunkQuadBuilder:
    extension = ".hmap"
    
    def __init__(self, voxel_size, data_dir, laz_dir=None, verbose=False, lod_dir="lod_output"):
        self.voxel_size = voxel_size
        self.data_dir = data_dir
        self.laz_dir = laz_dir
        self.verbose = verbose
        self.lod_dir = lod_dir

        self.chunk_binary_manager = ChunkBinaryManager(verbose)
        self.laz_converter = LazConverter()

    def chunk_string(self, lod, x, z):
        return os.path.join(self.data_dir, self.lod_dir, str(lod), f"{x}_{z}{self.extension}")
    
    def read_heightmap(self, lod, x, z):
        # Check if chunk binary exists
        chunk_path = self.chunk_string(lod, x, z)
        if not os.path.exists(chunk_path):
            vprint(self.verbose, f"Chunk binary not found at {chunk_path}")
            return 404
        
        with open(self.chunk_string(lod, x, z), "rb") as f:
            heightmap_data = f.read()
            return heightmap_data
    
    
    def chunk_exists(self, lod, x, z):
        # Check if path data_dir/<voxel_size>/<x>_<z>.png exists
        return os.path.isfile(self.chunk_string(lod, x, z))
    
    def create_heightmap_from_list(self, chunk_list, x, z, chunk_size=1000, lod=1, laz_size=1000, verbose=False):
        # Create a heightmap for the requested chunk from the list of available chunks
        vprint(verbose, "Chunk list:", chunk_list)
        
        min_laz_x = min([coord[0] for (coord, status) in chunk_list])
        min_laz_z = min([coord[1] for (coord, status) in chunk_list])
        max_laz_x = max([coord[0] for (coord, status) in chunk_list])
        max_laz_z = max([coord[1] for (coord, status) in chunk_list])
        
        temp_heightmap_size_x = (max_laz_x - min_laz_x + 1) * laz_size
        temp_heightmap_size_z = (max_laz_z - min_laz_z + 1) * laz_size
        
        temp_heightmap = np.zeros((temp_heightmap_size_x, temp_heightmap_size_z, 4), dtype=np.uint16)
        
        for (chunk_x, chunk_z), status in chunk_list:
            if status == 404:
                continue
            
            laz_chunk_binary = self.read_heightmap(lod, chunk_x, chunk_z)
            laz_chunk = self.chunk_binary_manager.binary_to_heightmap(laz_chunk_binary, lod=lod, verbose=self.verbose)
            
            temp_heightmap[(chunk_x - min_laz_x) * laz_size : (chunk_x - min_laz_x + 1) * laz_size,
                           (chunk_z - min_laz_z) * laz_size : (chunk_z - min_laz_z + 1) * laz_size, :] = laz_chunk
        
        x_start = (x * chunk_size) - (min_laz_x * laz_size)
        z_start = (z * chunk_size) - (min_laz_z * laz_size)
        x_end = x_start + chunk_size
        z_end = z_start + chunk_size
        
        # Check if every value is 0
        if np.all(temp_heightmap == 0):
            return 404
        
        heightmap = temp_heightmap[x_start:x_end, z_start:z_end, :]
        
        return heightmap
    
    currently_processing = set()
    thread_queue = Queue()
    def get_chunk_list(self, x, z, chunk_size=1000, lod=1, hmap_size=1000, verbose=False):
        
        x_start = x * chunk_size
        z_start = z * chunk_size
        x_end = x_start + chunk_size
        z_end = z_start + chunk_size
        
        chunk_list = []
        
        first_chunk_x = x_start // hmap_size
        first_chunk_z = z_start // hmap_size
        
        last_chunk_x = (x_end - 1) // hmap_size
        last_chunk_z = (z_end - 1) // hmap_size
                        
        for chunk_x in range(first_chunk_x, last_chunk_x + 1):
            for chunk_z in range(first_chunk_z, last_chunk_z + 1):
                vprint(verbose, f"Processing sub-chunk at ({chunk_x}, {chunk_z})")
                if not self.chunk_exists(lod, chunk_x, chunk_z):
                    vprint(verbose, f"Chunk outside LAZ bounds at ({chunk_x}, {chunk_z})")
                    chunk_list.append(((chunk_x, chunk_z), 404))
                    continue
                chunk_list.append(((chunk_x, chunk_z), 200))
        
        vprint(verbose, "Chunk list:", chunk_list)
        return chunk_list
    
    # Artifact removal deliberately does not happen here.
    #
    # It used to, and it produced a checkerboard. For lod > 1 a chunk is a delta:
    # binary_to_heightmap populates only TR, BL and BR, leaving the TL quadrant as
    # zeros for the client to stitch in from the parent. A neighbourhood filter
    # reads those zeros as terrain at height 0. BR pixels have four TL neighbours
    # against TR and BL's two, so BR was corrupted far more often, sinking one
    # quadrant of every 2x2 cell.
    #
    # Filtering now happens once at full resolution in build_quad_tree.py, where
    # the data is complete, so every LOD inherits clean data.

    # Returns the chunk binary data for the requested chunk at (x, z) [based on chunk_size] and LOD
    def get_chunk(self, x, z, chunk_size=1000, lod=0, verbose=False):
        # Implementation to build chunk from heightmap data
        chunk_list = self.get_chunk_list(x, z, chunk_size=chunk_size, lod=lod, verbose=verbose)
        heightmap = self.create_heightmap_from_list(chunk_list, x, z, chunk_size=chunk_size, lod=lod, verbose=verbose)
        if isinstance(heightmap, int) and heightmap == 404:
            return 404

        return self.chunk_binary_manager.heightmap_to_binary(heightmap, lod=lod, verbose=verbose)