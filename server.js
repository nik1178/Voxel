const express = require('express');
const path = require('path');

const app = express();
const PORT = 8000;

app.use(
  express.static(path.join(__dirname, 'public'), {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.wgsl')) {
        res.type('text/wgsl'); // or 'text/plain' if you prefer
      }
      if (filePath.endsWith('.hmap')) {
        res.type('application/octet-stream');
      }
    },
  })
);

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
