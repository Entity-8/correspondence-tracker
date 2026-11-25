import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabase } from './db.js';
import { createApp } from './server/app.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const HTTPS_PORT = Number(process.env.HTTPS_PORT || 3443);

const dbHandle = createDatabase(process.env.DB_PATH || path.join(root, 'app.db'));
await dbHandle.ensureReady();
const app = createApp({ dbHandle });

const servers = [];
const httpServer = app.listen(PORT, '0.0.0.0', () => {
  console.log(`HTTP server listening on http://0.0.0.0:${PORT}`);
});
servers.push(httpServer);

const keyFile = process.env.SSL_KEY || path.join(root, 'certs', 'server.key');
const certFile = process.env.SSL_CERT || path.join(root, 'certs', 'server.crt');
if (fs.existsSync(keyFile) && fs.existsSync(certFile)) {
  const httpsServer = https
    .createServer({ key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) }, app)
    .listen(HTTPS_PORT, '0.0.0.0', () => {
      console.log(`HTTPS server listening on https://0.0.0.0:${HTTPS_PORT}`);
    });
  servers.push(httpsServer);
}

function shutdown(signal) {
  console.log(`\nReceived ${signal}, shutting down gracefully...`);
  let pending = servers.length;
  const finish = async () => {
    pending -= 1;
    if (pending <= 0) {
      await dbHandle.close();
      process.exit(0);
    }
  };
  servers.forEach(s => s.close(() => finish()));
  setTimeout(async () => {
    await dbHandle.close();
    process.exit(1);
  }, 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
