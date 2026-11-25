import { ALLOWED_IMAGE_MIMES } from '../constants.js';

/**
 * Strictly validate YYYY-MM-DD calendar dates (rejects e.g. 2025-02-30).
 */
export function isIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

/**
 * Parse positive integer IDs cleanly.
 */
export function parsePositiveInt(value) {
  const num = Number(value);
  return Number.isInteger(num) && num >= 1 ? num : null;
}

/**
 * Verify image buffer magic bytes against JPEG, PNG, and WebP signatures.
 */
export function detectImageMime(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'image/jpeg';
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return 'image/png';
  }
  // WebP: "RIFF" .... "WEBP"
  if (
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

export function isSupportedMime(mime) {
  return Boolean(ALLOWED_IMAGE_MIMES[mime]);
}

export function sanitizeFilename(name) {
  const clean = String(name || 'attachment')
    .replace(/[\r\n"\\/]+/g, '_')
    .trim();
  return clean.slice(0, 200) || 'attachment';
}

export function sendError(res, code, message) {
  return res.status(code).json({ error: message });
}

