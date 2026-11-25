import { createDatabase } from '../db.js';
import { createApp } from '../server/app.js';

let cachedApp = null;

function getApp() {
  if (!cachedApp) {
    const dbPath = process.env.DB_PATH || '/tmp/app.db';
    const uploadsDir = process.env.UPLOADS_DIR || '/tmp/uploads';
    const dbHandle = createDatabase(dbPath);
    cachedApp = createApp({ dbHandle, config: { uploadsDir } });
  }
  return cachedApp;
}

export default function handler(req, res) {
  return getApp()(req, res);
}

