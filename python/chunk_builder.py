import os
from python.util.vprint import vprint
from python.chunk_binary_manager import ChunkBinaryManager
import numpy as np

class ChunkBuilder:
    extension = ".hmap"
    
    def __init__(self, voxel_size, data_dir, verbose=False):
        self.voxel_size = voxel_size
        self.data_dir = data_dir
        self.verbose = verbose
        
        self.chunk_binary_manager = ChunkBinaryManager(verbose)
    
    def chunk_string(self, x, z):
        return os.path.join(self.data_dir, str(self.voxel_size), f"{x}_{z}{self.extension}")
    
    # def build_lod(self, heightmap, lod, CHUNK_SIZE=1000, verbose=False):
    #     if lod == 0:
    #         return heightmap
        
    #     factor = 2 ** lod
    #     new_size = CHUNK_SIZE // factor
    #     lod_heightmap = np.zeros((new_size, new_size, 4), dtype=np.uint16)
        
    #     print("OG len: ", len(heightmap), " New size: ", new_size)
    #     # This is a slow down
        
    #     for x in range(new_size):
    #         for y in range(new_size):
    #             sum_red = 0
    #             sum_green = 0
    #             sum_blue = 0
    #             sum_height = 0
    #             count = 0
                
    #             for dx in range(factor):
    #                 for dy in range(factor):
    #                     orig_x = x * factor + dx
    #                     orig_y = y * factor + dy
    #                     if orig_x < CHUNK_SIZE and orig_y < CHUNK_SIZE:
    #                         data = heightmap[orig_x, orig_y]
    #                         sum_red += data[0]
    #                         sum_green += data[1]
    #                         sum_blue += data[2]
    #                         sum_height += data[3]
    #                         count += 1
                
    #             if count > 0:
    #                 lod_heightmap[x, y] = (
    #                     sum_red // count,
    #                     sum_green // count,
    #                     sum_blue // count,
    #                     sum_height // count
    #                 )
    #             else:
    #                 lod_heightmap[x, y] = (0, 0, 0, 0)
        
    #     return lod_heightmap
    
    def build_lod(self, heightmap, lod, CHUNK_SIZE=1000, verbose=False):
        if lod == 0:
            return heightmap

        factor = 2 ** lod
        new_size = CHUNK_SIZE // factor

        hm = np.asarray(heightmap)

        # Crop to a multiple of factor so reshape works cleanly
        x0 = new_size * factor
        y0 = new_size * factor
        hm_c = hm[:x0, :y0, :]

        # Reshape into blocks: (new_x, factor, new_y, factor, channels)
        # then average over the factor dims
        blocks = hm_c.reshape(new_size, factor, new_size, factor, 4)

        # Use uint32 to avoid overflow during summation
        summed = blocks.astype(np.uint32).sum(axis=(1, 3))
        lod_hm = (summed // (factor * factor)).astype(np.uint16)

        return lod_hm
    
    def get_chunk(self, x, z, chunk_size=1000, lod=0, verbose=False):
        # Implementation to build chunk from heightmap data
        heightmap_data = None
        with open(self.chunk_string(x, z), "rb") as f:
            heightmap_data = f.read()
        
        heightmap = self.chunk_binary_manager.binary_to_heightmap(heightmap_data, verbose=self.verbose)
        heightmap_lod = self.build_lod(heightmap, lod, verbose=self.verbose)
        return heightmap_lod