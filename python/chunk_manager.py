import os
from python.laz_converter import LazConverter
from python.util.vprint import vprint
from os import path
from python.chunk_binary_manager import ChunkBinaryManager
from python.chunk_builder import ChunkBuilder
from python.chunk_quad_builder import ChunkQuadBuilder

class ChunkManager:
    
    extension = ".hmap"
    
    def __init__(self, chunk_size=100, voxel_size=100, data_dir="map", laz_dir="laz_files",
                 verbose=False, lod_dir="lod_output"):
        self.chunk_size = chunk_size
        self.voxel_size = voxel_size
        self.data_dir = data_dir
        self.laz_dir = laz_dir
        self.chunk_builder = ChunkBuilder(voxel_size, data_dir, laz_dir, verbose)
        # lod_dir selects which pyramid to serve, so a rebuild can be pointed at
        # without renaming folders.
        self.chunk_quad_builder = ChunkQuadBuilder(voxel_size, data_dir, laz_dir=laz_dir,
                                                   verbose=verbose, lod_dir=lod_dir)
        self.verbose = verbose
        self.voxel_dir = os.path.join(self.data_dir, str(self.voxel_size))
        
        self.check_chunk_dir()
    
    def check_chunk_dir(self):
        
        if not os.path.exists(self.data_dir):
            os.makedirs(self.data_dir)
            os.makedirs(self.voxel_dir)
        elif not os.path.exists(self.voxel_dir):
            os.makedirs(self.voxel_dir)

    def get_chunk(self, x, z, chunk_size=1000, lod=0, version="v1"):
        vprint(self.verbose, f"Requesting chunk at ({x}, {z}) with chunk size {chunk_size}, LOD {lod}, version {version}")
        
        heightmap_binary = None
        if version == "v1":
            heightmap_binary = self.chunk_builder.get_chunk(int(x+(1000/chunk_size * 421)), int(z+(1000/chunk_size * 31)), chunk_size=chunk_size, lod=lod, verbose=self.verbose)
        elif version == "quad":
            heightmap_binary = self.chunk_quad_builder.get_chunk(x, z, chunk_size=chunk_size, lod=lod, verbose=self.verbose)
        else:
            vprint(self.verbose, f"Unknown version: {version}. Defaulting to None.")
            heightmap_binary = None
            
        return heightmap_binary

