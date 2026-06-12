# Voxel Raytracing Implementation Plan

This plan outlines how to transition your WebGPU engine from its current Vertex Texture Fetch (VTF) rasterization approach to a high-performance **Raymarching (Raytracing)** approach. 

By switching to raytracing, you can render massive voxel worlds at tiny scales because performance becomes proportional to the screen resolution rather than the number of voxels (geometry count).

## Problem with Current Approach
Right now, `shader.wgsl` and `instanced-greedy-shader.wgsl` generate actual geometry (quads) for each voxel face and use Vertex Texture Fetch to place them at the right height. Even with greedy meshing, small voxels create millions of polygons, bottlenecking the vertex shader and memory.

## Raytracing Solution
Instead of drawing quads for each voxel, we draw **one large bounding box** per chunk (or even just a full-screen quad). Inside the fragment shader, we cast a mathematical ray from the camera through the screen pixel and "walk" it across the 2D heightmap grid using a fast algorithm like 2.5D DDA (Digital Differential Analyzer).

## User Review Required

> [!WARNING]
> This is a significant architectural change to the rendering pipeline. It will bypass the need for `greedy-mesher.js` and `chunk-mesher.js` entirely, simplifying the CPU side but shifting all traversal logic to the GPU fragment shader.

## Proposed Changes

### 1. Update Uniform Buffers

To cast rays from the camera, the fragment shader needs more than just the `vpMatrix`. It needs the camera's world position and the Inverse View-Projection Matrix to calculate ray directions.

#### [MODIFY] `public/renderer.js`
- **Uniform Buffer Layout**: Expand `globalBindGroupLayout` to include the Inverse View-Projection matrix (`invVPMatrix`) and the Camera Position (`cameraPos`).
- **Uniform Buffer Sizing**: Increase `uniformBufferSize` from `16 * 4` to `(16 + 16 + 4) * 4` (VP Matrix, Inv VP Matrix, Camera Pos + padding).
- **`updateVPMatrix` function**: Update it to compute and send `inverse(vpMatrix)` and `camera.transform.translation`.

### 2. Modify Geometry and Rendering Logic

We no longer need instances or greedy meshes.

#### [MODIFY] `public/renderer.js`
- **Geometry**: Discard `this.faceVertexBuffer` and `this.faceIndexBuffer`. Create a new buffer containing a single Cube (AABB) that spans from `(0,0,0)` to `(chunkSize, MAX_HEIGHT, chunkSize)`.
- **Draw Call**: Change `pass.drawIndexed()` to draw the chunk's bounding box cube once per chunk. No instancing is required.
- **Pipeline Setup**: Remove `this.instanceBufferLayout`. Enable front-face culling instead of back-face culling so we can render rays even when the camera is *inside* the chunk bounding box.

### 3. Create the Raymarching Shader

This is where the magic happens. We'll write a new shader specifically for raymarching the heightmap.

#### [NEW] `public/raytrace-shader.wgsl`
- **Vertex Shader**: Projects the chunk's bounding box vertices using `vpMatrix`. Passes both the screen-space position and the world-space position to the fragment shader.
- **Fragment Shader**:
  1. **Ray Setup**: Calculates the ray origin (`cameraPos`) and ray direction (using `invVPMatrix` and the fragment's screen coordinates).
  2. **AABB Intersection**: Clips the ray to the chunk's bounding box.
  3. **Grid Traversal (DDA)**: Steps along the ray direction in 2D (`X` and `Z`).
  4. **Height Intersection**: At each grid step, fetch the height from the `heightMap`. If the ray's `Y` coordinate goes below the `heightMap` value at that `(X,Z)`, we found a hit!
  5. **Color & Shading**: Calculate the normal based on which face was hit (top, side), sample the `colorMap`, apply shading, and return the pixel color.

### 4. Remove Legacy Meshing Systems

Because the GPU directly queries the heightmap in the fragment shader, we don't need CPU-side meshing!

#### [MODIFY] `public/chunk-manager.js`
- Skip triggering greedy meshing Web Workers. Chunks are ready as soon as `hmap-loader.js` downloads them.

#### [DELETE] `public/greedy-mesher.js`
#### [DELETE] `public/chunk-mesher.js`
- No longer needed, freeing up massive CPU resources and memory.

## Verification Plan

### Manual Verification
1. **Visual Fidelity**: The terrain should look identical to the current implementation, with crisp, blocky voxels.
2. **Performance (FPS)**: With tiny voxels (e.g., `voxelSize = 10`), the framerate should remain perfectly smooth, whereas the old instanced approach would crash or lag heavily.
3. **Camera Movement**: Moving the camera inside a chunk and looking around should not cause clipping artifacts.
