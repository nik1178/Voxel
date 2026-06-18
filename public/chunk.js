export default class Chunk {
    heightMap = null; //Actual 2D array heightMap
    rawData = null; //Heightmap and colormap as bits in buffer
    vertexBuffer = null;
    indexBuffer = null;
    vertices = null;
    indexCount = null;
    levelOfDetail = null;
    scale = 1;
    colorTexture = null;
    heightTexture = null;
    vtfBindGroup = null;
    age = 1.0;
    chunkSize = 128;
    instanceArray = null;
    maxHeight = null;

    constructor(position, vertexBuffer = null, indexBuffer = null, indexCount = null, heightMap = null, levelOfDetail = null) {
        this.position = position;
        this.vertexBuffer = vertexBuffer;
        this.indexBuffer = indexBuffer;
        this.indexCount = indexCount;
        this.heightMap = heightMap;
        this.levelOfDetail = levelOfDetail;
    }

    setHeightMap(heightMap) {
        this.heightMap = heightMap;
    }

    setTextures(colorTexture, heightTexture, bindGroup = null) {
        this.colorTexture = colorTexture;
        this.heightTexture = heightTexture;
        this.vtfBindGroup = bindGroup;
    }

    setMeshData(vertexBuffer, indexBuffer, indexCount) {
        this.vertexBuffer = vertexBuffer;
        this.indexBuffer = indexBuffer;
        this.indexCount = indexCount;
    }

    setVertices(vertices) {
        this.vertices = vertices;
    }

    getWorldPosition(strategy, chunkSize) {
        if (strategy == "quad") {
            return [-(this.position.x + 0.5) * chunkSize * this.scale, 0, (this.position.z + 0.5) * chunkSize * this.scale];
        }

        return [this.position.x * chunkSize * this.scale, 0, this.position.z * chunkSize * this.scale];
    }

    destroy() {
        this.vertexBuffer?.destroy();
        this.indexBuffer?.destroy();
        this.vertices = null;
        this.indexCount = null;
        this.heightMap = null;
        this.colorTexture?.destroy();
        this.colorTexture = null;
        this.heightTexture?.destroy();
        this.heightTexture = null;
        this.chunkInfoBuffer?.destroy();
        this.chunkInfoBuffer = null;
        this.vtfBindGroup = null;
    }

    distanceFromPlayer(playerPosition) {
        const chunkPos = this.getWorldPosition("quad", this.chunkSize);

        // Align coordinates with the engine's inverted X logic
        const px = -playerPosition.x;
        const pz = playerPosition.z;
        const cx = -chunkPos[0]; // chunkPos[0] is already negated in getWorldPosition
        const cz = chunkPos[2];

        const halfSize = 0.5 * this.chunkSize * this.scale;

        // Calculate distance to the box on each axis. 
        // If the point is inside the box on an axis, the distance on that axis is 0.
        const dx = Math.max(0, Math.abs(px - cx) - halfSize);
        const dz = Math.max(0, Math.abs(pz - cz) - halfSize);

        // Return Euclidean distance. If both dx and dz are 0, player is inside the chunk.
        return Math.sqrt(dx * dx + dz * dz);
    }

    getMaxHeight() {
        if (this.maxHeight !== null) {
            return this.maxHeight;
        }
        if (!this.rawData || !this.rawData.heightData) {
            throw new Error("Chunk does not have height map");
        }
        this.maxHeight = 0;
        for (let i = 0; i < this.rawData.heightData.length; i++) {
            if (this.rawData.heightData[i] > this.maxHeight) {
                this.maxHeight = this.rawData.heightData[i];
            }
        }
        return this.maxHeight;
    }

    getWorldAABB() {
        return {
            min: {
                x: this.position.x * this.chunkSize * this.scale,
                y: 0,
                z: this.position.z * this.chunkSize * this.scale
            },
            max: {
                x: (this.position.x + 1) * this.chunkSize * this.scale,
                y: this.getMaxHeight(),
                z: (this.position.z + 1) * this.chunkSize * this.scale
            }
        }
    }

    getAABB() {
        return {
            min: {
                x: 0,
                y: 0,
                z: 0
            },
            max: {
                x: this.chunkSize,
                y: this.getMaxHeight(),
                z: this.chunkSize
            }
        }
    }
}