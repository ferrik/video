'use strict';

const axios = require('axios');

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20240620';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

// ── Low-level AI callers ──────────────────────────────────────────────────────

async function callAnthropic(system, messages, model = ANTHROPIC_MODEL, maxTokens = 2500) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set on server');
  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    { model, max_tokens: maxTokens, system, messages },
    {
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      timeout: 60000
    }
  );
  return response.data;
}

async function callOpenAI(messages, model = OPENAI_MODEL) {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set on server');
  const response = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    { model, messages, response_format: { type: 'json_object' } },
    {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      timeout: 60000
    }
  );
  return response.data.choices[0].message.content;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function cleanClaudeText(data) {
  const text = data.content?.map(block => block.text || '').join('') || '';
  return text.replace(/```json|```/g, '').trim();
}

function splitScenes(text, count = 4) {
  const chunks = text.split(/[.!?]\s+/).map(c => c.trim()).filter(Boolean);
  if (!chunks.length) {
    return Array.from({ length: count }, (_, i) => ({
      scene_id: i + 1,
      voiceover: `Scene ${i + 1} about the topic.`,
      on_screen_text: `Scene ${i + 1}`,
      search_query: 'product demo',
      duration_sec: 6
    }));
  }
  return chunks.slice(0, count).map((chunk, i) => ({
    scene_id: i + 1,
    voiceover: chunk,
    on_screen_text: chunk.slice(0, 70),
    search_query: chunk.slice(0, 60),
    duration_sec: 6
  }));
}

function fallbackScriptPlan(input) {
  const topic = input.topic || 'AI content system';
  const product = input.product || 'affiliate product';
  const scenes = [
    { scene_id: 1, voiceover: `Stop scrolling. Here is the fastest way to fix ${topic}.`, on_screen_text: `The ${topic} mistake`, search_query: `${topic} problem close up`, duration_sec: 4 },
    { scene_id: 2, voiceover: `Most people keep doing the obvious thing, but the real fix starts with one hidden detail.`, on_screen_text: 'What everyone misses', search_query: `${topic} hidden issue`, duration_sec: 4 },
    { scene_id: 3, voiceover: `This is where ${product} comes in. It removes the friction completely.`, on_screen_text: `${product} solution`, search_query: `${product} product demo`, duration_sec: 4 },
    { scene_id: 4, voiceover: `It takes literally seconds to apply and you see the difference instantly.`, on_screen_text: 'Works in seconds', search_query: `smiling person using ${product}`, duration_sec: 5 },
    { scene_id: 5, voiceover: `If you want the exact setup, check the link right now.`, on_screen_text: 'Link in bio', search_query: 'smartphone interacting', duration_sec: 4 }
  ];
  return {
    source: 'fallback',
    viral_structure: { hook: scenes[0].voiceover, problem: scenes[1].voiceover, solution: scenes[2].voiceover, proof: scenes[3].voiceover, cta: scenes[4].voiceover },
    hooks_pool: [scenes[0].voiceover, 'Alternative Hook A', 'Alternative Hook B'],
    hook_score: 85,
    full_voiceover: scenes.map(s => s.voiceover).join(' '),
    scenes
  };
}

// ── Public Service Functions ──────────────────────────────────────────────────

async function generateScriptPlan(input) {
  const useAnthropic = !!process.env.ANTHROPIC_API_KEY;
  const useOpenAI = !!process.env.OPENAI_API_KEY;
  if (!useAnthropic && !useOpenAI) return fallbackScriptPlan(input);

  const topic = input.topic || 'AI content system';
  const product = input.product || 'affiliate product';
  const platform = input.platform || 'TikTok';
  const durationSec = input.durationSec || 24;
  const scenesCount = input.scenesCount || 4;
  const market = input.market || 'Global';

  const system = [
    'You are a viral TikTok script generator.',
    'Your ONLY goal is to stop the scroll.',
    'Rules:',
    '- First line must create tension or fear',
    '- Focus on pain or problem',
    '- No generic phrases',
    '- No product description first',
    '- Speak like real human',
    '- Max 8 words per line',
    'Structure: 1. HOOK (shock, fear, or curiosity) 2. PROBLEM (what is going wrong) 3. SOLUTION (product fixes it) 4. PROOF (why it works) 5. CTA (must push user to click "link in bio").',
    'Also generate overlay text (very short phrases) for each scene.',
    'IMPORTANT: The on_screen_text field is what actually gets written over the video. Make it MAX 5 WORDS, uppercase, aggressive and highly readable.',
    'Product Focus: Always include the exact BRAND and MODEL in the product field to maximize affiliate link accuracy (e.g., "Ring Video Doorbell 4" instead of "doorbell").',
    'Return ONLY valid JSON including a pool of 3 candidate hooks and a calculated hook_score (0-100).'
  ].join('\n');

  const user = [
    `Topic: ${topic}`,
    `Product: ${product}`,
    `Platform: ${platform}`,
    `Target Market: ${market}`,
    `Total duration: ${durationSec} seconds`,
    'Task: Generate 3 different hooks internally, pick the absolute best one (highest tension/fear), and use it for scene 1. Also include all 3 in "hooks_pool".',
    'Generate exactly 5 scenes corresponding to the 5 structure steps.',
    'Schema:',
    '{"title":"string (aggressive hook)","caption":"string","hooks_pool":["string","string","string"],"hook_score":95,"viral_structure":{"hook":"string","problem":"string","solution":"string","proof":"string","cta":"string"},"scenes":[{"scene_id":1,"voiceover":"string","on_screen_text":"string","search_query":"string","duration_sec":4}]}'
  ].join('\n');

  try {
    let parsed;
    try {
      if (useAnthropic) {
        const data = await callAnthropic(system, [{ role: 'user', content: user }]);
        parsed = JSON.parse(cleanClaudeText(data));
      } else {
        throw new Error('Anthropic skipped');
      }
    } catch (anthropicErr) {
      console.log('Script plan Anthropic failed/skipped:', anthropicErr.message);
      if (useOpenAI) {
        const content = await callOpenAI([{ role: 'system', content: system }, { role: 'user', content: user }]);
        parsed = JSON.parse(cleanClaudeText({ content: [{ text: content }] }));
      } else {
        throw new Error('All AI providers failed');
      }
    }
    return {
      source: useAnthropic ? 'anthropic' : 'openai',
      title: parsed.title || `${topic} automation`,
      caption: parsed.caption || '',
      caption_uk: parsed.caption_uk || '',
      viral_structure: parsed.viral_structure || {},
      hooks_pool: parsed.hooks_pool || [],
      hook_score: parsed.hook_score || 0,
      full_voiceover: parsed.full_voiceover || (parsed.scenes || []).map(s => s.voiceover).join(' '),
      scenes: Array.isArray(parsed.scenes) && parsed.scenes.length ? parsed.scenes : splitScenes(topic, scenesCount)
    };
  } catch (error) {
    console.warn('Script generation fallback:', error.message);
    return fallbackScriptPlan(input);
  }
}

async function generateSignalBrief(input = {}) {
  const useAnthropic = !!process.env.ANTHROPIC_API_KEY;
  const useOpenAI = !!process.env.OPENAI_API_KEY;
  const topic = input.topic || 'AI content system';
  const product = input.product || 'affiliate product';
  const market = input.market || 'Global';
  const platforms = Array.isArray(input.platforms) ? input.platforms.join(', ') : (input.platform || 'TikTok');

  const fallback = {
    source: 'fallback', topic,
    angle: `${topic} with a direct product-led hook`,
    audience: `buyers in ${market}`,
    problem: `People in ${market} do not have a simple fast solution for ${topic}.`,
    promise: `${product} helps reduce friction and speed up the outcome.`,
    marketNote: `Prioritize short-form hooks for ${platforms}.`
  };

  if (!useAnthropic && !useOpenAI) return fallback;

  const system = 'You create compact market-ready signal briefs for an automated short-form content factory. Return only valid JSON. Keep the output concise, practical, and ready for script generation.';

  let scrapedIntel = '';
  try {
    const q = encodeURIComponent(`${topic} ${market}`);
    const res = await axios.get(`https://www.reddit.com/search.json?q=${q}&sort=relevance&t=year&limit=5`, {
      headers: { 'User-Agent': 'CreatorOS/1.0' }
    });
    if (res.data?.data?.children) {
      const posts = res.data.data.children.map((c, i) => `${i + 1}. ${c.data.title} (Upvotes: ${c.data.score})`);
      scrapedIntel = '\n\nREAL MARKET SIGNALS (Reddit top posts):\n' + posts.join('\n');
    }
  } catch (e) {
    console.warn('Scraping skipped/failed:', e.message);
  }

  const user = [
    `Topic: ${topic}`, `Product: ${product}`, `Market: ${market}`, `Platforms: ${platforms}`,
    scrapedIntel, '\nSchema:',
    '{"topic":"string","angle":"string","audience":"string","problem":"string","promise":"string","marketNote":"string"}'
  ].filter(Boolean).join('\n');

  try {
    if (useAnthropic) {
      const data = await callAnthropic(system, [{ role: 'user', content: user }], ANTHROPIC_MODEL, 600);
      return JSON.parse(cleanClaudeText(data));
    }
    const content = await callOpenAI([{ role: 'system', content: system }, { role: 'user', content: user }]);
    return JSON.parse(content);
  } catch (error) {
    console.warn('Signal generation fallback:', error.message);
    return fallback;
  }
}

module.exports = { callAnthropic, callOpenAI, cleanClaudeText, generateScriptPlan, generateSignalBrief };
