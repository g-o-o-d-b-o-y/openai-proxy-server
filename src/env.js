import fs from 'node:fs';
import path from 'node:path';

function parseValue(raw) {
  let value = raw.trim();
  if (!value) return '';
  const quote = value[0];
  if ((quote === '"' || quote === "'") && value.endsWith(quote)) {
    value = value.slice(1, -1);
    if (quote === '"') {
      value = value.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
    return value;
  }
  const hash = value.search(/\s+#/);
  if (hash >= 0) value = value.slice(0, hash).trimEnd();
  return value;
}

export function loadDotEnv(filename = '.env', env = process.env) {
  const file = path.resolve(process.cwd(), filename);
  let text;
  try { text = fs.readFileSync(file, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return env; throw error; }

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, raw] = match;
    if (env[key] === undefined) env[key] = parseValue(raw);
  }
  return env;
}
