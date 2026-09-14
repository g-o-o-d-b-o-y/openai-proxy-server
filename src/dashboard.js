// Dashboard dispatch: public landing page, per-key dashboard, admin SPA and
// the admin API/events served under the configured dashboard path.

import { adminPage } from './ui/admin.js';
import { keyDashboardPage } from './ui/key.js';
import { landingPage } from './ui/landing.js';
import { adminAuthorized } from './api/admin.js';
import { jsonError } from './http.js';

export const faviconSvg = String.raw`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<rect width="64" height="64" rx="14" fill="#000"/>
<path d="M22 15h20a11 11 0 0 1 0 22H30v12h-8z" fill="#fafafa"/>
<circle cx="47" cy="48" r="6" fill="#fafafa"/>
</svg>`;

export function serveFavicon(req, res, config) {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/favicon.ico' && url.pathname !== '/favicon.svg') return false;
  if (!config.dashboard.enabled) {
    res.writeHead(204, { 'cache-control': 'no-store' });
    res.end();
    return true;
  }
  res.writeHead(200, {
    'content-type': 'image/svg+xml; charset=utf-8',
    'content-length': Buffer.byteLength(faviconSvg),
    'cache-control': 'public, max-age=86400'
  });
  res.end(faviconSvg);
  return true;
}

export function serveLanding(req, res, { config, accounts }) {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/' || !['GET', 'HEAD'].includes(req.method || 'GET')) return false;
  const plans = accounts.listPlans({ activeOnly: true });
  const body = landingPage({ config, plans, freeCreditUsd: config.billing.freeCreditUsd });
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
  return true;
}

export function serveKeyDashboard(req, res, config) {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/key/' || !['GET', 'HEAD'].includes(req.method || 'GET')) return false;
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(keyDashboardPage({ config }));
  return true;
}

export function createDashboard({ config, keys, usage, adminApi, settings }) {
  return async function handleDashboard(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const base = config.dashboard.path;
    if (url.pathname !== base && !url.pathname.startsWith(`${base}/`)) return false;
    if (!config.dashboard.enabled) {
      jsonError(res, 404, 'dashboard_disabled', 'Dashboard disabled', config);
      return true;
    }

    const rel = url.pathname.slice(base.length).replace(/^\//, '');
    if (rel === '') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(adminPage({ config }));
      return true;
    }

    if (rel === 'api/events') {
      if (!adminAuthorized(req, settings)) {
        jsonError(res, 401, 'dashboard_unauthorized', 'Admin token required or invalid', config);
        return true;
      }
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no'
      });
      res.write(': connected\n\n');
      const unsubscribe = usage.subscribe((chunk) => res.write(chunk));
      const heartbeat = setInterval(() => res.write(': ping\n\n'), 15000);
      heartbeat.unref?.();
      req.on('close', () => { clearInterval(heartbeat); unsubscribe(); });
      return true;
    }

    if (rel.startsWith('api/')) {
      await adminApi(req, res, url, rel.slice(4));
      return true;
    }

    jsonError(res, 404, 'not_found', 'Not found', config);
    return true;
  };
}
