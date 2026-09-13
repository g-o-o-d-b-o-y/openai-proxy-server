import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyRoute, buildUpstreamUrl, patchJsonBody } from '../src/routing.js';

test('classifies LLM/TTS/STT routes', () => {
  assert.equal(classifyRoute('/v1/chat/completions'), 'openai');
  assert.equal(classifyRoute('/v1/audio/speech'), 'tts');
  assert.equal(classifyRoute('/v1/audio/transcriptions'), 'stt');
  assert.equal(classifyRoute('/audio/translations'), 'stt');
});

test('replaces local v1 prefix with configured upstream base path', () => {
  const url = buildUpstreamUrl('https://openrouter.ai/api/v1', '/v1/chat/completions?x=1');
  assert.equal(url.href, 'https://openrouter.ai/api/v1/chat/completions?x=1');
});

test('injects defaults and supports force policy', () => {
  const body = patchJsonBody({ input: 'hello' }, {
    kind: 'tts',
    upstream: { model: 'tts-model', voice: 'voice-a' },
    modelPolicy: 'default',
    voicePolicy: 'default'
  });
  assert.equal(body.model, 'tts-model');
  assert.equal(body.voice, 'voice-a');

  const forced = patchJsonBody({ model: 'client-model' }, {
    kind: 'openai',
    upstream: { model: 'server-model' },
    modelPolicy: 'force',
    voicePolicy: 'default'
  });
  assert.equal(forced.model, 'server-model');
});
