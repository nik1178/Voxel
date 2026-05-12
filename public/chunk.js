export default class Chunk {
    heightMap = null;
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
}