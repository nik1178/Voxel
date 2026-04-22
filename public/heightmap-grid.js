export default class HeightmapGrid {
    constructor(size, existingData = null) {
        this.size = size;
        this.data = existingData || new Float32Array(size * size * 4);
    }

    setPixel(x, z, r, g, b, h) {
        const index = (x * this.size + z) * 4;
        this.data[index] = r;
        this.data[index + 1] = g;
        this.data[index + 2] = b;
        this.data[index + 3] = h;
    }

    getR(x, z) { return this.data[(x * this.size + z) * 4]; }
    getG(x, z) { return this.data[(x * this.size + z) * 4 + 1]; }
    getB(x, z) { return this.data[(x * this.size + z) * 4 + 2]; }
    getHeight(x, z) { return this.data[(x * this.size + z) * 4 + 3]; }
}