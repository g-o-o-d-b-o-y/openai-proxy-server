import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUpstreamUrl, classifyRoute, patchJsonBody, upstreamFor } from '../src/routing.js';

test('classifies LLM, TTS and STT routes', () => {
  assert.equal(classifyRoute('/v1/chat/completions'), 'llm');
  assert.equal(classifyRoute('/v1/models'), 'llm');
  assert.equal(classifyRoute('/v1/audio/speech'), 'tts');
  assert.equal(classifyRoute('/v1/audio/transcriptions'), 'stt');
  assert.equal(classifyRoute('/audio/translations'), 'stt');
});

test('replaces the local /v1 prefix with the configured upstream base path', () => {
  assert.equal(buildUpstreamUrl('https://openrouter.ai/api/v1', '/v1/chat/completions?x=1').href,
    'https://openrouter.ai/api/v1/chat/completions?x=1');
  assert.equal(buildUpstreamUrl('https://api.openai.com/v1', '/v1').href, 'https://api.openai.com/v1/');
});

test('selects the upstream configuration per kind', () => {
  const config = { upstreams: { llm: { model: 'a' }, tts: { model: 'b' }, stt: { model: 'c' } } };
  assert.equal(upstreamFor(config, 'llm').model, 'a');
  assert.equal(upstreamFor(config, 'tts').model, 'b');
  assert.equal(upstreamFor(config, 'stt').model, 'c');
});

test('injects defaults and honors force/passthrough policies', () => {
  const base = { kind: 'tts', upstream: { model: 'tts-model', voice: 'voice-a' } };
  const defaults = patchJsonBody({ input: 'hello' }, { ...base, modelPolicy: 'default', voicePolicy: 'default' });
  assert.equal(defaults.model, 'tts-model');
  assert.equal(defaults.voice, 'voice-a');

  const forced = patchJsonBody({ model: 'client', voice: 'client-voice' }, { ...base, modelPolicy: 'force', voicePolicy: 'force' });
  assert.equal(forced.model, 'tts-model');
  assert.equal(forced.voice, 'voice-a');

  const passthrough = patchJsonBody({ model: 'client' }, { ...base, modelPolicy: 'passthrough', voicePolicy: 'passthrough' });
  assert.equal(passthrough.model, 'client');
  assert.equal(passthrough.voice, undefined);
});
