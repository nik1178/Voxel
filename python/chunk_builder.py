import os
from python.util.vprint import vprint
from python.chunk_binary_manager import ChunkBinaryManager
import numpy as np
from python.laz_converter import LazConverter

class ChunkBuilder:
    extension = ".hmap"
    
    def __init__(self, voxel_size, data_dir, verbose=False):
        self.voxel_size = voxel_size
        self.data_dir = data_dir
        self.verbose = verbose
        
        self.chunk_binary_manager = ChunkBinaryManager(verbose)
        self.laz_converter = LazConverter()
    
    def chunk_string(self, x, z):
        return os.path.join(self.data_dir, str(self.voxel_size), f"{x}_{z}{self.extension}")
    
    
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
    
    def read_heightmap(self, x, z):
        with open(self.chunk_string(x, z), "rb") as f:
            heightmap_data = f.read()
        
        heightmap = self.chunk_binary_manager.binary_to_heightmap(heightmap_data, verbose=self.verbose)
        return heightmap
    
    def generate_chunk(self, x, z):
        vprint(self.verbose, f"Generating chunk at ({x}, {z})")
        # Placeholder for chunk generation logic
        if not os.path.isfile(self.laz_path(x, z)):
            vprint(self.verbose, f"LAZ file not found for chunk at ({x}, {z})")
            return 404
        
        heightmap = self.laz_converter.laz_to_hmap(
            laz_file=self.laz_path(x, z),
            voxel_size=self.voxel_size,
            verbose=self.verbose
        )
        
        binary_data = self.chunk_binary_manager.heightmap_to_binary(heightmap, verbose=self.verbose)
        
        with open(self.chunk_string(x, z), "wb") as f:
            f.write(binary_data)
    
    def chunk_exists(self, x, z):
        # Check if path data_dir/<voxel_size>/<x>_<z>.png exists
        return os.path.isfile(self.chunk_string(x, z))
    
    def create_heightmap_from_list(self, chunk_list, x, z, chunk_size=1000, laz_size=1000, verbose=False):
        # Create a heightmap for the requested chunk from the list of available chunks
        print("Chunk list:", chunk_list)
        
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
            
            laz_chunk = self.read_heightmap(chunk_x, chunk_z)
            
            temp_heightmap[(chunk_x - min_laz_x) * laz_size : (chunk_x - min_laz_x + 1) * laz_size,
                           (chunk_z - min_laz_z) * laz_size : (chunk_z - min_laz_z + 1) * laz_size, :] = laz_chunk
        
        x_start = (x * chunk_size) - (min_laz_x * laz_size)
        z_start = (z * chunk_size) - (min_laz_z * laz_size)
        x_end = x_start + chunk_size
        z_end = z_start + chunk_size
        
        heightmap = temp_heightmap[x_start:x_end, z_start:z_end, :]
        
        return heightmap
    
    def get_chunk_list(self, x, z, chunk_size=1000, laz_size=1000, verbose=False):
        
        x_start = x * chunk_size
        z_start = z * chunk_size
        x_end = x_start + chunk_size
        z_end = z_start + chunk_size
        
        chunk_list = []
        
        first_chunk_x = x_start // laz_size
        first_chunk_z = z_start // laz_size
        
        last_chunk_x = (x_end - 1) // laz_size
        last_chunk_z = (z_end - 1) // laz_size
        
        for chunk_x in range(first_chunk_x, last_chunk_x + 1):
            for chunk_z in range(first_chunk_z, last_chunk_z + 1):
                vprint(verbose, f"Processing sub-chunk at ({chunk_x}, {chunk_z})")
                if not self.chunk_exists(chunk_x, chunk_z):
                    vprint(verbose, f"Sub-chunk at ({chunk_x}, {chunk_z}) not found on disk.")
                    self.generate_chunk(chunk_x, chunk_z)
                    if not self.chunk_exists(chunk_x, chunk_z):
                        vprint(verbose, f"Chunk outside LAZ bounds at ({chunk_x}, {chunk_z})")
                        chunk_list.append(((chunk_x, chunk_z), 404))
                        continue
                chunk_list.append(((chunk_x, chunk_z), 200))
                        
        return chunk_list
    
    # Returns the chunk binary data for the requested chunk at (x, z) [based on chunk_size] and LOD
    def get_chunk(self, x, z, chunk_size=1000, lod=0, verbose=False):
        # Implementation to build chunk from heightmap data
        chunk_list = self.get_chunk_list(x, z, chunk_size=chunk_size, verbose=verbose)
        heightmap = self.create_heightmap_from_list(chunk_list, x, z, chunk_size=chunk_size, verbose=verbose)
        heightmap_lod = self.build_lod(heightmap, lod, CHUNK_SIZE=chunk_size, verbose=self.verbose)
        return self.chunk_binary_manager.heightmap_to_binary(heightmap_lod, verbose=verbose)