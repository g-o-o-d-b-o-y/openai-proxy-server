// Audio duration estimation for upstreams that stream audio without a usage
// object (some TTS providers do not report cost). The result feeds the price
// table (`audio_second`) and per-key audio limits.
//
// - audio/pcm (16-bit little-endian by default) uses the rate/channels params.
// - audio/wav / x-wav reads the byte rate from the 44-byte header.
// - compressed formats (mp3, opus, ...) need bitrate parsing and are skipped.

const MAX_AUDIO_MS = 24 * 3600 * 1000;

function contentTypeParams(contentType) {
  const params = {};
  for (const part of String(contentType || '').toLowerCase().split(';').slice(1)) {
    const [key, value] = part.split('=').map((s) => s.trim());
    if (key) params[key] = value;
  }
  return params;
}

export function estimateAudioMs({ contentType = '', bytes = 0, header = null } = {}) {
  const type = String(contentType || '').toLowerCase();
  const total = Number(bytes) || 0;
  if (total <= 0) return 0;

  if (type.includes('wav') || type.includes('wave')) {
    const byteRate = Buffer.isBuffer(header) && header.length >= 32 ? header.readUInt32LE(28) : 0;
    if (byteRate <= 0) return 0;
    return Math.min(MAX_AUDIO_MS, Math.round((Math.max(0, total - 44) / byteRate) * 1000));
  }

  if (type.includes('pcm')) {
    const params = contentTypeParams(contentType);
    const rate = Number(params.rate) || 24000;
    const channels = Number(params.channels) || 1;
    const bits = Number(params.bits) || 16;
    const bytesPerSecond = rate * channels * (bits / 8);
    if (bytesPerSecond <= 0) return 0;
    return Math.min(MAX_AUDIO_MS, Math.round((total / bytesPerSecond) * 1000));
  }

  return 0;
}
