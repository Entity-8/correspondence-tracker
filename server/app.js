import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createAuthHelpers } from './middleware/auth.js';
import { createAuthRouter } from './routes/auth.js';
import { createRecordsRouter } from './routes/records.js';
import { createNotificationsRouter } from './routes/notifications.js';
import { createReportsRouter } from './routes/reports.js';
import { createAdminRouter } from './routes/admin.js';
import { createStorage } from './utils/storage.js';
import { sendError } from './utils/validation.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function createApp({ dbHandle, config: overrides = {} }) {
  const isProd = process.env.NODE_ENV === 'production';
  const isVercel = Boolean(process.env.VERCEL);
  const config = {
    isProd,
    isVercel,
    demoMode:
      overrides.demoMode ??
      (process.env.DEMO_MODE === 'true' || (!isProd && process.env.DEMO_MODE !== 'false')),
    uploadsDir: overrides.uploadsDir || process.env.UPLOADS_DIR || path.join(projectRoot, 'uploads'),
    distDir: overrides.distDir || path.join(projectRoot, 'dist'),
    blobToken: overrides.blobToken ?? process.env.BLOB_READ_WRITE_TOKEN,
    corsOrigins: overrides.corsOrigins || [
      'https://localhost',
      'http://localhost',
      'capacitor://localhost',
      'ionic://localhost',
      ...(process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean),
    ],
    trustProxy: overrides.trustProxy ?? (isVercel ? 1 : Number(process.env.TRUST_PROXY || 0) || false),
    disableRateLimit: overrides.disableRateLimit ?? false,
  };

  const app = express();
  if (config.trustProxy) {
    app.set('trust proxy', config.trustProxy);
  }

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          imgSrc: ["'self'", 'data:', 'blob:'],
          connectSrc: ["'self'", ...config.corsOrigins],
          upgradeInsecureRequests: null,
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );

  const allowedOrigins = new Set(config.corsOrigins);
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && allowedOrigins.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  app.use(express.json({ limit: '1mb' }));

  const noopLimiter = (req, res, next) => next();
  const apiLimiter = config.disableRateLimit
    ? noopLimiter
    : rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 600,
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: 'تم تجاوز حد الطلبات المسموح، يرجى المحاولة لاحقاً' },
      });
  const loginLimiter = config.disableRateLimit
    ? noopLimiter
    : rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 25,
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: 'محاولات تسجيل دخول متكررة، يرجى الانتظار 15 دقيقة' },
      });

  app.use('/api', apiLimiter);

  // Ensure DB schema/seed initialization completes on cold starts before handling requests
  app.use(async (req, res, next) => {
    try {
      await dbHandle.ensureReady();
      next();
    } catch (err) {
      next(err);
    }
  });

  const { q, transaction } = dbHandle;
  const authHelpers = createAuthHelpers(q);
  const storage = createStorage({
    uploadsDir: config.uploadsDir,
    blobToken: config.blobToken,
  });

  app.get('/health', async (req, res) => {
    try {
      await q.one('SELECT 1 AS ok');
      res.json({ status: 'ok', uptime: Math.round(process.uptime()) });
    } catch {
      res.status(503).json({ status: 'error' });
    }
  });

  app.use('/api/auth', createAuthRouter({ q, transaction, authHelpers, config, loginLimiter }));
  app.use('/api', createRecordsRouter({ q, transaction, authHelpers, storage }));
  app.use('/api/notifications', createNotificationsRouter({ q, authHelpers }));
  app.use('/api/reports', createReportsRouter({ q, authHelpers }));
  app.use('/api/admin', createAdminRouter({ q, transaction, authHelpers }));

  app.use('/api', (req, res) => sendError(res, 404, 'مسار API غير موجود'));

  if (!config.isVercel && fs.existsSync(config.distDir)) {
    app.use(express.static(config.distDir));
    const indexHtml = path.join(config.distDir, 'index.html');
    app.get('/', (req, res) => res.sendFile(indexHtml));
    app.get('*', (req, res) => res.sendFile(indexHtml));
  }

  app.use((err, req, res, next) => {
    if (err?.type === 'entity.too.large') {
      return sendError(res, 413, 'حجم البيانات المرسلة يتجاوز الحد المسموح');
    }
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
      return sendError(res, 400, 'صيغة JSON غير صالحة');
    }
    console.error('Unhandled error:', config.isProd ? err?.message : err);
    sendError(res, 500, 'حدث خطأ داخلي في الخادم');
  });

  return app;
}
