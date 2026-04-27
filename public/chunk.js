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

}