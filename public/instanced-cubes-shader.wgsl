@group(0) @binding(0) var<uniform> vpMatrix : mat4x4<f32>;

@group(1) @binding(0) var nearestSampler: sampler;
@group(1) @binding(1) var heightMap: texture_2d<u32>;
@group(1) @binding(2) var colorMap: texture_2d<f32>;

struct ChunkInfo {
    x: f32,
    z: f32,
    size: f32,
    scale: f32,
}
@group(1) @binding(3) var<uniform> chunkInfo: ChunkInfo;

struct VertexInput {
    @location(0) position : vec3<f32>,
    @builtin(instance_index) instance_index : u32,
};

struct VertexOutput {
    @builtin(position) position : vec4<f32>,
    @location(0) color          : vec4<f32>,
};

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;

  let chunkSize = u32(chunkInfo.size);
  let u_idx = input.instance_index % chunkSize;
  let v_idx = input.instance_index / chunkSize;
  
  let x = f32(u_idx);
  let z = f32(v_idx);
  
  let texCoord = vec2<i32>(i32(u_idx), i32(v_idx));
  let height_val = f32(textureLoad(heightMap, texCoord, 0).r);
  
  // Calculate inset to prevent Z-fighting
  // If the vertex is at the base (y=0), we inset it slightly more than the top (y=1)
  // this creates a very slight "taper" that prevents adjacent faces from overlapping
  let inset = 1.0 - (1.0 - input.position.y) * 0.1;
  let localX = (input.position.x - 0.5) * inset + 0.5;
  let localZ = (input.position.z - 0.5) * inset + 0.5;

  let fx = -(x + chunkInfo.x * chunkInfo.size) * chunkInfo.scale;
  let fz = (z + chunkInfo.z * chunkInfo.size) * chunkInfo.scale;
  
  let final_x = fx - (localX * chunkInfo.scale);
  let final_y = height_val * input.position.y;
  let final_z = fz + (localZ * chunkInfo.scale);
  
  let world_pos = vec4<f32>(final_x, final_y, final_z, 1.0);
  output.position = vpMatrix * world_pos;
  
  let color = textureLoad(colorMap, texCoord, 0);
  output.color = color;
  
  return output;
}



@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  // var r = input.color.r;
  // var g = input.color.g;
  // var b = input.color.b;
  // var a = input.color.a;

  // // round to nearest tenth
  // r = round(r * 10.0) / 10.0;
  // g = round(g * 10.0) / 10.0;
  // b = round(b * 10.0) / 10.0;
  // a = round(a * 10.0) / 10.0;
  // return vec4<f32>(r, g, b, a);

  return input.color;
}
