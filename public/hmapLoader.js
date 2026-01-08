export function loadHeightMap(chunkX, chunkZ, size = 1000) {
    const url = `/get_chunk/${chunkX}/${chunkZ}`;

    return fetch(url)
        .then(response => {
            if (!response.ok) {
                throw new Error(`Failed to load chunk (${chunkX}, ${chunkZ}): ${response.statusText}`);
            }
            return response.arrayBuffer();
        })
        .then(buffer => {
            const data = new Uint8Array(buffer);
            const expectedLength = size * size * 5;

            if (data.length !== expectedLength) {
                throw new Error(`Unexpected data length: got ${data.length}, expected ${expectedLength}`);
            }

            // Create 2D grid: grid[x][y] = [r, g, b, height]
            const grid = Array.from({ length: size }, () => Array(size));

            const stride = 5; // 5 bytes per pixel

            for (let y = 0; y < size; y++) {
                for (let x = 0; x < size; x++) {
                    const index = x + y * size;      // pixel index
                    const base = index * stride;     // starting byte of this pixel

                    const r = data[base];
                    const g = data[base + 1];
                    const b = data[base + 2];

                    // Assuming big-endian uint16: first high byte, then low byte
                    const height = (data[base + 3] << 0) | (data[base + 4] << 8);

                    grid[x][y] = [r, g, b, height];
                }
            }

            return grid;
        });
}
