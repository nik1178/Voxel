/**
 * @fileoverview Renderer module for the Voxel project.
 * Handles all WebGPU initialization, pipeline setup, and frame rendering.
 * Includes support for Vertex Texture Fetch (VTF) based chunk instancing.
 */

import * as Matrix from "./matrix.js";
import ChunkManager from "./chunk-manager.js";
import { vprint } from "./vprint.js";

/**
 * Manages the WebGPU rendering pipeline, resource allocation, and drawing loops.
 * Responsible for translating chunk data into GPU-bound textures and rendering them.
 */
export default class Renderer {
  /** @type {boolean} Indicates whether the renderer has completed initialization. */
  initialized = false;

  manualCulling = false;
  renderType = "mesh";

  /**
   * Constructs the Renderer instance.
   * 
   * @param {GPUDevice} device - The WebGPU logical device.
   * @param {GPUCanvasContext} context - The WebGPU canvas context.
   * @param {GPUTextureFormat} format - The preferred canvas texture format.
   * @param {HTMLCanvasElement} canvas - The target HTML canvas element.
   * @param {number} [voxelSize=100] - Scale of individual voxels.
   * @param {number} [chunkSize=1000] - Dimensional size of a chunk.
   */
  constructor(device, context, format, canvas, voxelSize = 100, chunkSize = 1000) {
    this.device = device;
    this.context = context;
    this.format = format;
    this.canvas = canvas;
    this.voxelSize = voxelSize;
    this.chunkSize = chunkSize;

    this.setupEventListeners();
  }

  setupEventListeners() {
    document.addEventListener("render-type-changed", (e) => {
      this.setRenderType(e.detail);
    });

    document.addEventListener("culling-toggled", (e) => {
      this.setManualCulling(e.detail);
    });
  }

  setRenderType(type) {
    this.renderType = type;
  }

  setManualCulling(culling) {
    this.manualCulling = culling;
  }

  /**
   * Initializes the rendering engine, compiling shaders, and setting up buffers.
   * Also bootstraps the ChunkManager to begin yielding chunk data.
   * 
   * @param {Player} player - The local player instance for camera tracking.
   * @param {HTMLCanvasElement} canvas - The target HTML canvas element.
   * @returns {Promise<void>} Resolves when initialization is complete.
   */
  async init(player, canvas) {
    this.player = player;
    vprint("Initializing renderer...");

    await this.getShaders();
    this.createBufferLayouts();
    this.createBuffers();
    await this.loadSkyboxTexture();

    this.updateVPMatrix(player.camera, canvas);

    // Compile the core shader modules using the loaded WGSL code.
    if (this.rayShaderText) {
      this.rayShaderModule = this.device.createShaderModule({
        label: "Ray shader",
        code: this.rayShaderText,
      });
    }

    if (this.greedyShaderText) {
      this.greedyShaderModule = this.device.createShaderModule({
        label: "Greedy shader",
        code: this.greedyShaderText,
      });
    }
    
    if (this.instancedShaderText) {
      this.instancedShaderModule = this.device.createShaderModule({
        label: "Instanced shader",
        code: this.instancedShaderText,
      });
    }

    if (this.cubeShaderText) {
      this.cubeShaderModule = this.device.createShaderModule({
        label: "Cube shader",
        code: this.cubeShaderText,
      });
    }

    if (this.meshShaderText) {
      this.meshShaderModule = this.device.createShaderModule({
        label: "Mesh shader",
        code: this.meshShaderText,
      });
    }

    this.fxShaderModule = this.device.createShaderModule({
      label: "FX shader",
      code: this.fxShaderText,
    });

    this.createFramebuffers();
    this.createPipelines();
    this.createBindGroups();

    // Initialize the chunk lifecycle manager.
    this.chunkManager = new ChunkManager(
      this.device,
      this.voxelSize,
      this.chunkSize
    );
    this.chunkManager.startLoop(player);

    this.initialized = true;
    vprint("Renderer initialized");
  }

  /**
   * Converts a 4x4 mathematical matrix into a 1D column-major Float32Array.
   * Required for WebGPU uniform buffer matrix representations.
   * 
   * @param {number[][]} m - 4x4 matrix represented as a 2D array.
   * @returns {Float32Array} Column-major 1D array.
   */
  toColumnMajor(m) {
    // prettier-ignore
    return new Float32Array([
      m[0][0], m[1][0], m[2][0], m[3][0],
      m[0][1], m[1][1], m[2][1], m[3][1],
      m[0][2], m[1][2], m[2][2], m[3][2],
      m[0][3], m[1][3], m[2][3], m[3][3],
    ]);
  }

  /**
   * Updates the global View-Projection matrix uniform buffer.
   * 
   * @param {Object} camera - The active camera instance.
   * @param {HTMLCanvasElement} canvas - The canvas, used for aspect ratio calculations.
   */
  updateVPMatrix(camera, canvas) {
    if (!this.initialized) return;
    let vpMatrix = Matrix.getViewProjectionMatrix(camera, canvas);
    this.vpMatrix = vpMatrix;
    let invVpMatrix = Matrix.inverse(vpMatrix);
    let cameraPosition = new Float32Array([...camera.transform.translation, 1.0]);

    this.device.queue.writeBuffer(
      this.uniformBuffer,
      0,
      this.toColumnMajor(vpMatrix)
    );
    this.device.queue.writeBuffer(
      this.uniformBuffer,
      4 * 16,
      this.toColumnMajor(invVpMatrix)
    );
    this.device.queue.writeBuffer(
      this.uniformBuffer,
      4 * 16 * 2,
      cameraPosition
    );
  }

  /**
   * Fetches and loads the WGSL shader source code.
   * 
   * @returns {Promise<void>} Resolves when the shader source is loaded.
   */
  async getShaders() {
    this.fxShaderText = await fetch("fx-shader.wgsl").then((r) => r.text());
    
    // if (this.renderType === "hybrid") {
    //   this.rayShaderText = await fetch("ray-shader.wgsl").then((r) => r.text());
    //   this.greedyShaderText = await fetch("instanced-greedy-shader.wgsl").then((r) => r.text());
    // } else if (this.renderType === "raycast") {
    //   this.rayShaderText = await fetch("ray-shader.wgsl").then((r) => r.text());
    // } else if (this.renderType === "greedy") {
    //   this.greedyShaderText = await fetch("instanced-greedy-shader.wgsl").then((r) => r.text());
    // // } else {
    // }
    this.rayShaderText = await fetch("ray-shader.wgsl").then((r) => r.text());
    this.greedyShaderText = await fetch("instanced-greedy-shader.wgsl").then((r) => r.text());
    this.instancedShaderText = await fetch("instanced-shader.wgsl").then((r) => r.text());
    this.cubeShaderText = await fetch("instanced-cubes-shader.wgsl").then((r) => r.text());
    this.meshShaderText = await fetch("mesh-shader.wgsl").then((r) => r.text());
  }

  async loadSkyboxTexture() {
    const response = await fetch("skybox.png");
    const blob = await response.blob();
    const imageBitmap = await createImageBitmap(blob);
    
    this.skyboxTexture = this.device.createTexture({
      size: [imageBitmap.width, imageBitmap.height, 1],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    
    this.device.queue.copyExternalImageToTexture(
      { source: imageBitmap },
      { texture: this.skyboxTexture },
      [imageBitmap.width, imageBitmap.height]
    );
  }

  /**
   * Defines the memory layout for vertex attributes to be used by the pipeline.
   */
  createBufferLayouts() {
    this.faceVertexBufferLayout = {
      arrayStride: 4, // 4 bytes per vertex (uint8x4)
      stepMode: "vertex",
      attributes: [
        {
          format: "uint8x4",
          offset: 0,
          shaderLocation: 0,
        }
      ],
    };

    this.meshVertexBufferLayout = {
      arrayStride: 32, // 8 floats (x, y, z, w, r, g, b, a) = 32 bytes
      stepMode: "vertex",
      attributes: [
        {
          format: "float32x4",
          offset: 0,
          shaderLocation: 0,
        },
        {
          format: "float32x4",
          offset: 16,
          shaderLocation: 1,
        }
      ],
    };

    if (this.renderType === "raycast" || this.renderType === "planes") {
      this.vertexBufferLayouts = [this.faceVertexBufferLayout];
    } else {
      // The greedy shader needs the face geometry AND the instance data buffer
      this.instanceBufferLayout = {
        arrayStride: 8, // 2 32-bit integers = 8 bytes
        stepMode: "instance",
        attributes: [
          {
            format: "uint32x2",
            offset: 0,
            shaderLocation: 1,
          }
        ],
      };
      this.vertexBufferLayouts = [this.faceVertexBufferLayout, this.instanceBufferLayout];
    }
  }

  /**
   * Creates core GPU buffers including the global uniform buffer and the unit cube mesh.
   * The unit cube serves as the base geometry for instanced rendering or VTF.
   */
  createBuffers() {
    // Uniform buffer for vpMatrix (4x4 float matrix)
    // Now include inverse of VpMatrix and current camera position
    const uniformBufferSize = 4 * (16 + 16 + 4);
    this.uniformBuffer = this.device.createBuffer({
      size: uniformBufferSize,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Unit Cube Vertex Buffer
    // This cube geometry is shared across all chunk cells and scaled/positioned in the shader.
    const cubeVerts = new Uint8Array([
      // Top face (y=1) -> height driven
      0, 1, 0, 0, 1, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 0,
      // Front face (+z)
      0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 1, 0, 1, 1, 1, 0,
      // Back face (-z)
      1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 1, 0, 0,
      // Left face (-x)
      0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0,
      // Right face (+x)
      1, 0, 1, 0, 1, 0, 0, 0, 1, 1, 1, 0, 1, 1, 0, 0,
    ]);

    const cubeIndices = new Uint32Array([
      0, 1, 2, 1, 3, 2, // Top
      4, 5, 6, 5, 7, 6, // Front
      8, 9, 10, 9, 11, 10, // Back
      12, 13, 14, 13, 15, 14, // Left
      16, 17, 18, 17, 19, 18, // Right
    ]);

    this.gridIndexCount = cubeIndices.length;

    this.gridVertexBuffer = this.device.createBuffer({
      size: cubeVerts.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.gridVertexBuffer, 0, cubeVerts);

    this.gridIndexBuffer = this.device.createBuffer({
      size: cubeIndices.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.gridIndexBuffer, 0, cubeIndices);



    // Single face for better instancing not requiring to draw full cube geometry
    const faceVerts = new Uint8Array([
      0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 1, 0,
    ]);

    const faceIndices = new Uint32Array([
      0, 1, 2, 1, 3, 2,
    ]);

    this.faceIndexCount = faceIndices.length;

    this.faceVertexBuffer = this.device.createBuffer({
      size: faceVerts.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.faceVertexBuffer, 0, faceVerts);

    this.faceIndexBuffer = this.device.createBuffer({
      size: faceIndices.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.faceIndexBuffer, 0, faceIndices);
  }

  /**
   * Creates the offscreen color and depth texture attachments used for post-processing.
   */
  createFramebuffers() {
    this.depthFormat = "depth32float";
    this.depthTexture = this.device.createTexture({
      size: {
        width: this.canvas.width,
        height: this.canvas.height,
        depthOrArrayLayers: 1,
      },
      format: this.depthFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });

    this.renderTargetTexture = this.device.createTexture({
      size: {
        width: this.canvas.width,
        height: this.canvas.height,
        depthOrArrayLayers: 1,
      },
      format: this.format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });

    const bloomWidth = Math.max(1, Math.floor(this.canvas.width / 2));
    const bloomHeight = Math.max(1, Math.floor(this.canvas.height / 2));

    this.bloomTextureA = this.device.createTexture({
      size: { width: bloomWidth, height: bloomHeight, depthOrArrayLayers: 1 },
      format: this.format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });

    this.bloomTextureB = this.device.createTexture({
      size: { width: bloomWidth, height: bloomHeight, depthOrArrayLayers: 1 },
      format: this.format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
  }

  /**
   * Assembles the WebGPU render pipelines and bind group layouts.
   * Configures the VTF (Vertex Texture Fetch) layout for heightmap and color sampling.
   */
  createPipelines() {
    // Layout for the global View-Projection matrix
    this.globalBindGroupLayout = this.device.createBindGroupLayout({
      label: "Global Bind Group Layout",
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } }
      ]
    });

    // Layout for per-chunk Vertex Texture Fetch data
    this.vtfBindGroupLayout = this.device.createBindGroupLayout({
      label: "VTF Bind Group Layout",
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, sampler: { type: "non-filtering" } },
        { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, texture: { sampleType: "uint" } },
        { binding: 2, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 3, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } }
      ]
    });

    const pipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [this.globalBindGroupLayout, this.vtfBindGroupLayout]
    });

    if (this.rayShaderText) {
      this.rayPipeline = this.device.createRenderPipeline({
        label: "Ray pipeline",
        layout: pipelineLayout,
        vertex: {
          module: this.rayShaderModule,
          entryPoint: "vertexMain",
          buffers: [this.faceVertexBufferLayout],
        },
        fragment: {
          module: this.rayShaderModule,
          entryPoint: "fragmentMain",
          targets: [{ format: this.format }],
        },
        primitive: {
          topology: 'triangle-list',
          cullMode: 'none',
        },
        depthStencil: {
          format: this.depthFormat,
          depthWriteEnabled: true,
          depthCompare: "less",
        },
      });
    }

    if (this.greedyShaderText) {
      this.greedyPipeline = this.device.createRenderPipeline({
        label: "Greedy pipeline",
        layout: pipelineLayout,
        vertex: {
          module: this.greedyShaderModule,
          entryPoint: "vertexMain",
          buffers: [this.faceVertexBufferLayout, this.instanceBufferLayout],
        },
        fragment: {
          module: this.greedyShaderModule,
          entryPoint: "fragmentMain",
          targets: [{ format: this.format }],
        },
        primitive: {
          topology: 'triangle-list',
          cullMode: 'back', 
        },
        depthStencil: {
          format: this.depthFormat,
          depthWriteEnabled: true,
          depthCompare: "less",
        },
      });
    }

    if (this.instancedShaderModule) {
      this.planesPipeline = this.device.createRenderPipeline({
        label: "Planes pipeline",
        layout: pipelineLayout,
        vertex: {
          module: this.instancedShaderModule,
          entryPoint: "vertexMain",
          buffers: [this.faceVertexBufferLayout],
        },
        fragment: {
          module: this.instancedShaderModule,
          entryPoint: "fragmentMain",
          targets: [{ format: this.format }],
        },
        primitive: {
          topology: 'triangle-list',
          cullMode: 'back',
        },
        depthStencil: {
          format: this.depthFormat,
          depthWriteEnabled: true,
          depthCompare: "less",
        },
      });
    }

    if (this.cubeShaderModule) {
      this.cubePipeline = this.device.createRenderPipeline({
        label: "Cube pipeline",
        layout: pipelineLayout,
        vertex: {
          module: this.cubeShaderModule,
          entryPoint: "vertexMain",
          buffers: [this.faceVertexBufferLayout],
        },
        fragment: {
          module: this.cubeShaderModule,
          entryPoint: "fragmentMain",
          targets: [{ format: this.format }],
        },
        primitive: {
          topology: 'triangle-list',
          cullMode: 'back',
        },
        depthStencil: {
          format: this.depthFormat,
          depthWriteEnabled: true,
          depthCompare: "less",
        },
      });
    }

    if (this.meshShaderModule) {
      this.meshPipeline = this.device.createRenderPipeline({
        label: "Mesh pipeline",
        layout: pipelineLayout,
        vertex: {
          module: this.meshShaderModule,
          entryPoint: "vertexMain",
          buffers: [this.meshVertexBufferLayout],
        },
        fragment: {
          module: this.meshShaderModule,
          entryPoint: "fragmentMain",
          targets: [{ format: this.format }],
        },
        // primitive: {
        //   topology: 'triangle-list',
        //   cullMode: 'none',
        // },
        depthStencil: {
          format: this.depthFormat,
          depthWriteEnabled: true,
          depthCompare: "less",
        },
      });
    }

    // We use a nearest-neighbor sampler for discrete voxel boundaries
    this.nearestSampler = this.device.createSampler({
      magFilter: 'nearest',
      minFilter: 'nearest'
    });

    this.fxBindGroupLayout = this.device.createBindGroupLayout({
      label: "FX Bind Group Layout",
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "depth" } },
        { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } }, // bloom texture
        { binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } } // skybox texture
      ]
    });

    const fxPipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [this.fxBindGroupLayout]
    });

    this.fxPipeline = this.device.createRenderPipeline({
      label: "FX pipeline",
      layout: fxPipelineLayout,
      vertex: {
        module: this.fxShaderModule,
        entryPoint: "vertexMain",
      },
      fragment: {
        module: this.fxShaderModule,
        entryPoint: "fragmentMain",
        targets: [{ format: this.format }],
      },
      primitive: {
        topology: 'triangle-list',
      },
    });

    this.fxSampler = this.device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear'
    });

    // Layout for Bloom passes
    this.blurBindGroupLayout = this.device.createBindGroupLayout({
      label: "Blur Bind Group Layout",
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } }
      ]
    });

    const blurPipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [this.blurBindGroupLayout]
    });

    this.extractPipeline = this.device.createRenderPipeline({
      label: "Extract pipeline",
      layout: blurPipelineLayout,
      vertex: { module: this.fxShaderModule, entryPoint: "vertexMain" },
      fragment: { module: this.fxShaderModule, entryPoint: "extractBright", targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list' },
    });

    this.blurXPipeline = this.device.createRenderPipeline({
      label: "Blur X pipeline",
      layout: blurPipelineLayout,
      vertex: { module: this.fxShaderModule, entryPoint: "vertexMain" },
      fragment: { module: this.fxShaderModule, entryPoint: "blurX", targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list' },
    });

    this.blurYPipeline = this.device.createRenderPipeline({
      label: "Blur Y pipeline",
      layout: blurPipelineLayout,
      vertex: { module: this.fxShaderModule, entryPoint: "vertexMain" },
      fragment: { module: this.fxShaderModule, entryPoint: "blurY", targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list' },
    });
  }

  /**
   * Creates the global bind groups, such as the View-Projection uniform bind group.
   */
  createBindGroups() {
    this.bindGroup = this.device.createBindGroup({
      label: "Global uniform bind group",
      layout: this.globalBindGroupLayout,
      entries: [
        {
          binding: 0,
          resource: { buffer: this.uniformBuffer },
        },
      ],
    });

    this.fxBindGroup = this.device.createBindGroup({
      label: "FX bind group",
      layout: this.fxBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } }, // vp matrix
        { binding: 1, resource: this.fxSampler },
        { binding: 2, resource: this.renderTargetTexture.createView() },
        { binding: 3, resource: this.depthTexture.createView() },
        { binding: 4, resource: this.bloomTextureA.createView() },
        { binding: 5, resource: this.skyboxTexture.createView() }
      ]
    });

    this.bloomExtractBindGroup = this.device.createBindGroup({
      label: "Bloom Extract Bind Group",
      layout: this.blurBindGroupLayout,
      entries: [
        { binding: 0, resource: this.fxSampler },
        { binding: 1, resource: this.renderTargetTexture.createView() }
      ]
    });

    this.bloomBlurXBindGroup = this.device.createBindGroup({
      label: "Bloom Blur X Bind Group",
      layout: this.blurBindGroupLayout,
      entries: [
        { binding: 0, resource: this.fxSampler },
        { binding: 1, resource: this.bloomTextureA.createView() }
      ]
    });

    this.bloomBlurYBindGroup = this.device.createBindGroup({
      label: "Bloom Blur Y Bind Group",
      layout: this.blurBindGroupLayout,
      entries: [
        { binding: 0, resource: this.fxSampler },
        { binding: 1, resource: this.bloomTextureB.createView() }
      ]
    });
  }

  /**
   * Uploads raw chunk data to the GPU by generating color and height textures.
   * 
   * @param {Object} chunk - The target chunk entity.
   * @param {Object} dataObj - The raw chunk data containing height and color arrays.
   * @param {Uint8Array} dataObj.colorData - Flattened RGBA color data.
   * @param {Uint16Array} dataObj.heightData - Flattened 16-bit height data.
   */
  createWebGPUTextures(chunk, dataObj) {
    const size = Math.sqrt(dataObj.heightData.length); // Assuming square aspect ratio

    // Create and write the color texture (rgba8unorm)
    const colorTexture = this.device.createTexture({
      size: [size, size, 1],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
    });
    this.device.queue.writeTexture(
      { texture: colorTexture },
      dataObj.colorData,
      { bytesPerRow: size * 4 },
      { width: size, height: size, depthOrArrayLayers: 1 }
    );

    // Create and write the height texture (r16uint)
    const heightTexture = this.device.createTexture({
      size: [size, size, 1],
      format: 'r16uint',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
    });
    this.device.queue.writeTexture(
      { texture: heightTexture },
      dataObj.heightData,
      { bytesPerRow: size * 2 },
      { width: size, height: size, depthOrArrayLayers: 1 }
    );

    // Bind the generated textures to the chunk instance
    chunk.setTextures(colorTexture, heightTexture);
  }

  /** @type {number} Monotonically increasing frame counter. */
  frameIndex = 0;

  /**
   * Main rendering loop execution. 
   * Encodes render commands, processes chunk textures, and submits the command buffer.
   */
  render(dt) {
    if (!this.initialized) return;
    this.frameIndex++;

    const commandEncoder = this.device.createCommandEncoder();

    // Begin the main render pass, clearing the color and depth attachments.
    const pass = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.renderTargetTexture.createView(),
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: 0.53, g: 0.81, b: 0.92, a: 1 }, // Sky blue background
        },
      ],
      depthStencilAttachment: {
        view: this.depthTexture.createView(),
        depthLoadOp: "clear",
        depthStoreOp: "store",
        depthClearValue: 1.0,
      },
    });

    // Set bind group for all render pipelines
    pass.setBindGroup(0, this.bindGroup);

    // Iterate through all chunks managed by the ChunkManager
    const chunkData = this.chunkManager.getChunkData();

    // Remove all old labels from the previous frame to prevent crashing
    document.querySelectorAll('.chunk-debug-label').forEach(el => el.remove());

    // Find 9 closest chunks
    let dspoijfosdf = 0;
    for (const chunk of chunkData.values()) {
      const distance = chunk.distanceFromPlayer(this.player.getPositionVector());
      chunk.distance = distance;
      // if (dspoijfosdf == 0) {
      //   console.log(this.player.position);
      // }
      // dspoijfosdf++;

      // // Use chunk.scale instead of this.scale
      // let worldX = -chunk.position.x * this.chunkSize * chunk.scale;
      // let worldZ = chunk.position.z * this.chunkSize * chunk.scale;
      
      // // Calculate 4D clip space position
      // let clipSpace = Matrix.multiplyMatrixVector4(this.vpMatrix, [worldX, 0, worldZ, 1]);
      
      // // If W > 0, the chunk is in front of the camera (not behind us)
      // if (clipSpace[3] > 0) {
      //     // Perspective Divide
      //     let ndcX = clipSpace[0] / clipSpace[3];
      //     let ndcY = clipSpace[1] / clipSpace[3];

      //     // Map NDC (-1 to 1) to screen pixels (0 to width/height)
      //     let screenX = ((ndcX + 1.0) / 2.0) * this.canvas.width;
      //     let screenY = ((1.0 - ndcY) / 2.0) * this.canvas.height;

      //     let distanceLabel = document.createElement("p");
      //     distanceLabel.className = "chunk-debug-label"; // Add class for removal
      //     distanceLabel.innerText = Math.round(distance);
      //     distanceLabel.style.position = "absolute";
      //     distanceLabel.style.color = "white";
      //     distanceLabel.style.fontWeight = "bold";
      //     distanceLabel.style.left = screenX + "px";
      //     distanceLabel.style.top = screenY + "px";
      //     //10px stroke
      //     let strokeSize = 2;
      //     distanceLabel.style.textShadow = `-`+strokeSize+"px "+strokeSize+"px black, "+strokeSize+"px "+strokeSize+"px black, -"+strokeSize+"px "+strokeSize+"px black, "+strokeSize+"px -"+strokeSize+"px black";
          
      //     document.body.appendChild(distanceLabel);
      // }
    }
    // sort chunks by distance
    const sortedChunks = Array.from(chunkData.values()).sort((a, b) => a.distance - b.distance);
    const nineChunks = sortedChunks.slice(0, 9);


    for (const chunk of chunkData.values()) {

      // If a chunk has raw data ready but no GPU textures, initialize them
      if (chunk.rawData && (!chunk.colorTexture || !chunk.heightTexture)) {
        this.createWebGPUTextures(chunk, chunk.rawData);
      }

      // Skip rendering if textures are still unavailable
      if (!chunk.colorTexture || !chunk.heightTexture) {
        vprint("Chunk at", chunk.position, "not ready for rendering");
        continue;
      }

      //const chunkSize = chunk.colorTexture.width;

      if ((this.renderType === "greedy" || this.renderType === "hybrid") && chunk.instanceArray && !chunk.instanceBuffer) {
        chunk.instanceBuffer = this.device.createBuffer({
          size: chunk.instanceArray.byteLength,
          usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
        this.device.queue.writeBuffer(chunk.instanceBuffer, 0, chunk.instanceArray);
      }

      // Lazy-initialize the VTF (Vertex Texture Fetch) bind group for this specific chunk
      if (!chunk.vtfBindGroup) {
        // Uniform buffer storing position, size, and scale of the chunk
        const chunkInfoBuffer = this.device.createBuffer({
          size: 32, // 8 floats (32 bytes) for 16-byte alignment
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        chunk.chunkInfoBuffer = chunkInfoBuffer;

        chunk.vtfBindGroup = this.device.createBindGroup({
          layout: this.vtfBindGroupLayout,
          entries: [
            { binding: 0, resource: this.nearestSampler },
            { binding: 1, resource: chunk.heightTexture.createView() },
            { binding: 2, resource: chunk.colorTexture.createView() },
            { binding: 3, resource: { buffer: chunkInfoBuffer } },
          ]
        });
      }
      chunk.age = Math.max(0, chunk.age - dt * 2);

      this.device.queue.writeBuffer(chunk.chunkInfoBuffer, 0, new Float32Array([
        chunk.position.x, chunk.position.z, this.chunkSize, chunk.scale, chunk.age, this.manualCulling ? 1 : chunk.getMaxHeight(), 0 /*orientationOffset*/, 5 /*howManyFaces*/
      ]));

      pass.setBindGroup(1, chunk.vtfBindGroup);
      
      let useGreedy = this.renderType === "greedy";
      let useRaymarching = this.renderType === "raycast";
      let useCubes = this.renderType === "cubes";
      let usePlanes = this.renderType === "planes";
      let useMesh = this.renderType === "mesh";

      if (this.renderType === "hybrid") {
        if (nineChunks.includes(chunk)) {
          useGreedy = true;
          useRaymarching = false;
        } else {
          useGreedy = false;
          useRaymarching = true;
        }
      }

      // Execute the instanced draw call for the chunk
      if (useRaymarching) {
        pass.setPipeline(this.rayPipeline);
        pass.setVertexBuffer(0, this.gridVertexBuffer);
        pass.setIndexBuffer(this.gridIndexBuffer, "uint32");
        pass.drawIndexed(this.gridIndexCount, 1);
      } else if (useGreedy) {
        pass.setPipeline(this.greedyPipeline);
        if (chunk.instanceBuffer) {
          pass.setVertexBuffer(0, this.faceVertexBuffer);
          pass.setVertexBuffer(1, chunk.instanceBuffer);
          pass.setIndexBuffer(this.faceIndexBuffer, "uint32");
          pass.drawIndexed(this.faceIndexCount, chunk.instanceArray.length / 2);
        } else {
          console.log("Chunk missing instanceBuffer for greedy meshing!");
        }
      } else if (useCubes) {
        pass.setPipeline(this.cubePipeline);
        pass.setVertexBuffer(0, this.gridVertexBuffer);
        pass.setIndexBuffer(this.gridIndexBuffer, "uint32");
        pass.drawIndexed(this.gridIndexCount, this.chunkSize * this.chunkSize);
      } else if (usePlanes) {
        pass.setPipeline(this.planesPipeline);
        pass.setVertexBuffer(0, this.faceVertexBuffer);
        pass.setIndexBuffer(this.faceIndexBuffer, "uint32");
        
        let facesToRender = 1;
        if (!this.manualCulling) {
          facesToRender = 5;
          this.device.queue.writeBuffer(chunk.chunkInfoBuffer, 0, new Float32Array([
            chunk.position.x, chunk.position.z, this.chunkSize, chunk.scale, chunk.age, 0, 0, 5
          ]));
        } else {
          // Orientations: 1 = +z, 2 = +x, 3 = -z, 4 = -x
          let orientationOffset = 0;
          if (chunk.position.z * chunk.scale * this.chunkSize + chunk.scale * this.chunkSize/2 > this.player.camera.transform.translation[2]) {
            orientationOffset+=1;
          }
          if (chunk.position.x * chunk.scale * this.chunkSize + chunk.scale * this.chunkSize/2 > -this.player.camera.transform.translation[0]) {
            if (orientationOffset==0) {
              orientationOffset+=2;
            }
            orientationOffset+=1;
          }

          facesToRender = 3;
          let playerPosition = this.player.camera.transform.translation;
          let pp = {
            x: playerPosition[0],
            z: playerPosition[2],
            y: playerPosition[1]
          }
          let chunkDistance = chunk.distanceFromPlayer(pp);
          if (chunkDistance == 0) {
            orientationOffset = 0;
            facesToRender = 5;
          }

          this.device.queue.writeBuffer(chunk.chunkInfoBuffer, 0, new Float32Array([
            chunk.position.x, chunk.position.z, this.chunkSize, chunk.scale, chunk.age, chunk.getMaxHeight(), orientationOffset, facesToRender
          ]));
        }
        
        pass.drawIndexed(this.faceIndexCount, this.chunkSize * this.chunkSize * facesToRender);
      } else if (useMesh) {
        pass.setPipeline(this.meshPipeline);
        if (chunk.vertexBuffer && chunk.indexBuffer) {
          pass.setVertexBuffer(0, chunk.vertexBuffer);
          pass.setIndexBuffer(chunk.indexBuffer, "uint32");
          pass.drawIndexed(chunk.indexCount);
        } else {
          console.log("Chunk missing vertexBuffer for mesh rendering!");
        }
      }
    }

    // Finalize the main pass
    pass.end();

    // 1. Bloom Extract Pass (reads renderTargetTexture, writes to bloomTextureA)
    const extractPass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: this.bloomTextureA.createView(),
        loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 },
      }]
    });
    extractPass.setPipeline(this.extractPipeline);
    extractPass.setBindGroup(0, this.bloomExtractBindGroup);
    extractPass.draw(3);
    extractPass.end();

    // 2. Bloom Blur X Pass (reads bloomTextureA, writes to bloomTextureB)
    const blurXPass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: this.bloomTextureB.createView(),
        loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 },
      }]
    });
    blurXPass.setPipeline(this.blurXPipeline);
    blurXPass.setBindGroup(0, this.bloomBlurXBindGroup);
    blurXPass.draw(3);
    blurXPass.end();

    // 3. Bloom Blur Y Pass (reads bloomTextureB, writes back to bloomTextureA)
    const blurYPass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: this.bloomTextureA.createView(),
        loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 },
      }]
    });
    blurYPass.setPipeline(this.blurYPipeline);
    blurYPass.setBindGroup(0, this.bloomBlurYBindGroup);
    blurYPass.draw(3);
    blurYPass.end();

    // Begin the post-processing FX pass
    const fxPass = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1 },
        },
      ]
    });

    fxPass.setPipeline(this.fxPipeline);
    fxPass.setBindGroup(0, this.fxBindGroup);
    fxPass.draw(3);
    fxPass.end();

    // Submit the command buffer to the GPU queue
    this.device.queue.submit([commandEncoder.finish()]);
  }
}
