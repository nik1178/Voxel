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
    @location(0) position : vec4<u32>,
    @builtin(instance_index) instance_index : u32,
};

struct VertexOutput {
    @builtin(position) position : vec4<f32>,
    @location(0) color          : vec4<f32>,
    @location(1) chunkUV        : vec2<f32>,
};

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;

  let chunkSize = u32(chunkInfo.size);

  var voxelIndex = input.instance_index / 5u;
  if (chunkInfo.manualCulling == 1) {
    voxelIndex = input.instance_index / u32(chunkInfo.howManyFaces);
  }
  var orientation = input.instance_index % 5u;
  if (chunkInfo.manualCulling == 1) {
    orientation = 0u;
    let voxelInstanceIndex = input.instance_index % u32(chunkInfo.howManyFaces);
    if (voxelInstanceIndex != 0) {
      orientation = voxelInstanceIndex - 1u;
      orientation+=u32(chunkInfo.orientationOffset);
      orientation %= 4u;
      orientation += 1u;
    }
  }

  let u_idx = voxelIndex % chunkSize;
  let v_idx = voxelIndex / chunkSize;
  
  let x = f32(u_idx);
  let z = f32(v_idx);
  
  let texCoord = vec2<i32>(i32(u_idx), i32(v_idx));
  let height_val = f32(textureLoad(heightMap, texCoord, 0).r);

  if (height_val == 0) {
    output.position = vec4<f32>(0.0);
    return output;
  }

  let ix = f32(input.position.x);
  let iz = f32(input.position.z);

  var localX = 0.0;
  var localY = 0.0;
  var localZ = 0.0;
  var shade = 1.0; // Add some fake lighting based on face normal

  if (orientation == 0u) {
    // Top face
    // 1.0 - ix and 1.0 - iz makes the top face CCW
    localX = ix;
    localY = height_val;
    localZ = iz;
    shade = 1.0;
  } else if (orientation == 1u) {
    // Front face (+z)
    let neighbor_h = f32(textureLoad(heightMap, texCoord + vec2<i32>(0, 1), 0).r);
    if (neighbor_h >= height_val) {
      output.position = vec4<f32>(0.0);
      return output;
    }
    localX = 1.0 - ix; // CCW winding
    localZ = 1.0;
    localY = neighbor_h + (height_val - neighbor_h) * iz;
    shade = 0.8;
  } else if (orientation == 3u) {
    // Back face (-z)
    let neighbor_h = f32(textureLoad(heightMap, texCoord + vec2<i32>(0, -1), 0).r);
    if (neighbor_h >= height_val) {
      output.position = vec4<f32>(0.0);
      return output;
    }
    localX = ix;
    localZ = 0.0;
    localY = neighbor_h + (height_val - neighbor_h) * iz;
    shade = 0.8;
  } else if (orientation == 4u) {
    // Left face (-x)
    let neighbor_h = f32(textureLoad(heightMap, texCoord + vec2<i32>(-1, 0), 0).r);
    if (neighbor_h >= height_val) {
      output.position = vec4<f32>(0.0);
      return output;
    }
    localX = 0.0;
    localZ = 1.0 - ix; // Z maps to local X of the face
    localY = neighbor_h + (height_val - neighbor_h) * iz;
    shade = 0.6;
  } else if (orientation == 2u) {
    // Right face (+x)
    let neighbor_h = f32(textureLoad(heightMap, texCoord + vec2<i32>(1, 0), 0).r);
    if (neighbor_h >= height_val) {
      output.position = vec4<f32>(0.0);
      return output;
    }
    localX = 1.0;
    localZ = ix;
    localY = neighbor_h + (height_val - neighbor_h) * iz;
    shade = 0.6;
  }

  if (localY == 0) {
    localY = height_val;
  }

  let fx = -(x + chunkInfo.x * f32(chunkSize)) * chunkInfo.scale;
  let fz = (z + chunkInfo.z * f32(chunkSize)) * chunkInfo.scale;
  
  let final_x = fx - (localX * chunkInfo.scale);
  let final_y = localY;
  let final_z = fz + (localZ * chunkInfo.scale);

  let world_pos = vec4<f32>(final_x, final_y, final_z, 1.0);
  output.position = vpMatrix * world_pos;
  
  let color = textureLoad(colorMap, texCoord, 0);
  output.color = vec4<f32>(color.rgb * shade, color.a);
  
  // Calculate normalized chunk coordinates [0, 1]
  output.chunkUV = vec2<f32>((x + localX) / f32(chunkSize), (z + localZ) / f32(chunkSize));

  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  var r = input.color.r;
  var g = input.color.g;
  var b = input.color.b;
  var a = input.color.a;

  // Debug color: tint red based on age
  let tint = chunkInfo.age;
  var finalColor = vec4<f32>(r + tint, g - tint, b - tint, a);

  // Draw white outline at chunk boundaries
  // We check if we are near the [0, 1] edges of the chunkUV
  let edgeWidth = 0.02; // Adjust for thickness
  let isEdge = input.chunkUV.x < edgeWidth || input.chunkUV.x > (1.0 - edgeWidth) ||
               input.chunkUV.y < edgeWidth || input.chunkUV.y > (1.0 - edgeWidth);

  if (isEdge) {
    return vec4<f32>(1.0, 1.0, 1.0, 1.0);
  }

  return finalColor;
}
