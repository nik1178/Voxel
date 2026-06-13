struct GlobalUniforms {
    vpMatrix: mat4x4<f32>,
    invVpMatrix: mat4x4<f32>,
    cameraPosition: vec4<f32>,
}

@group(0) @binding(0) var<uniform> globals : GlobalUniforms;
@group(0) @binding(1) var textureSampler: sampler;
@group(0) @binding(2) var colorTexture: texture_2d<f32>;
@group(0) @binding(3) var depthTexture: texture_depth_2d;
@group(0) @binding(4) var bloomTexture: texture_2d<f32>;
@group(0) @binding(5) var skyboxTexture: texture_2d<f32>;

struct VertexOutput {
    @builtin(position) position : vec4<f32>,
    @location(0) uv: vec2<f32>,
};

@vertex
fn vertexMain(@builtin(vertex_index) VertexIndex : u32) -> VertexOutput {
    var output: VertexOutput;
    
    // Generate a full screen triangle
    // Index 0: (u=0, v=0) -> pos(-1,  1)
    // Index 1: (u=2, v=0) -> pos( 3,  1)
    // Index 2: (u=0, v=2) -> pos(-1, -3)
    let u = f32((VertexIndex << 1u) & 2u);
    let v = f32(VertexIndex & 2u);
    
    output.uv = vec2<f32>(u, v);
    output.position = vec4<f32>(u * 2.0 - 1.0, 1.0 - v * 2.0, 0.0, 1.0);
    
    return output;
}

// ---------------------------------------------------------
// BLOOM PASSES
// ---------------------------------------------------------
@group(0) @binding(0) var blurSampler: sampler;
@group(0) @binding(1) var blurSource: texture_2d<f32>;

@fragment
fn extractBright(input: VertexOutput) -> @location(0) vec4<f32> {
    let color = textureSample(blurSource, blurSampler, input.uv);
    // Extract pixels with high luminance
    let luminance = dot(color.rgb, vec3<f32>(0.2126, 0.7152, 0.0722));
    let threshold = 0.9;
    if (luminance > threshold) {
        return color;
    }
    return vec4<f32>(0.0, 0.0, 0.0, 1.0);
}

@fragment
fn blurX(input: VertexOutput) -> @location(0) vec4<f32> {
    let texDimensions = vec2<f32>(textureDimensions(blurSource));
    let texelSize = 1.0 / texDimensions.x;
    var result = vec4<f32>(0.0);
    let weights = array<f32, 5>(0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);
    
    result += textureSample(blurSource, blurSampler, input.uv) * weights[0];
    for (var i = 1; i < 5; i++) {
        let offset = vec2<f32>(texelSize * f32(i), 0.0);
        result += textureSample(blurSource, blurSampler, input.uv + offset) * weights[i];
        result += textureSample(blurSource, blurSampler, input.uv - offset) * weights[i];
    }
    return result;
}

@fragment
fn blurY(input: VertexOutput) -> @location(0) vec4<f32> {
    let texDimensions = vec2<f32>(textureDimensions(blurSource));
    let texelSize = 1.0 / texDimensions.y;
    var result = vec4<f32>(0.0);
    let weights = array<f32, 5>(0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);
    
    result += textureSample(blurSource, blurSampler, input.uv) * weights[0];
    for (var i = 1; i < 5; i++) {
        let offset = vec2<f32>(0.0, texelSize * f32(i));
        result += textureSample(blurSource, blurSampler, input.uv + offset) * weights[i];
        result += textureSample(blurSource, blurSampler, input.uv - offset) * weights[i];
    }
    return result;
}

// ---------------------------------------------------------
// FINAL COMPOSITE PASS
// ---------------------------------------------------------

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
    let texDimensions = textureDimensions(colorTexture);
    let coords = vec2<i32>(i32(input.uv.x * f32(texDimensions.x)), i32(input.uv.y * f32(texDimensions.y)));
    
    var colorValue = textureLoad(colorTexture, coords, 0);
    let depthValue = textureLoad(depthTexture, coords, 0);
    
    // Depth of Field (Single-pass Bokeh style blur)
    let focusDistance = 10.0; // The distance that is perfectly in focus
    let focalRange = 10000.0;   // How fast it gets blurry
    let maxBlur = 0.002;        // Maximum UV radius for blur

    // Reconstruct world position to find exact distance
    let ndc = vec4<f32>(input.uv.x * 2.0 - 1.0, 1.0 - input.uv.y * 2.0, depthValue, 1.0);
    var worldPos = globals.invVpMatrix * ndc;
    worldPos = worldPos / worldPos.w;
    let dist = length(worldPos.xyz - globals.cameraPosition.xyz);
    
    // Calculate circle of confusion (how out of focus this pixel is)
    var coc = 0.0;
    if (depthValue < 1.0) {
        coc = clamp(abs(dist - focusDistance) / focalRange, 0.0, 1.0);
    }
    
    // If the pixel is out of focus, do a localized multi-tap blur
    if (coc > 0.05 && depthValue < 1.0) {
        var blurredColor = vec4<f32>(0.0);
        let blurRadius = maxBlur * coc;
        var samples = 0.0;
        
        // 16-tap Poisson disk style pseudo-random sampling
        let taps = array<vec2<f32>, 16>(
            vec2<f32>(-0.326212,-0.40581), vec2<f32>(-0.840144,-0.07358),
            vec2<f32>(-0.695914,0.457137), vec2<f32>(-0.203345,0.620716),
            vec2<f32>(0.96234,-0.194983), vec2<f32>(0.473434,-0.480026),
            vec2<f32>(0.519456,0.767022), vec2<f32>(0.185461,-0.893124),
            vec2<f32>(0.507431,0.064425), vec2<f32>(0.89642,0.412458),
            vec2<f32>(-0.32194,-0.932615), vec2<f32>(-0.791559,-0.59771),
            vec2<f32>(0.063326,0.142369), vec2<f32>(-0.094184,-0.163351),
            vec2<f32>(0.08637,0.92659), vec2<f32>(-0.45524,0.923145)
        );
        
        for (var i = 0; i < 16; i++) {
            let offsetUV = input.uv + taps[i] * blurRadius;
            blurredColor += textureSample(colorTexture, textureSampler, offsetUV);
            samples += 1.0;
        }
        colorValue = blurredColor / samples;
    }

    // Sample Bloom and additively blend it
    let bloomColor = textureSample(bloomTexture, textureSampler, input.uv);
    colorValue = colorValue + bloomColor;

    let dir = normalize(worldPos.xyz - globals.cameraPosition.xyz);
    let sky_u = 0.5 + atan2(dir.z, dir.x) / (2.0 * 3.14159265);
    let sky_v = 0.5 - asin(dir.y) / 3.14159265;
    let skyColor = textureSample(skyboxTexture, textureSampler, vec2<f32>(sky_u, sky_v));
    let staticSkyColor = vec4<f32>(0.53, 0.81, 0.92, 1.0);

    if (depthValue >= 1.0) {
        return skyColor + bloomColor + staticSkyColor/3.0;
    }
    
    // Calculate exponential fog
    let fogAmount = sqrt(clamp(dist / 150000.0, 0.0, 1.0));
    
    // Blend final pixel
    let finalColor = mix(colorValue, staticSkyColor, fogAmount);
    
    return finalColor;
}
