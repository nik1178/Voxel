export default class Chunk {
    heightMap = null;
    vertexBuffer = null;
    indexBuffer = null;
    indexCount = null;
    levelOfDetail = null;
    constructor(position, vertexBuffer = null, indexBuffer = null, indexCount = null, heightMap = null) {
        this.position = position;
        this.vertexBuffer = vertexBuffer;
        this.indexBuffer = indexBuffer;
        this.indexCount = indexCount;
        this.heightMap = heightMap;
    }

    setHeightMap(heightMap) {
        this.heightMap = heightMap;
    }

    setMeshData(vertexBuffer, indexBuffer, indexCount, levelOfDetail) {
        this.vertexBuffer = vertexBuffer;
        this.indexBuffer = indexBuffer;
        this.indexCount = indexCount;
        this.levelOfDetail = levelOfDetail;
    }

    setVertices(vertices) {
        this.vertices = vertices;
    }

}