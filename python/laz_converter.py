import laspy
import numpy as np
from tqdm import tqdm
from python.util.vprint import vprint

class LazConverter:
    
    CHUNK_SIZE = 1000 # meters
    EMPTY_VALUE = {
        'red': 0,
        'green': 0,
        'blue': 0,
        'height': 0
    }
    
    def scale_colors(self, colors, max_value=255):
        """Scale colors from 0-65535 to 0-255."""
        return (np.array(colors) / 65535 * max_value).astype(int)
    
    def create_accumulator(self, X, Y, Z, red, green, blue, verbose=False):
        vprint(verbose, "Generating accumulator...")
        accumulator = {}
        for x, y, z, r, g, b in tqdm(zip(X, Y, Z, red, green, blue)):
            key = (x, y)
            if key not in accumulator:
                accumulator[key] = [{
                    'height': z,
                    'red': r,
                    'green': g,
                    'blue': b
                }]
            else:
                accumulator[key].append({
                    'height': z,
                    'red': r,
                    'green': g,
                    'blue': b
                })
        
        return accumulator
    
    def accumulator_to_heightmap(self, accumulator, verbose=False):
        vprint(verbose, "Averaging heightmap values...")
        for key, values in tqdm(accumulator.items()):
            max_height = int(max(v['height'] for v in values))
            average_red = int(np.mean([v['red'] for v in values], dtype=np.int64))
            average_green = int(np.mean([v['green'] for v in values], dtype=np.int64))
            average_blue = int(np.mean([v['blue'] for v in values], dtype=np.int64))

            accumulator[key] = {
                'height': max_height,
                'red': average_red,
                'green': average_green,
                'blue': average_blue
            }
        
        return accumulator
    
    # def build_heightmap_binary(self, heightmap, X, Y, verbose=False):
    #     global EMPTY_VALUE
    #     vprint(verbose, "Building heightmap binary...")

    #     min_x = X.min()
    #     min_y = Y.min()

    #     buffer = bytearray()

    #     for x in range(min_x, min_x + self.CHUNK_SIZE):
    #         for y in range(min_y, min_y + self.CHUNK_SIZE):
    #             key = (x, y)
    #             if key in heightmap:
    #                 data = heightmap[key]
    #             else:
    #                 data = EMPTY_VALUE

    #             buffer.extend(np.uint8(data['red']).tobytes())
    #             buffer.extend(np.uint8(data['green']).tobytes())
    #             buffer.extend(np.uint8(data['blue']).tobytes())
    #             buffer.extend(np.uint16(data['height']).tobytes())

    #     return buffer

    def build_heightmap_binary(self, heightmap, verbose=False):
        vprint(verbose, "Building heightmap binary...")

        buffer = bytearray()

        for x in range(0, self.CHUNK_SIZE):
            for y in range(0, self.CHUNK_SIZE):
                data = heightmap[x, y]

                buffer.extend(np.uint8(data[0]).tobytes())
                buffer.extend(np.uint8(data[1]).tobytes())
                buffer.extend(np.uint8(data[2]).tobytes())
                buffer.extend(np.uint16(data[3]).tobytes())

        return buffer
    
    def build_csv(self, heightmap, X, Y, empty_value, verbose=False):
        vprint(verbose, "Building CSV string...")

        min_x = int(X.min())
        min_y = int(Y.min())

        lines = []
        lines.append("x,y,red,green,blue,height")

        for x in range(min_x, min_x + self.CHUNK_SIZE):
            for y in range(min_y, min_y + self.CHUNK_SIZE):
                key = (x, y)
                data = heightmap.get(key, empty_value)

                lines.append(
                    f"{x},{y},{data['red']},{data['green']},{data['blue']},{data['height']}"
                )

        return "\n".join(lines)

    
    def write_heightmap(self, heightmap, X, Y, OUT_FILE="heightmap.udo", verbose=False):
        global CHUNK_SIZE
        
        min_x = X.min()
        min_y = Y.min()
        with open(OUT_FILE+".txt", "w") as f:
            for x in range(min_x, min_x + CHUNK_SIZE):
                for y in range(min_y, min_y + CHUNK_SIZE):
                    key = (x, y)
                    if key in heightmap:
                        data = heightmap[key]
                        f.write(f"{data['red']} {data['green']} {data['blue']} {data['height']} | ")
                    else:
                        f.write(f"{EMPTY_VALUE['red']} {EMPTY_VALUE['green']} {EMPTY_VALUE['blue']} {EMPTY_VALUE['height']} | ")
                print(file=f)
    
    def heightmap_dic_to_array(self, heightmap, X, Y, verbose=False):
        
        vprint(verbose, "Converting heightmap dictionary to array...")
        min_x = X.min()
        min_y = Y.min()
        
        array = np.zeros((self.CHUNK_SIZE, self.CHUNK_SIZE, 4), dtype=np.uint16)
        
        for x in range(min_x, min_x + self.CHUNK_SIZE):
            for y in range(min_y, min_y + self.CHUNK_SIZE):
                key = (x, y)
                if key in heightmap:
                    data = heightmap[key]
                    array[x - min_x, y - min_y, 0] = data['red']
                    array[x - min_x, y - min_y, 1] = data['green']
                    array[x - min_x, y - min_y, 2] = data['blue']
                    array[x - min_x, y - min_y, 3] = data['height']
                else:
                    array[x - min_x, y - min_y, 0] = self.EMPTY_VALUE['red']
                    array[x - min_x, y - min_y, 1] = self.EMPTY_VALUE['green']
                    array[x - min_x, y - min_y, 2] = self.EMPTY_VALUE['blue']
                    array[x - min_x, y - min_y, 3] = self.EMPTY_VALUE['height']
        
        return array

    def laz_to_hmap(self, 
                    laz_file, 
                    voxel_size=100, # in centimeters
                    verbose=False
                    ):
        
        vprint(verbose, "Reading LAZ file...")
        laz = laspy.read(laz_file)
        
        vprint(verbose, "Converting to LAS format...")
        las = laspy.convert(laz)
        

        X = las.X
        Y = las.Y
        Z = las.Z
        red = las.red
        green = las.green
        blue = las.blue

        scale = las.header.scale
        offset = las.header.offset

        vprint(verbose, "Scaling coordinates...")
        X = np.array(X) * scale[0] + offset[0]
        Y = np.array(Y) * scale[1] + offset[1]
        Z = np.array(Z) * scale[2] + offset[2]
        
        vprint(verbose, "Converting to voxel size...")
        X = X / (voxel_size / 100) # converting cm to m
        Y = Y / (voxel_size / 100)
        Z = Z / (voxel_size / 100)

        vprint(verbose, "Rounding coordinates...")
        X = np.round(X).astype(int)
        Y = np.round(Y).astype(int)
        Z = np.round(Z).astype(int)

        vprint(verbose, "Scaling colors...")
        red = self.scale_colors(red)
        green = self.scale_colors(green)
        blue = self.scale_colors(blue)

        heightmap = self.create_accumulator(X, Y, Z, red, green, blue, verbose=verbose)
        heightmap = self.accumulator_to_heightmap(heightmap, verbose=verbose)
        heightmap = self.heightmap_dic_to_array(heightmap, X, Y, verbose=verbose)
        
        # print heightmap to file for debugging
        with open("heightmap_debug.txt", "w") as f:
            for x in range(heightmap.shape[0]):
                for y in range(heightmap.shape[1]):
                    data = heightmap[x, y]
                    f.write(f"{data[0]} {data[1]} {data[2]} {data[3]} | ")
                print(file=f)
        
        return heightmap

        # binary_data = self.build_heightmap_binary(heightmap, X, Y, EMPTY_VALUE, verbose=verbose)
        
        # if verbose:
        #     csv_data = self.build_csv(heightmap, X, Y, EMPTY_VALUE, verbose=verbose)
        #     with open(OUT_FILE + ".csv", "w") as f:
        #         f.write(csv_data)

        # with open(OUT_FILE, "wb") as f:
        #     f.write(binary_data)
            
        # vprint(verbose, "Heightmap generation complete.")