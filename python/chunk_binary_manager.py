from python.util.vprint import vprint
import numpy as np


class ChunkBinaryManager:
    def __init__(self, verbose=False):
        self.verbose = verbose

    def format_row(self, heightmap, y_index=0, x_start=0, x_count=4):
        hm = np.asarray(heightmap)
        x_end = min(x_start + x_count, hm.shape[0])

        cells = []
        for x in range(x_start, x_end):
            r, g, b, h = hm[x, y_index]
            cells.append(f"{int(r)} {int(g)} {int(b)} {int(h)}")

        return " | ".join(cells)

    def write_heightmap_text_file(self, heightmap, filename):
        hm = np.asarray(heightmap)
        width, height = hm.shape[0], hm.shape[1]

        with open(filename, "w", encoding="ascii") as f:
            for y in range(height):
                row = " | ".join(
                    f"{int(hm[x, y, 0])} {int(hm[x, y, 1])} {int(hm[x, y, 2])} {int(hm[x, y, 3])}"
                    for x in range(width)
                )
                f.write(row)
                f.write("\n")
        
    def heightmap_to_binary(self, heightmap, verbose=False):
        vprint(verbose, "Building heightmap binary...")

        hm = np.asarray(heightmap)

        # If your indexing is heightmap[x, y], that's typically an array laid out as [x, y, c].
        # Most image-like arrays are [y, x, c]. If needed, swap axes so output order matches your loop.
        # Comment this out if your data is already [y, x, c] or you actually want x-major order.
        hm = np.swapaxes(hm, 0, 1)  # now hm[y, x, c]

        rgb = hm[..., :3].astype(np.uint8, copy=False)      # (N, N, 3)
        h16 = hm[..., 3].astype(np.uint16, copy=False)      # (N, N)

        out = np.empty((hm.shape[0], hm.shape[1], 5), dtype=np.uint8)
        out[..., :3] = rgb
        out[..., 3:5] = h16[..., None].view(np.uint8)       # little-endian on typical machines

        return out.ravel().tobytes()
    
    def binary_to_heightmap(self, binary_data, CHUNK_SIZE=1000, verbose=False):
        vprint(verbose, "Converting binary to heightmap...")

        N = CHUNK_SIZE
        expected = N * N * 5
        if len(binary_data) != expected:
            raise ValueError(f"Expected {expected} bytes, got {len(binary_data)}")

        # Interpret raw bytes as uint8
        b = np.frombuffer(binary_data, dtype=np.uint8).reshape(N, N, 5)  # [y, x, r,g,b,h0,h1]

        # RGB stays uint8
        rgb = b[..., :3]

        # Height is little-endian uint16
        height = b[..., 3].astype(np.uint16) | (b[..., 4].astype(np.uint16) << 8)

        # Build output: RGB uint8 + height uint16
        out = np.empty((N, N, 4), dtype=np.uint16)
        out[..., :3] = rgb
        out[..., 3] = height

        # Match your original layout: array[x, y]
        return np.swapaxes(out, 0, 1)
    
if __name__ == "__main__":
    with open("./public/map/lod_output/1/0_0.hmap", "rb") as f:
        binary_data = f.read()
    manager = ChunkBinaryManager(verbose=True)
    heightmap = manager.binary_to_heightmap(binary_data, CHUNK_SIZE=1000, verbose=True)
    output_file = "./public/map/lod_output/1/0_0_full.txt"
    manager.write_heightmap_text_file(heightmap, output_file)
    print(f"Wrote full heightmap text to {output_file}")