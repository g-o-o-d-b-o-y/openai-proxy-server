import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateAudioMs } from '../src/audio.js';

test('estimates PCM duration from rate, channels and bit depth', () => {
  assert.equal(estimateAudioMs({ contentType: 'audio/pcm;rate=24000;channels=1', bytes: 48000 }), 1000);
  assert.equal(estimateAudioMs({ contentType: 'audio/pcm;rate=24000;channels=2', bytes: 96000 }), 1000);
  assert.equal(estimateAudioMs({ contentType: 'audio/pcm;rate=8000;channels=1;bits=8', bytes: 8000 }), 1000);
  assert.equal(estimateAudioMs({ contentType: 'audio/pcm', bytes: 48000 }), 1000, 'defaults to 24kHz mono 16-bit');
});

test('estimates WAV duration from the header byte rate', () => {
  const header = Buffer.alloc(64);
  header.write('RIFF', 0);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.write('data', 36);
  header.writeUInt32LE(48000, 28);
  assert.equal(estimateAudioMs({ contentType: 'audio/wav', bytes: 48044, header }), 1000);
  assert.equal(estimateAudioMs({ contentType: 'audio/x-wav', bytes: 24044, header }), 500);
  assert.equal(estimateAudioMs({ contentType: 'audio/wav', bytes: 1000, header: null }), 0, 'headerless WAV is skipped');
});

test('skips compressed and empty responses', () => {
  assert.equal(estimateAudioMs({ contentType: 'audio/mpeg', bytes: 100000 }), 0);
  assert.equal(estimateAudioMs({ contentType: 'audio/opus', bytes: 100000 }), 0);
  assert.equal(estimateAudioMs({ contentType: 'audio/pcm;rate=24000', bytes: 0 }), 0);
  assert.equal(estimateAudioMs({}), 0);
});
