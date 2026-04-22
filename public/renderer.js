import * as Matrix from "./matrix.js";
import ChunkManager from "./chunk-manager.js";
import { vprint } from "./vprint.js";

export default class Renderer {
  initialized = false;

  constructor(device, context, format, canvas, voxelSize = 100, chunkSize = 1000) {
    this.device = device;
    this.context = context;
    this.format = format;
    this.canvas = canvas;
    this.voxelSize = voxelSize;
    this.chunkSize = chunkSize;
  }

  async init(player, canvas) {
    this.player = player;
    vprint("Initializing renderer...");
    await this.getShaders();
    this.createBufferLayouts();
    this.createBuffers();

    this.updateVPMatrix(player.camera, canvas);
    this.cellShaderModule = this.device.createShaderModule({
      label: "Cell shader",
      code: this.wgslShader,
    });

    this.createDepthTexture();
    this.createPipelines();
    this.createBindGroups();

    this.chunkManager = new ChunkManager(
      this.device,
      this.voxelSize,
      this.chunkSize
    );
    this.chunkManager.startLoop(player);
    this.initialized = true;
    vprint("Renderer initialized");
  }

  toColumnMajor(m) {
    // prettier-ignore
    return new Float32Array([
      m[0][0], m[1][0], m[2][0], m[3][0],
      m[0][1], m[1][1], m[2][1], m[3][1],
      m[0][2], m[1][2], m[2][2], m[3][2],
      m[0][3], m[1][3], m[2][3], m[3][3],
    ]);
  }

  updateVPMatrix(camera, canvas) {
    if (!this.initialized) return;
    let vpMatrix = Matrix.getViewProjectionMatrix(camera, canvas);

    this.device.queue.writeBuffer(
      this.uniformBuffer,
      0,
      this.toColumnMajor(vpMatrix)
    );
  }

  async getShaders() {
    this.wgslShader = await fetch("shader.wgsl").then((response) =>
      response.text()
    );
  }

  createBufferLayouts() {
    this.vertexBufferLayout = {
      arrayStride: 8 * 4, // 8 floats x 4 bytes
      attributes: [
        {
          // Position
          format: "float32x4",
          offset: 0,
          shaderLocation: 0, // Position, see vertex shader
        },
        {
          // Color
          format: "float32x4",
          offset: 4 * 4,
          shaderLocation: 1, // Color, see vertex shader
        },
      ],
    };
  }

  createBuffers() {
    // Uniform buffer for vpMatrix
    const uniformBufferSize = 4 * 16; // 4x4 matrix
    this.uniformBuffer = this.device.createBuffer({
      size: uniformBufferSize,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  createDepthTexture() {
    this.depthFormat = "depth24plus";
    this.depthTexture = this.device.createTexture({
      size: {
        width: this.canvas.width,
        height: this.canvas.height,
        depthOrArrayLayers: 1,
      },
      format: this.depthFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }

  createPipelines() {
    this.cellPipeline = this.device.createRenderPipeline({
      label: "Cell pipeline",
      layout: "auto",
      vertex: {
        module: this.cellShaderModule,
        entryPoint: "vertexMain",
        buffers: [this.vertexBufferLayout],
      },
      fragment: {
        module: this.cellShaderModule,
        entryPoint: "fragmentMain",
        targets: [
          {
            format: this.format,
          },
        ],
      },
      depthStencil: {
        format: this.depthFormat,
        depthWriteEnabled: true,
        depthCompare: "less",
      },
    });
  }

  createBindGroups() {
    this.bindGroup = this.device.createBindGroup({
      label: "Cell renderer bind group",
      layout: this.cellPipeline.getBindGroupLayout(0),
      entries: [
        {
          binding: 0,
          resource: { buffer: this.uniformBuffer },
        },
      ],
    });
  }

  frameIndex = 0;
  render() {
    if (!this.initialized) return;
    this.frameIndex++;

    const commandEncoder = this.device.createCommandEncoder();
    const pass = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0.4, a: 1 },
        },
      ],
      depthStencilAttachment: {
        view: this.depthTexture.createView(),
        depthLoadOp: "clear",
        depthStoreOp: "store",
        depthClearValue: 1.0,
      },
    });
    pass.setPipeline(this.cellPipeline);
    pass.setBindGroup(0, this.bindGroup); // New line!

    // How to set buffers and draw
    // pass.setVertexBuffer(0, vertexBuffer);
    // pass.setIndexBuffer(indexBuffer, "uint32"); // or "uint16"
    // pass.drawIndexed(indices.length);

    const chunkData = this.chunkManager.getChunkData();
    for (const chunk of chunkData.values()) {
      if (!chunk.vertexBuffer || !chunk.indexBuffer) {
        continue; // Skip chunks that are not ready
      }

      pass.setVertexBuffer(0, chunk.vertexBuffer);
      pass.setIndexBuffer(chunk.indexBuffer, "uint32");
      pass.drawIndexed(chunk.indexCount);
    }

    pass.end();
    this.device.queue.submit([commandEncoder.finish()]);
  }
}
