const express = require('express');
const path = require('path');
const helmet = require('helmet');
require('dotenv').config();
const app = express();

// ------------------------------------------------------------
// Simple request logger – prints every incoming request to the console
// ------------------------------------------------------------
app.use((req, res, next) => {
  console.log(`[REQ] ${req.method} ${req.originalUrl}`);
  next();
});

// ------------------------------------------------------------
// Simple Basic Auth helper (uses env vars DVR_USER & DVR_PASS)
// ------------------------------------------------------------
function isAuthorized(req) {
  // 1️⃣ Check HTTP Authorization header (Basic auth)
  const authHeader = req.headers['authorization'];
  if (authHeader) {
    const [scheme, encoded] = authHeader.split(' ');
    if (scheme === 'Basic' && encoded) {
      const decoded = Buffer.from(encoded, 'base64').toString('utf8');
      const [user, pass] = decoded.split(':');
      if (user === process.env.DVR_USER && pass === process.env.DVR_PASS) return true;
    }
  }
  // 2️⃣ Fallback: look for an `auth` query parameter (base64 "user:pass")
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const q = url.searchParams.get('auth');
    if (q) {
      const decoded = Buffer.from(q, 'base64').toString('utf8');
      const [user, pass] = decoded.split(':');
      return user === process.env.DVR_USER && pass === process.env.DVR_PASS;
    }
  } catch (_) {}
  return false;
}

// Optional: expose a quick health‑check endpoint (no auth required)
app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use(
    helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'", "'unsafe-inline'", "data:", "ws:", "wss:"],
                scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "'wasm-unsafe-eval'", "https://cdn.jsdelivr.net"],
                styleSrc: ["'self'", "'unsafe-inline'"],
                imgSrc: ["'self'", "data:"],
                connectSrc: ["'self'", "ws:", "wss:", "https://cdn.jsdelivr.net"]
            }
        },
        crossOriginEmbedderPolicy: false
    })
);

require('express-ws')(app);

// Initialize the rtsp-relay handler with Express app
const { proxy } = require('rtsp-relay')(app);

// Serve your frontend HTML page from a 'public' folder
app.use(express.static(path.join(__dirname, 'public')));

// Explicitly expose the rtsp-relay browser bundle with the correct JS MIME type.
// This avoids the Render/hosted environment serving it as text/plain.
app.use('/js', express.static(path.join(__dirname, 'node_modules/rtsp-relay/browser'), {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.js')) {
            res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        }
    }
}));

// ------------------------------------------------------------
// Fallback route – serve the SPA entry point (index.html) for any
// path that isn’t matched by the static middleware. This ensures the
// root URL ("/") and deep‑link URLs return the UI instead of a 404.
// ------------------------------------------------------------
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/js/index.js', (req, res) => {
  const filePath = path.join(__dirname, 'node_modules', 'rtsp-relay', 'browser', 'index.js');
  res.type('application/javascript');
  res.sendFile(filePath);
});

// Dynamic WebSocket endpoints for Camera 01 to Camera 06
const dvrHost = process.env.DVR_HOST || '197.36.66.103';
const dvrPort = process.env.DVR_PORT || '554';
const dvrUser = encodeURIComponent(process.env.DVR_USER || 'admin');
const dvrPass = encodeURIComponent(process.env.DVR_PASS || '239633P@');

if (String(dvrPort) === '8080') {
    console.warn('[DVR] WARNING: port 8080 is usually the Hikvision web UI port, not the RTSP stream port. For camera streams, use 554 or a forwarded RTSP port.');
}

console.log(`[DVR] Using RTSP host ${dvrHost}:${dvrPort}`);

const cameras = {
    1: `rtsp://${dvrUser}:${dvrPass}@${dvrHost}:${dvrPort}/Streaming/Channels/101`,
    2: `rtsp://${dvrUser}:${dvrPass}@${dvrHost}:${dvrPort}/Streaming/Channels/201`,
    3: `rtsp://${dvrUser}:${dvrPass}@${dvrHost}:${dvrPort}/Streaming/Channels/301`,
    4: `rtsp://${dvrUser}:${dvrPass}@${dvrHost}:${dvrPort}/Streaming/Channels/401`,
    5: `rtsp://${dvrUser}:${dvrPass}@${dvrHost}:${dvrPort}/Streaming/Channels/501`,
    6: `rtsp://${dvrUser}:${dvrPass}@${dvrHost}:${dvrPort}/Streaming/Channels/601`
};

// // Explicit single-camera RTSP URL example for direct access to camera 1
// const camera1StreamUrl = `rtsp://${dvrUser}:${dvrPass}@${dvrHost}:${dvrPort}/Streaming/Channels/101`;

// console.log('[DVR] Camera 1 RTSP URL:', camera1StreamUrl);

// Setup a websocket route for each camera dynamically (/live/1 to /live/6)
Object.keys(cameras).forEach(camId => {
    app.ws(`/live/${camId}`, (ws, req) => {
        // Enforce Basic Auth before proxying the stream
        if (!isAuthorized(req)) {
            ws.close(1008, 'Unauthorized'); // 1008 = Policy Violation
            return;
        }
        return proxy({
            url: cameras[camId],
            verbose: true,
            transport: 'tcp'
        })(ws);
    });
});

// Setup fallback route for /live?url=...
app.ws('/live', (ws, req) => {
    // Enforce Basic Auth for the generic endpoint as well
    if (!isAuthorized(req)) {
        ws.close(1008, 'Unauthorized');
        return;
    }
    const streamUrl = req.query.url || cameras[1];
    return proxy({
        url: streamUrl,
        verbose: true,
        transport: 'tcp'
    })(ws);
});

const PORT = Number(process.env.SERVER_PORT || 3500);

function startServer(port) {
    const server = app.listen(port, () => {
        console.log(`Server running at http://localhost:${port}`);
        console.log(`Access cameras via endpoints: /live/1 through /live/6 or /live?url=...`);
    });

    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.warn(`[PORT] Port ${port} is already in use. Retrying on ${port + 1}...`);
            startServer(port + 1);
            return;
        }

        throw err;
    });
}

if (process.env.VERCEL || process.env.VERCEL_ENV) {
    console.log('[VERCEL] Detected Vercel environment. Exporting the Express app for serverless deployment.');
    module.exports = app;
} else if (require.main === module) {
    startServer(PORT);
} else {
    module.exports = app;
}