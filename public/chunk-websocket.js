export default class ChunkWebSocketClient {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.nextRequestId = 1;
    this.pendingRequests = new Map(); // requestId -> { resolve, reject }
    this.isConnected = false;
    this.connectionPromise = null;
    this.connect();
  }

  connect() {
    this.ws = new WebSocket(this.url);
    this.ws.binaryType = 'arraybuffer';

    this.connectionPromise = new Promise((resolve, reject) => {
      this.ws.onopen = () => {
        console.log('WebSocket connected to', this.url);
        this.isConnected = true;
        resolve();
      };

      this.ws.onerror = (event) => {
        console.error('WebSocket connection error:', event);
        reject(new Error("WebSocket connection failed"));
      };
    });

    this.ws.onmessage = (event) => {
      const buffer = event.data;
      if (!(buffer instanceof ArrayBuffer)) return;

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
      console.log('WebSocket disconnected');
      this.isConnected = false;
      // Reject all pending requests on connection loss
      for (const [id, handlers] of this.pendingRequests.entries()) {
        handlers.reject(new Error("WebSocket disconnected"));
      }
      this.pendingRequests.clear();
      
      // Auto-reconnect after 2 seconds
      setTimeout(() => this.connect(), 2000);
    };
  }

  async requestChunk(x, z, chunkSize, lod, version) {
    // Wait for connection to be established
    if (!this.isConnected) {
      try {
        await this.connectionPromise;
      } catch (err) {
        throw new Error("Failed to connect WebSocket: " + err.message);
      }
    }

    return new Promise((resolve, reject) => {
      if (this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error("WebSocket is not open (readyState: " + this.ws.readyState + ")"));
        return;
      }

      const requestId = this.nextRequestId++;
      this.pendingRequests.set(requestId, { resolve, reject });

      // Send JSON message requesting the chunk
      try {
        this.ws.send(JSON.stringify({
          requestId,
          x,
          z,
          chunk_size: chunkSize,
          lod,
          version
        }));
      } catch (err) {
        this.pendingRequests.delete(requestId);
        reject(err);
      }
    });
  }
}
