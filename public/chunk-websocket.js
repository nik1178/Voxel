// Benchmark instrumentation: WS transfer counters, reset per benchmark run.
export const netStats = {
  wsBytes: 0,
  wsMessages: 0,
  requestsSent: 0,
  firstResponseAt: null,
  reset() {
    this.wsBytes = 0;
    this.wsMessages = 0;
    this.requestsSent = 0;
    this.firstResponseAt = null;
  },
};
window.__netStats = netStats;

export default class ChunkWebSocketClient {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.nextRequestId = 1;
    this.pendingRequests = new Map(); // requestId -> { resolve, reject }
    this.connect();
  }

  connect() {
    this.ws = new WebSocket(this.url);
    this.ws.binaryType = 'arraybuffer';

    this.ws.onmessage = (event) => {
      const buffer = event.data;
      if (!(buffer instanceof ArrayBuffer)) return;

      netStats.wsBytes += buffer.byteLength;
      netStats.wsMessages += 1;
      if (netStats.firstResponseAt === null) netStats.firstResponseAt = performance.now();

      // 1. Extract the 8-byte header (requestId: int32, status: int32)
      const headerView = new DataView(buffer, 0, 8);
      const requestId = headerView.getInt32(0, true); // little-endian
      const status = headerView.getInt32(4, true);

      const promiseHandlers = this.pendingRequests.get(requestId);
      if (!promiseHandlers) return;

      this.pendingRequests.delete(requestId);

      if (status === 404) {
        promiseHandlers.resolve(404);
      } else {
        // 2. Slice off the 8-byte header to get the raw hmap binary payload
        const chunkData = buffer.slice(8);
        promiseHandlers.resolve(chunkData);
      }
    };

    this.ws.onclose = () => {
      // Reject all pending requests on connection loss
      for (const [id, handlers] of this.pendingRequests.entries()) {
        handlers.reject(new Error("WebSocket disconnected"));
      }
      this.pendingRequests.clear();
      
      // Auto-reconnect after 2 seconds
      setTimeout(() => this.connect(), 2000);
    };
  }

  requestChunk(x, z, chunkSize, lod, version) {
    return new Promise((resolve, reject) => {
      if (this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error("WebSocket is not open"));
        return;
      }

      netStats.requestsSent += 1;

      const requestId = this.nextRequestId++;
      this.pendingRequests.set(requestId, { resolve, reject });

      // Send JSON message requesting the chunk
      this.ws.send(JSON.stringify({
        requestId,
        x,
        z,
        chunk_size: chunkSize,
        lod,
        version
      }));
    });
  }
}
