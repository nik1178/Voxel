import os
import re
import math
import numpy as np

# --- CONFIGURATION ---
INPUT_DIR = "./server/public/map/100"        # Folder containing your original X_Z.hmap files
OUTPUT_DIR = "lod_output"   # Where the 1, 2, 3... folders will be created
CHUNK_SIZE = 1000
BYTES_PER_PIXEL = 5         # 3 bytes RGB + 2 bytes Height = 5 bytes

def build_lod_tree():
    if not os.path.exists(INPUT_DIR):
        print(f"Error: Input directory '{INPUT_DIR}' not found.")
        return

    # 1. Find the bounds of the existing world
    coords = []
    for filename in os.listdir(INPUT_DIR):
        match = re.match(r"(-?\d+)_(-?\d+)\.hmap", filename)
        if match:
            coords.append((int(match.group(1)), int(match.group(2))))
            
    if not coords:
        print("No valid chunk files found in input directory.")
        return

    min_x = min(c[0] for c in coords)
    max_x = max(c[0] for c in coords)
    min_z = min(c[1] for c in coords)
    max_z = max(c[1] for c in coords)

    width = max_x - min_x + 1
    depth = max_z - min_z + 1

    # 2. Determine the quadtree dimensions (must be a power of 2)
    S = 2 ** math.ceil(math.log2(max(width, depth)))
    N = int(math.log2(S)) + 1

    print(f"World bounds: X[{min_x} to {max_x}], Z[{min_z} to {max_z}]")
    print(f"Quadtree size: {S}x{S} chunks. Total LOD levels: {N}")

    # 3. Recursive function to build the tree bottom-up
    def process_quadtree(LOD, x, z):
        if LOD == N:
            # BASE LEVEL
            orig_x = min_x + x
            orig_z = min_z + z
            filepath = os.path.join(INPUT_DIR, f"{orig_x}_{orig_z}.hmap")

            if not os.path.exists(filepath):
                return None # The chunk doesn't exist, return None to notify the parent
                
            with open(filepath, 'rb') as f:
                chunk = np.frombuffer(f.read(), dtype=np.uint8).reshape((CHUNK_SIZE, CHUNK_SIZE, BYTES_PER_PIXEL))
        else:
            # RECURSIVE CASE
            P_TL = process_quadtree(LOD + 1, 2*x, 2*z)
            P_TR = process_quadtree(LOD + 1, 2*x + 1, 2*z)
            P_BL = process_quadtree(LOD + 1, 2*x, 2*z + 1)
            P_BR = process_quadtree(LOD + 1, 2*x + 1, 2*z + 1)

            # If all 4 children are completely empty, this chunk is completely empty.
            # Abort and do not create a file.
            if P_TL is None and P_TR is None and P_BL is None and P_BR is None:
                return None

            # If we get here, AT LEAST ONE child has data. We must build this chunk.
            # We initialize with zeros to act as padding for any missing children.
            chunk = np.zeros((CHUNK_SIZE, CHUNK_SIZE, BYTES_PER_PIXEL), dtype=np.uint8)
            
            if P_TL is not None: chunk[0:500, 0:500] = P_TL
            if P_TR is not None: chunk[0:500, 500:1000] = P_TR
            if P_BL is not None: chunk[500:1000, 0:500] = P_BL
            if P_BR is not None: chunk[500:1000, 500:1000] = P_BR

        # Create output directory for this LOD
        lod_dir = os.path.join(OUTPUT_DIR, str(LOD))
        os.makedirs(lod_dir, exist_ok=True)
        out_filepath = os.path.join(lod_dir, f"{x}_{z}.hmap")

        if LOD == 1:
            # ROOT LEVEL: Save the entire 1000x1000 chunk
            with open(out_filepath, 'wb') as f:
                f.write(chunk.ravel().tobytes())
            print(f"Saved Root LOD 1: {out_filepath}")
            return None
        else:
            # ALL OTHER LEVELS: Save only the NEW data (75%)
            parent_pixels = chunk[0::2, 0::2] 

            TR = chunk[0::2, 1::2]
            BL = chunk[1::2, 0::2]
            BR = chunk[1::2, 1::2]
            new_pixels = np.stack([TR, BL, BR], axis=-2)

            with open(out_filepath, 'wb') as f:
                f.write(new_pixels.ravel().tobytes())
                
            return parent_pixels

    print("Building sparse quadtree... (Empty branches will be skipped)")
    process_quadtree(1, 0, 0)
    print("Done!")

if __name__ == "__main__":
    build_lod_tree()