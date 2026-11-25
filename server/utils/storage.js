import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { get as getBlob, put as putBlob } from '@vercel/blob';
import { ALLOWED_IMAGE_MIMES } from '../constants.js';

/**
 * Dual-mode attachment storage:
 * - Vercel Blob (access: 'private') when BLOB_READ_WRITE_TOKEN is present
 * - Local filesystem fallback for local dev, Docker, and tests
 */
export function createStorage({ uploadsDir, blobToken = process.env.BLOB_READ_WRITE_TOKEN }) {
  const useBlob = Boolean(blobToken);
  const uploadsRoot = path.resolve(uploadsDir);

  async function saveAttachment({ recordId, buf, mime }) {
    const ext = ALLOWED_IMAGE_MIMES[mime];
    const filename = `${crypto.randomBytes(12).toString('hex')}.${ext}`;

    if (useBlob) {
      const pathname = `attachments/${recordId}/${filename}`;
      const blob = await putBlob(pathname, buf, {
        access: 'private',
        contentType: mime,
        addRandomSuffix: false,
        token: blobToken,
      });
      return blob.pathname;
    }

    const dir = path.join(uploadsRoot, String(recordId));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, filename), buf);
    return path.join(String(recordId), filename);
  }

  async function sendAttachment(res, storedPath, { mime, originalName }) {
    if (useBlob) {
      const result = await getBlob(storedPath, {
        access: 'private',
        token: blobToken,
      });
      if (!result || result.statusCode !== 200 || !result.stream) {
        return false;
      }
      res.setHeader('Content-Type', mime);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader(
        'Content-Disposition',
        `inline; filename="${encodeURIComponent(originalName)}"`,
      );
      res.setHeader('Cache-Control', 'private, max-age=3600');
      Readable.fromWeb(result.stream).pipe(res);
      return true;
    }

    const file = path.resolve(uploadsRoot, storedPath);
    if (!file.startsWith(uploadsRoot + path.sep) || !fs.existsSync(file)) {
      return false;
    }
    res.setHeader('Content-Type', mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(originalName)}"`,
    );
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.sendFile(file);
    return true;
  }

  return { saveAttachment, sendAttachment, isBlob: useBlob };
}

