const supportsColor = Boolean(process.stdout?.isTTY) && !process.env.NO_COLOR && process.env.TERM !== 'dumb';

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m'
};

export const PREFIX = '[openai-proxy-server]';

export function paint(text, styleName = 'reset') {
  const code = ANSI[styleName];
  if (!code || !supportsColor) return String(text);
  return code + text + ANSI.reset;
}

export function statusStyle(status) {
  if (!status) return 'red';
  if (status < 400) return 'green';
  if (status < 500) return 'yellow';
  return 'red';
}

export function routeLabel(kind) {
  const k = String(kind || 'openai').toLowerCase();
  return k === 'tts' ? 'TTS' : k === 'stt' ? 'STT' : 'LLM';
}

export function formatDuration(ms) {
  ms = Number(ms) || 0;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

export function humanBytes(n) {
  n = Number(n) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`;
  return `${(n / 1073741824).toFixed(2)} GB`;
}

export function formatCount(n) {
  return new Intl.NumberFormat('en-US').format(n || 0);
}

export function ellipsize(text, max = 72) {
  const value = String(text ?? '/');
  if (value.length <= max) return value;
  const keep = max - 1;
  const head = Math.ceil(keep * 0.6);
  return `${value.slice(0, head)}…${value.slice(-(keep - head))}`;
}