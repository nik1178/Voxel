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

struct FragmentOutput {
    @location(0) color : vec4<f32>,
    @builtin(frag_depth) depth : f32,
};

@fragment
fn fragmentMain(input: VertexOutput) -> FragmentOutput {
    let ro = globals.cameraPosition.xyz;
    let rd = normalize(input.worldPos - globals.cameraPosition.xyz);

    let scale = chunkInfo.scale;
    let size = chunkInfo.size;
    let offsetX = chunkInfo.x * size;
    let offsetZ = chunkInfo.z * size;

    var startPos = input.worldPos;
    let tolerance = 0.0;
    if (ro.y < (chunkInfo.manualCulling + tolerance) && 
        -ro.x / scale >= (offsetX - tolerance) && -ro.x / scale <= (offsetX + size + tolerance) &&
        ro.z / scale >= (offsetZ - tolerance) && ro.z / scale <= (offsetZ + size + tolerance)) {
        startPos = ro;
    }
    
    let startGridX = (-startPos.x / scale) - offsetX;
    let startGridZ = (startPos.z / scale) - offsetZ;
    
    // Clamp to strictly ensure we start inside the valid chunk grid, 
    // cleanly absorbing any floating point inaccuracies from the AABB boundary
    var gridX = clamp(floor(startGridX), 0.0, size - 1.0);
    var gridZ = clamp(floor(startGridZ), 0.0, size - 1.0);
    
    let stepX = sign(-rd.x);
    let stepZ = sign(rd.z);

    var hit = false;
    var finalColor = vec4<f32>(0.0);
    var t = 0.0;
    let maxSteps = 1024;
    
    for (var i = 0; i < maxSteps; i++) {
        if (gridX < 0.0 || gridX >= size || gridZ < 0.0 || gridZ >= size) {
            break;
        }
        if (startPos.y + t * rd.y < 1.0) {
            break;
        }
        
        let texCoord = vec2<i32>(i32(gridX), i32(gridZ));
        let h = f32(textureLoad(heightMap, texCoord, 0).r);
        
        // 1. Check if we are currently inside the voxel
        if (startPos.y + t * rd.y <= h + 0.001) {
            hit = true;
            let color = textureLoad(colorMap, texCoord, 0);
            let shade = clamp(0.6, 0.2, 1.0);
            finalColor = vec4<f32>(color.r * shade, color.g * shade, color.b * sqrt(shade), color.a);
            break;
        }

        // 2. Calculate intersection 't' with the next X and Z grid planes
        let boundX = gridX + max(stepX, 0.0);
        let boundZ = gridZ + max(stepZ, 0.0);

        // Formula for intersection between line and plane
        // pointOrigin + t * rayDirection = plane
        // t = (plane - pointOrigin) / rayDirection
        var tx = 1e38;
        if (abs(rd.x) > 1e-8) {
            let planeX = -(boundX + offsetX) * scale;
            tx = (planeX - startPos.x) / rd.x;
        }

        var tz = 1e38;
        if (abs(rd.z) > 1e-8) {
            let planeZ = (boundZ + offsetZ) * scale;
            tz = (planeZ - startPos.z) / rd.z;
        }
        
        // 3. Calculate intersection 't' with the voxel's top plane (Y = h)
        var ty = 1e38;
        if (rd.y < 0.0) {
            ty = (h - startPos.y) / rd.y;
        }

        // 4. Advance ray to the closest plane
        if (tx < ty && tx < tz) {
            t = tx;
            gridX += stepX;
        } else if (tz < ty) {
            t = tz;
            gridZ += stepZ;
        } else {
            // Hit the top plane!
            t = ty;
            if (startPos.y + t * rd.y < 1.0) {
                break;
            }
            hit = true;
            let color = textureLoad(colorMap, texCoord, 0);
            finalColor = vec4<f32>(color.r, color.g, color.b, color.a);
            break;
        }
        
    }
    
    if (!hit) {
        discard;
    }
    
    let hitPos = startPos + t * rd;
    
    let dist = hitPos - ro;
    let fog = sqrt(clamp(length(dist) / 150000.0, 0.0, 1.0));
    finalColor = mix(finalColor, vec4<f32>(0.53, 0.81, 0.92, 1.0), fog);
    
    let clipPos = globals.vpMatrix * vec4<f32>(hitPos, 1.0);
    
    var out: FragmentOutput;
    out.color = finalColor;
    out.depth = clipPos.z / clipPos.w;
    
    return out;
}
