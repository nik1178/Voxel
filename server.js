const express = require('express');
const path = require('path');
const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');

const app = express();
const PORT = 8000;

app.use(
  express.static(path.join(__dirname, 'public'), {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.wgsl')) {
        res.type('text/wgsl');
      }
      if (filePath.endsWith('.hmap')) {
        res.type('application/octet-stream');
      }
    },
  })
);

// HTTP endpoint for chunk retrieval (fallback)
app.get('/get_chunk/:x/:z/:chunk_size/:lod/:version', (req, res) => {
  const { x, z, chunk_size, lod, version } = req.params;
  const chunkPath = path.join(__dirname, 'public', 'map', chunk_size, `${x}_${z}.hmap`);
  
  fs.stat(chunkPath, (err, stats) => {
    if (err) {
      return res.status(404).send('Chunk not found');
    }
    res.type('application/octet-stream');
    res.sendFile(chunkPath);
  });
});

// Create HTTP server
const server = http.createServer(app);

// Create WebSocket server
const wss = new WebSocket.Server({ server, path: '/ws/chunks' });

// Store connected clients and track pending requests
const pendingRequests = new Map();

wss.on('connection', (ws) => {
  console.log('WebSocket client connected');

  ws.on('message', (message) => {
    try {
      const request = JSON.parse(message);
      const { requestId, x, z, chunk_size, lod, version } = request;

      if (!requestId || x === undefined || z === undefined) {
        console.error('Invalid request:', request);
        return;
      }

      // Try to load chunk from local file system
      const chunkPath = path.join(__dirname, 'public', 'map', chunk_size.toString(), `${x}_${z}.hmap`);
      
      fs.readFile(chunkPath, (err, data) => {
        try {
          if (err) {
            // Chunk not found
            const header = Buffer.allocUnsafe(8);
            header.writeInt32LE(requestId, 0);
            header.writeInt32LE(404, 4);
            ws.send(header);
          } else {
            // Chunk found - send with header
            const header = Buffer.allocUnsafe(8);
            header.writeInt32LE(requestId, 0);
            header.writeInt32LE(200, 4);
            const payload = Buffer.concat([header, data]);
            ws.send(payload);
          }
        } catch (sendErr) {
          console.error('Failed to send response:', sendErr);
        }
      });
    } catch (err) {
      console.error('Error processing WebSocket message:', err);
    }
  });

  ws.on('close', () => {
    console.log('WebSocket client disconnected');
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
  });
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`WebSocket server ready at ws://localhost:${PORT}/ws/chunks`);
});
