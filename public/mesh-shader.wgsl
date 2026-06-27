@group(0) @binding(0) var<uniform> vpMatrix : mat4x4<f32>;

struct VertexInput {
    @location(0) position : vec4<f32>,
    @location(1) color    : vec4<f32>,
};
struct VertexOutput {
    @builtin(position) position : vec4<f32>,
    @location(0) color          : vec4<f32>,
};

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;
  output.position = vpMatrix * input.position;
  output.color = input.color;
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
