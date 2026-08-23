import { alertError } from "./errors.js";
import HeightmapGrid from "./heightmap-grid.js";
import ChunkWebSocketClient from "./chunk-websocket.js";

// Instantiate the persistent socket connection
const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const wsClient = new ChunkWebSocketClient(`${protocol}//${window.location.host}/ws/chunks`);

export default class HmapLoader {

  bufferToArray(buffer, size) {
    const data = new Uint8Array(buffer);
    const expectedLength = size * size * 5;

    if (data.length !== expectedLength) {
      throw new Error(
        `Unexpected data length: got ${data.length}, expected ${expectedLength}`
      );
    }

    // Create 2D grid: grid[x][y] = [r, g, b, height]
    const grid = Array.from({ length: size }, () => Array(size));

    const stride = 5; // 5 bytes per pixel

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const index = x + y * size; // pixel index
        const base = index * stride; // starting byte of this pixel

        const r = data[base];
        const g = data[base + 1];
        const b = data[base + 2];

        // Assuming big-endian uint16: first high byte, then low byte
        const height = (data[base + 3] << 0) | (data[base + 4] << 8);

        grid[x][y] = [r, g, b, height];
      }
    }

    return grid;
  }

  bufferTo1DArray(buffer) {
    const data = new Uint8Array(buffer);

    // Create 1D array: array[i] = [r, g, b, height]
    const array = new Array(data.length / 5 * 4); // 4 floats per pixel

    const stride = 5; // 5 bytes per pixel

    for (let i = 0; i < data.length / stride; i++) {
      const base = i * stride; // starting byte of this pixel

      const r = data[base];
      const g = data[base + 1];
      const b = data[base + 2];

      // Assuming big-endian uint16: first high byte, then low byte
      const height = (data[base + 3] << 0) | (data[base + 4] << 8);

      array[i] = [r, g, b, height];
    }

    return array;
  }

  bufferToWebGPUArrays(buffer) {
    const data = new Uint8Array(buffer);
    const numPixels = data.length / 5;
    
    const colorData = new Uint8Array(numPixels * 4);
    const heightData = new Uint16Array(numPixels);
    
    for (let i = 0; i < numPixels; i++) {
      const base = i * 5;
      const cBase = i * 4;
      
      colorData[cBase] = data[base];
      colorData[cBase + 1] = data[base + 1];
      colorData[cBase + 2] = data[base + 2];
      colorData[cBase + 3] = 255;
      
      heightData[i] = data[base + 3] | (data[base + 4] << 8);
    }

    return { colorData, heightData };
  }

  webGPUArraysTo1DArray(webGPUArrays) {
    const { colorData, heightData } = webGPUArrays;
    const numPixels = heightData.length;
    const array = new Array(numPixels);

    for (let i = 0; i < numPixels; i++) {
      const cBase = i * 4;
      array[i] = [
        colorData[cBase],
        colorData[cBase + 1],
        colorData[cBase + 2],
        heightData[i]
      ];
    }

    return array;
  }

  array1DToWebGPUArrays(array) {
    const numPixels = array.length;
    const colorData = new Uint8Array(numPixels * 4);
    const heightData = new Uint16Array(numPixels);

    for (let i = 0; i < numPixels; i++) {
      const pixel = array[i];
      const cBase = i * 4;

      colorData[cBase] = pixel[0];
      colorData[cBase + 1] = pixel[1];
      colorData[cBase + 2] = pixel[2];
      colorData[cBase + 3] = 255;
      
      heightData[i] = pixel[3];
    }

    return { colorData, heightData };
  }
  loadHeightMap(chunkX, chunkZ, chunkSize = 1000, levelOfDetail = 0, version = "quad", parseToFloats = false, sockets=true) {

    if (sockets) {
      return wsClient.requestChunk(chunkX, chunkZ, chunkSize, levelOfDetail, version)
      .then((buffer) => {
        if (buffer === 404) {
          return 404; // Propagate 404 for chunk not found
        }
        
        if (parseToFloats) {
          return this.bufferTo1DArray(buffer);
        } else {
          return this.bufferToWebGPUArrays(buffer);
        }
      })
      .catch((err) => {
        alertError(`Failed to load chunk (${chunkX}, ${chunkZ}) via WebSocket: ${err.message}`);
        throw err;
      });
    }

    // Trailing slash matches the Flask route exactly; without it every chunk
    // request was a 308 redirect + second round trip (E4 artefact, 2026-08-22).
    const url = `/get_chunk/${chunkX}/${chunkZ}/${chunkSize}/${levelOfDetail}/${version}/`;

    return fetch(url)
      .then((response) => {
        // Check for 404
        if (response.status === 404) {
            return 404; // Return 404 to indicate chunk not found
        }


        if (!response.ok) {
          alertError(`Failed to load chunk (${chunkX}, ${chunkZ}): ${response.statusText}`);
          throw new Error(
            `Failed to load chunk (${chunkX}, ${chunkZ}): ${response.statusText}`
          );
        }
        return response.arrayBuffer();
      })
      .then((buffer) => {
        if (buffer == 404) {
          return 404; // Propagate 404
        }
        
        if (parseToFloats) {
          return this.bufferTo1DArray(buffer);
        } else {
          return this.bufferToWebGPUArrays(buffer);
        }
      });
  }
}