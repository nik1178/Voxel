# WebGPU Voxel Viewer Master Architecture Plan

While introducing a Quadtree is technically sound for managing spatial visibility and LOD, **it does not solve the underlying render pipeline bottlenecks.** The viewer remains laggy because rendering and generating the data structure still crushes the main thread and GPU memory. 

Here is a comprehensive roadmap for upgrading the project, categorizing what you must fix immediately to remove lag versus what will elevate the engine in the future.

---

## 1. Immediate Focus: Unblocking the Engine (Why is it still laggy?)

Right now, the viewer's "engine" behaves like an immediate-mode CPU generator rather than an optimized GPU renderer. Solving these will instantly remove all freezing.

### A. Main Thread Blocking (The Stuttering Issue)
*   **The Problem:** `chunk-mesher.js` loops hundreds of thousands of times to calculate 3D flat cube vertices, index connections, and "bridge" vertical drops. It does this synchronously on the main UI thread. Every time the Quadtree requests a new lod/chunk, the entire browser locks up until it computes an enormous `Float32Array`.
*   **The Upgrade:** **Web Workers.** To immediately stop the freeze, the CPU-bound mesh building logic inside `chunk-mesher.js` must be moved to an asynchronous Web Worker. The worker builds the mesh, transfers the ArrayBuffer via `postMessage`, and keeps your engine running smoothly.

### B. Astronomical Vertex Format
*   **The Problem:** The shader takes `vec4<f32>` (16 bytes) for position and `vec4<f32>` (16 bytes) for color per vertex. Because voxels are handled independently, a chunk can have over a million vertices. This is pushing hundreds of megabytes of identical position/color data to the GPU unnecessarily. 
*   **The Upgrade:** Compress the WebGPU Layout. Color should be passed as `<u8x4>` (4 bytes), and you can drop `w` from position arrays. 

---

## 2. Short/Mid-Term Focus: Modernizing the Graphics Pipeline

Once the engine stops freezing, the focus shifts to hardware acceleration and bypassing the CPU.

### A. Vertex Texture Fetch (VTF) for Heightmaps [CRITICAL]
*   **The Problem:** Building millions of quad polygons to represent a grid of heights is wildly inefficient.
*   **The Upgrade:** Do not build 3D mesh arrays from the heightmap. Instead, create *one* flat X/Z grid indexed mesh and use it globally. Pass the `hmap` data to the GPU strictly as a `texture2D`. Inside your `shader.wgsl` Vertex function, sample the texture at that coordinate to get your `Y` position (height) offset, and pass the color to the fragment shader. *This eliminates the need for `chunk-mesher.js` entirely.*

### B. Raw Binary Texture Passthrough
*   **The Problem:** `hmap-loader.js` manually loops through the binary buffer, biting it into a JS Array of values.
*   **The Upgrade:** WebGPU allows instancing textures directly from binary. The Python server's `.hmap` format consists of 16-bit height and 8-bit RGB data. You can copy the received ArrayBuffer bytes *directly* into a WebGPU `device.createTexture()` call (`R16Uint` for height / `RGBA8Unorm` for color). This yields virtually zero memory overhead.

### C. Eliminate Iterative Draw Calls
*   **The Problem:** `renderer.js` iterates over the `chunkManager.getChunkData()` and explicitly calls `pass.setVertexBuffer()` and `pass.drawIndexed()` per chunk. This has high CPU encoding overhead.
*   **The Upgrade:** Use **Draw Indexed Indirect**. You can dispatch all chunks in a single GPU draw call by binding a unified buffer and instructing WebGPU to render multiple sub-regions seamlessly.

---

## 3. Long-Term Focus: Scale & Engine Hardening

When the pipeline is fixed, the goal becomes visualizing the entire country of Slovenia without crashing the browser's Memory Limits.

### A. Deallocation & Memory Leaks
*   **The Problem:** As the Quadtree loads new higher-res child nodes, old distant nodes might be left residing in VRAM. 
*   **The Upgrade:** Implement rigorous Garbage Collection. When LODs change or chunks are out of view, you must fire `destroy()` on buffers/textures to clear the VRAM. Leaving floating arrays will quickly crash mobile/lower-end GPUs via OOM (Out Of Memory) exceptions.

### B. GPU Compute Shader (Greedy Meshing)
*   **The Problem:** If you absolutely *must* have explicitly drawn vertical "voxel/Minecraft sides" (and a simple VTF slope/step displacement mapping isn't enough), CPU greedy meshing still won't cut it.
*   **The Upgrade:** Use WebGPU **Compute Shaders**. Pass the raw `.hmap` to a Compute Pipeline that runs across thousands of GPU cores to evaluate neighbors and automatically output a minimized geometry buffer natively in the GPU hardware.

### C. Frustum Culling 
*   **The Problem:** Although the Quadtree scales detail, chunks outside the camera's view matrix are still sent through the Vertex pipeline in WebGPU.
*   **The Upgrade:** Compute Plane checks. Do not submit Draw or Index data for any chunk bounding-boxes that aren't inside the camera's vision frustum.

## Open Questions

Which strategy for visualization makes the most sense?
1. Treat it like a **Voxel Engine** (requires GPU Compute Shaders / Greedy meshing for explicitly mapped vertical blocks).
2. Treat it like an **Optimized GIS/Terrain Engine** (Instanced base quad + Vertex Texture Displacement via WGSL). This strategy is significantly faster and smoother for country-scale geodata.
