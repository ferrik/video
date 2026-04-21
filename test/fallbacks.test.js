const test = require('node:test');
const assert = require('node:assert/strict');

const { generateScriptPlan } = require('../services/ai.service');
const { generateVoiceAsset, generateClipAssets } = require('../services/media.service');

test('generateScriptPlan falls back when no API keys are configured', async () => {
  const originalAnthropic = process.env.ANTHROPIC_API_KEY;
  const originalOpenAI = process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;

  try {
    const plan = await generateScriptPlan({
      topic: 'test topic',
      product: 'test product',
      market: 'US'
    });
    assert.strictEqual(plan.source, 'fallback');
    assert.ok(Array.isArray(plan.scenes) && plan.scenes.length > 0);
    assert.strictEqual(plan.hooks_pool.length >= 1, true);
  } finally {
    if (originalAnthropic) process.env.ANTHROPIC_API_KEY = originalAnthropic;
    else delete process.env.ANTHROPIC_API_KEY;
    if (originalOpenAI) process.env.OPENAI_API_KEY = originalOpenAI;
    else delete process.env.OPENAI_API_KEY;
  }
});

test('generateVoiceAsset returns fallback_error when no TTS providers available', async () => {
  const originalOpenAI = process.env.OPENAI_API_KEY;
  const originalElevenLab = process.env.ELEVENLABS_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.ELEVENLABS_API_KEY;

  try {
    const result = await generateVoiceAsset({ jobId: 'fallback-voice', text: 'hello' });
    assert.strictEqual(result.status, 'fallback_error');
    assert.strictEqual(result.provider, 'none');
  } finally {
    if (originalOpenAI) process.env.OPENAI_API_KEY = originalOpenAI;
    else delete process.env.OPENAI_API_KEY;
    if (originalElevenLab) process.env.ELEVENLABS_API_KEY = originalElevenLab;
    else delete process.env.ELEVENLABS_API_KEY;
  }
});

test('generateClipAssets reports not_configured when Pexels key is missing', async () => {
  const originalPexels = process.env.PEXELS_API_KEY;
  delete process.env.PEXELS_API_KEY;

  try {
    const scenes = [{ scene_id: 1, search_query: 'test clip', duration_sec: 6 }];
    const result = await generateClipAssets({ jobId: 'fallback-clip', scenes });
    assert.strictEqual(result.status, 'not_configured');
    assert.strictEqual(result.provider, 'pexels');
    assert.strictEqual(result.assets.length, scenes.length);
    assert.strictEqual(result.assets[0].status, undefined);
  } finally {
    if (originalPexels) process.env.PEXELS_API_KEY = originalPexels;
    else delete process.env.PEXELS_API_KEY;
  }
});
