struct GlobalUniforms {
    vpMatrix: mat4x4<f32>,
    invVpMatrix: mat4x4<f32>,
    cameraPosition: vec4<f32>,
}
@group(0) @binding(0) var<uniform> globals : GlobalUniforms;

@group(1) @binding(0) var nearestSampler: sampler;
@group(1) @binding(1) var heightMap: texture_2d<u32>;
@group(1) @binding(2) var colorMap: texture_2d<f32>;

struct ChunkInfo {
    x: f32,
    z: f32,
    size: f32,
    scale: f32,
    age: f32,
    manualCulling: f32, // User passes chunk.getMaxHeight() here
    orientationOffset: f32,
    howManyFaces: f32,
}
@group(1) @binding(3) var<uniform> chunkInfo: ChunkInfo;

struct VertexInput {
    @location(0) position : vec4<u32>, // From gridVertexBuffer
};

struct VertexOutput {
    @builtin(position) position : vec4<f32>,
    @location(0) worldPos       : vec3<f32>,
};

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;

  let chunkSize = chunkInfo.size;
  let scale = chunkInfo.scale;
  let maxHeight = chunkInfo.manualCulling; 
  
  // gridVertexBuffer is 0..1 unit cube
  let localX = f32(input.position.x) * chunkSize;
  let localY = f32(input.position.y) * maxHeight;
  let localZ = f32(input.position.z) * chunkSize;

  // Match the Voxel coordinate system where X is inverted
  let worldX = -(localX + chunkInfo.x * chunkSize) * scale;
  let worldY = localY;
  let worldZ = (localZ + chunkInfo.z * chunkSize) * scale;

  let worldPos = vec4<f32>(worldX, worldY, worldZ, 1.0);
  
  output.position = globals.vpMatrix * worldPos;
  output.worldPos = worldPos.xyz;

  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
    let ro = globals.cameraPosition.xyz;
    let rd = normalize(input.worldPos - globals.cameraPosition.xyz);
    
    let scale = chunkInfo.scale;
    let size = chunkInfo.size;
    let offsetX = chunkInfo.x * size;
    let offsetZ = chunkInfo.z * size;

    var startPos = input.worldPos;
    if (ro.y < chunkInfo.manualCulling && 
        -ro.x / scale >= offsetX && -ro.x / scale <= offsetX + size &&
        ro.z / scale >= offsetZ && ro.z / scale <= offsetZ + size) {
        startPos = ro;
    }
    
    // Grid space continuous coordinates
    let startGridX = (-startPos.x / scale) - offsetX;
    let startGridZ = (startPos.z / scale) - offsetZ;
    
    // Ray velocity in grid space
    let velX = -rd.x / scale;
    let velZ = rd.z / scale;
    
    var gridX = floor(startGridX);
    var gridZ = floor(startGridZ);
    
    let stepX = sign(velX);
    let stepZ = sign(velZ);
    
    let tDeltaX = abs(1.0 / velX);
    let tDeltaZ = abs(1.0 / velZ);
    
    var tMaxX = (gridX + max(stepX, 0.0) - startGridX) / velX;
    var tMaxZ = (gridZ + max(stepZ, 0.0) - startGridZ) / velZ;
    
    // Handle edge cases where ray starts exactly on a boundary
    if (tMaxX <= 0.0001) { tMaxX += tDeltaX; }
    if (tMaxZ <= 0.0001) { tMaxZ += tDeltaZ; }
    if (abs(velX) < 1e-7) { tMaxX = 1e38; }
    if (abs(velZ) < 1e-7) { tMaxZ = 1e38; }

    var hit = false;
    var finalColor = vec4<f32>(0.0);
    var t = 0.0;
    let maxSteps = 1500;
    let tolerance = 0.0;
    
    for (var i = 0; i < maxSteps; i++) {
        if (gridX < -tolerance || gridX >= size + tolerance || gridZ < -tolerance || gridZ >= size + tolerance) {
            break;
        }
        
        let texCoord = vec2<i32>(i32(gridX), i32(gridZ));
        let h = f32(textureLoad(heightMap, texCoord, 0).r);
        
        let currentY = startPos.y + t * rd.y;
        let t_next = min(tMaxX, tMaxZ);
        let nextY = startPos.y + t_next * rd.y;
        
        if (currentY <= h) {
            // Hit the side of the voxel column or started inside
            let color = textureLoad(colorMap, texCoord, 0);
            let shade = clamp(currentY / chunkInfo.manualCulling, 0.2, 1.0);
            finalColor = vec4<f32>(color.rgb /** shade*/, color.a);
            hit = true;
            break;
        } else if (nextY <= h) {
            // Hit the top of the voxel column
            let color = textureLoad(colorMap, texCoord, 0);
            let shade = clamp(h / chunkInfo.manualCulling, 0.2, 1.0);
            finalColor = vec4<f32>(color.rgb * shade, color.a);
            hit = true;
            break;
        }
        
        if (tMaxX < tMaxZ) {
            t = tMaxX;
            tMaxX += tDeltaX;
            gridX += stepX;
            gridX = round(gridX);
        } else {
            t = tMaxZ;
            tMaxZ += tDeltaZ;
            gridZ += stepZ;
            gridZ = round(gridZ);
        }
        
        if (nextY < 0.0) {
            break;
        }
    }
    
    if (!hit) {
        discard;
    }
    return finalColor;
}
