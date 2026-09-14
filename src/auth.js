// Token generation, hashing and request-token extraction.
//
// API keys, dashboard tokens and redeem codes are random 160-bit values shown
// exactly once. Only HMAC-SHA256(key_pepper, token) is stored, so a database
// leak cannot expose usable credentials. Token prefixes are configurable.

import crypto from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const TOKEN_BYTES = 24;

function randomToken(length = 32) {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

export function generateApiKey(prefix = 'sk-opx-') {
  return `${prefix}${randomToken(TOKEN_BYTES)}`;
}

export function generateDashToken(prefix = 'dash_') {
  return `${prefix}${randomToken(TOKEN_BYTES)}`;
}

export function generateRedeemCode(prefix = 'OPX') {
  const block = () => randomToken(4).toUpperCase();
  return `${prefix}-${block()}-${block()}-${block()}`;
}

export function generateId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

// Stable display prefix: the configured prefix plus a short random slice.
export function displayPrefix(token, prefixLength = 7) {
  return String(token).slice(0, prefixLength + 6);
}

export function hashKey(pepper, token) {
  return crypto.createHmac('sha256', String(pepper || '')).update(String(token)).digest('hex');
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

export function safeEqual(a, b) {
  const left = Buffer.from(String(a ?? ''));
  const right = Buffer.from(String(b ?? ''));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

// Read a bearer token from a request. Accepts Authorization and the
// OpenAI-style x-api-key header; dashboards may additionally pass ?token=.
export function requestToken(req, { query = false } = {}) {
  const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (bearer) return bearer;
  const header = String(req.headers['x-api-key'] || '').trim();
  if (header) return header;
  if (query) {
    try { return new URL(req.url, 'http://localhost').searchParams.get('token') || ''; } catch { return ''; }
  }
  return '';
}
