@group(0) @binding(0) var<uniform> vpMatrix : mat4x4<f32>;

@group(1) @binding(0) var nearestSampler: sampler;
@group(1) @binding(1) var heightMap: texture_2d<u32>;
@group(1) @binding(2) var colorMap: texture_2d<f32>;

struct ChunkInfo {
    x: f32,
    z: f32,
    size: f32,
    scale: f32,
    age: f32,
    manualCulling: f32,
    orientationOffset: f32,
    howManyFaces: f32,
}
@group(1) @binding(3) var<uniform> chunkInfo: ChunkInfo;

struct VertexInput {
    @location(0) position : vec4<u32>,        // From faceVertexBuffer (stepMode: "vertex")
    @location(1) instanceData : vec2<u32>,    // From instanceBuffer (stepMode: "instance")
};
// instanceData (64bits): 000000000 | ooo | hhhhhhhhhhhh | lzlzlzlz ||| lz | lxlxlxlxlx | zzzzzzzzzz | xxxxxxxxxx

struct VertexOutput {
    @builtin(position) position : vec4<f32>,
    @location(0) color          : vec4<f32>,
    @location(1) chunkCoord     : vec2<f32>,  // Actual [0..chunkSize] grid coordinate
    @location(2) quadUV         : vec2<f32>,  // Normalized [0..1] UV of the greedy quad
};

// A single iteration of Bob Jenkins' One-At-A-Time hashing algorithm for u32.
fn hash_u32(x_in: u32) -> u32 {
    var x = x_in;
    x += (x << 10u);
    x ^= (x >> 6u);
    x += (x << 3u);
    x ^= (x >> 11u);
    x += (x << 15u);
    return x;
}

// Construct a float with half-open range [0:1] using low 23 bits.
// All zeroes yields 0.0, all ones yields the next smallest representable value below 1.0.
fn float_construct_from_u32(m_in: u32) -> f32 {
    let ieeeMantissa = 0x007FFFFFu; // binary32 mantissa bitmask
    let ieeeOne = 0x3F800000u;      // 1.0 in IEEE binary32

    var m = m_in;
    m &= ieeeMantissa;              // Keep only mantissa bits (fractional part)
    m |= ieeeOne;                   // Add fractional part to 1.0

    let f = bitcast<f32>(m);        // Range [1:2]
    return f - 1.0;                 // Range [0:1]
}

// Pseudo-random value in half-open range [0:1] from a f32 seed.
fn random(seed: f32) -> f32 {
    return float_construct_from_u32(hash_u32(bitcast<u32>(seed)));
}

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;

  let chunkSize = u32(chunkInfo.size);

  let rawDataLeft = input.instanceData.x;
  let rawDataRight = input.instanceData.y;

  // 10 bits == 3FF
  // 8 bits == FF
  // 12 bits == FFF
  // 3 bits == 7
  let gridX = f32(rawDataRight & (0x3FFu));
  let gridZ = f32((rawDataRight >> 10u) & (0x3FFu));
  let lengthX = f32((rawDataRight >> 20u) & (0x3FFu));
  let lengthZ = f32(((rawDataRight >> 30u) & (0x3FFu)) | ((rawDataLeft & (0xFFu)) << 2u));
  let height = f32((rawDataLeft >> 8u) & (0xFFFu));
  let orientation = (rawDataLeft >> 20u) & (7u);

  // We are drawing just the top face.
  // The face geometry in renderer.js goes from x: 0..1, z: 0..1
  var localX = 0.0;
  var localY = 0.0;
  var localZ = 0.0;
  var shade = 1.0; // Add some fake lighting based on face normal
  var ix = f32(input.position.x) * lengthX;
  var iz = f32(input.position.z) * lengthZ;
  let texCoord = vec2<i32>(i32(gridX), i32(gridZ));

  if (orientation == 0u) {
    // Top face
    // 1.0 - ix and 1.0 - iz makes the top face CCW
    localX = ix;
    localY = height;
    localZ = iz;
    shade = 1.0;
  } else if (orientation == 1u) {
    // Front face (+z)
    let neighbor_h = f32(textureLoad(heightMap, texCoord + vec2<i32>(0, 1), 0).r);
    // if (neighbor_h >= height) { return output; }
    localX = lengthX - ix; // CCW winding
    localZ = 1;
    localY = neighbor_h + (height - neighbor_h) * iz;
    shade = 0.8;
    // output.position = vec4<f32>(0, 0, 0, 1.0);
    // return output;
  } else if (orientation == 3u) {
    // Back face (-z)
    let neighbor_h = f32(textureLoad(heightMap, texCoord + vec2<i32>(0, -1), 0).r);
    // if (neighbor_h >= height) { return output; }
    localX = ix;
    localZ = 0.0;
    localY = neighbor_h + (height - neighbor_h) * iz;
    shade = 0.8;
    // output.position = vec4<f32>(0, 0, 0, 1.0);
    // return output;
  } else if (orientation == 2u) {
    // Left face (-x)
    let neighbor_h = f32(textureLoad(heightMap, texCoord + vec2<i32>(1, 0), 0).r);
    // if (neighbor_h >= height) { return output; }
    localX = 1.0;
    localZ = iz;
    // localY = height + ix;
    localY = height + (height - neighbor_h) * (-ix);
    shade = 0.6;
    // output.position = vec4<f32>(0, 0, 0, 1.0);
    // return output;
  } else if (orientation == 4u) {
    // Right face (+x)
    let neighbor_h = f32(textureLoad(heightMap, texCoord + vec2<i32>(-1, 0), 0).r);
    // if (neighbor_h >= height) { return output; }
    localX = 0.0;
    localZ = iz;
    localY = height + (height - neighbor_h)*(-(1-ix));
    // localY = height + (height - neighbor_h) * ix;
    shade = 0.6;
    // output.position = vec4<f32>(0, 0, 0, 1.0);
    // return output;
  }
  
  // Calculate raw vertex coordinate in chunk space
  let vertexX = gridX + localX;
  let vertexZ = gridZ + localZ;
  
  output.chunkCoord = vec2<f32>(vertexX, vertexZ);
  output.quadUV = vec2<f32>(f32(input.position.x), f32(input.position.z));

  // Compute final world position
  var final_x = -(vertexX + chunkInfo.x * f32(chunkSize)) * chunkInfo.scale;
  var final_z = (vertexZ + chunkInfo.z * f32(chunkSize)) * chunkInfo.scale;
  let final_y = localY;

  /* if (orientation!=0u) {
    final_x = 0;
    final_z = 0;
  } */
  
  let world_pos = vec4<f32>(final_x, final_y, final_z, 1.0);

  output.position = vpMatrix * world_pos;
  
  // Color will be fetched in fragment shader!
  output.color = vec4<f32>(random(gridX*chunkInfo.x+chunkInfo.z + final_y), random(gridZ*chunkInfo.z + final_y), random(lengthX + gridX + final_y), 1.0);

  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  // Cast interpolated grid coordinates to int to sample color map perfectly!
  let texCoord = vec2<i32>(i32(input.chunkCoord.x-0.001), i32(input.chunkCoord.y-0.001));
  let color = textureLoad(colorMap, texCoord, 0);

  var r = color.r;
  var g = color.g;
  var b = color.b;
  var a = color.a;

  // Debug color: tint based on age
  let tint = chunkInfo.age;
  var finalColor = vec4<f32>(r + tint, g - tint, b - tint, a);

  // Draw wireframe around greedy quads to visibly see them
  // We use quadUV to check the boundaries of the greedy quad, NOT individual voxels.
  let edgeWidth = 0.02; 
  // let isEdge = input.quadUV.x < edgeWidth || input.quadUV.x > (1.0 - edgeWidth) ||
              //  input.quadUV.y < edgeWidth || input.quadUV.y > (1.0 - edgeWidth);
  let isEdge = false;
  if (isEdge) {
    return vec4<f32>(1.0, 0.0, 1.0, 1.0); // White wireframe
  }

  return finalColor;
}
