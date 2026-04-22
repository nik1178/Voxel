# Voxel Viewer Architect & Optimization Plan

We analyzed the current client and server implementations for `d:\DProjects\Voxel\server`. Here are the findings and an actionable plan for reaching "as optimized as possible" operations for the WebGPU engine.

## Problem Analysis

The viewer creates a 3D geometry from a flat heightmap matrix by generating quads (4 vertices `vec4` + 4 colors `vec4f` = 32 bytes/vertex) for *every single data point*, plus "bridge/side" panels via additional indices. For a 1000x1000 chunk, there are 1,000,000 top surfaces resulting in ~4,000,000 floating point vertices per chunk manually generated on the CPU using JS arrays.

**The bottlenecks:**
1. Main thread execution is blocked during parsing/generating gigabytes worth of floats (`chunk-mesher.js`).
2. Very high memory pressure (~128MB per chunk) when a heightmap contains identical data in far smaller sizes (5MB per chunk).
3. Using single Draw calls `pass.drawIndexed(chunk.indexCount)` for heavy objects instead of indirect draws/render bundles.

## Optimization Blueprint

### 1. Offload Meshing from CPU to GPU
**Option A: Vertex Texture Fetch (VTF) via Shader**
- Instead of building a mesh out of actual vertices matching the 1000x1000 data map, WebGPU only needs **one** single underlying unit Index grid buffer (`x`,`z`).
- The Python server's `.hmap` binary array should be passed *directly* as a GPU `texture2D` of format `<R16Uint>` (for height) and `<RGBA8Unorm>` (for color). `hmap-loader.js` should not deserialize to Float32 arrays.
- In `shader.wgsl`, sample the heightmap texture inside the vertex shader to offset `position.y`. Use `floor(UV)` or special stepped grids to retain the hard Voxel look if necessary.

**Option B: GPU Compute Pipeline / Greedy Meshing**
- Pass the `.hmap` chunk into WebGPU buffers and invoke a `Compute Shader` to do exactly what `chunk-mesher.js` does, but utilizing thousands of GPU cores simultaneously, releasing the CPU entirely.
- Perform Greedy Meshing: if 10 consecutive heightmap cells have the same height and color, merge them into 1 big face structure reducing polygon counts massively.

### 2. Rendering Optimization
- Use **Indirect Drawing** (`drawIndexedIndirect`). Consolidate all Chunk textures into a `texture2DArray` or bindless arrays. Issue one Draw Indirect call for the entire world, preventing JS pipeline binding thrash.
- Introduce **Frustum Culling**. `quadTree` can be extended into a standard bounding-box view cull checks.

### 3. Asynchronicity & Web Workers
- The current `.hmap` extraction loops use heavy Typed Arrays conversion in the main thread. Push this functionality out to a Web Worker, which passes the resolved Data Arrays via `postMessage(..., [transferable])` avoiding heavy thread blocking. 

### Conclusion
Focusing on moving heightmap processing natively to the WebGPU pipeline will eliminate stuttering during chunks loading and permit massive scale terrain viewing with fractionally smaller memory requirements.
