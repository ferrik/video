'use strict';

const axios = require('axios');

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

// ── Hook Database ─────────────────────────────────────────────────────────────
// Curated, field-tested hooks per market & niche.
// Usage: getHooks(market, niche) → shuffled top-3

const HOOK_DB = {
  UK: {
    'home security': [
      'UK homes are getting targeted right now',
      'This is why UK houses get broken into',
      'Most UK homes are NOT protected like this',
      'Your front door isn\'t as safe as you think',
      'This one mistake makes your home easy to target'
    ],
    'lawn': [
      'Your lawn is dying and you don\'t see it',
      'UK weather is killing your grass right now',
      'Most UK lawns fail for this reason',
      'Stop ruining your grass like this',
      'This fixes your lawn in days'
    ],
    'solar': [
      'UK energy bills are getting insane',
      'This could cut your electricity costs fast',
      'Most UK homes are wasting power daily',
      'You don\'t need the grid for this',
      'This setup pays for itself quickly'
    ]
  },
  US: {
    'dog toys': [
      'Most dog toys last 5 minutes',
      'Your dog will destroy this instantly',
      'We tested the strongest dog toy',
      'This is what aggressive chewers need',
      'This toy actually survives'
    ],
    'home security': [
      'This is why break-ins happen',
      'Most homes are easy targets',
      'You\'re not as safe as you think',
      'This changes everything about home security',
      'Don\'t wait until it\'s too late'
    ],
    'solar': [
      'Power outage? You\'re not ready',
      'This keeps your home running off-grid',
      'Most people fail in blackouts',
      'This setup saves you in emergencies',
      'You need this before it\'s too late'
    ]
  },
  CA: {
    'winter': [
      'Canada winter will break your home',
      'You\'re not ready for this cold',
      'Most homes fail during winter',
      'This saves you during power outages',
      'Don\'t get caught unprepared'
    ],
    'tools': [
      'This tool saves hours of work',
      'Most people do this the hard way',
      'This makes the job 10x easier',
      'You don\'t need expensive tools',
      'This fixes it in seconds'
    ]
  },
  UNIVERSAL: [
    'Nobody talks about this',
    'This changes everything',
    'Most people don\'t know this',
    'This is why it\'s failing',
    'Stop doing this wrong',
    'This works instantly',
    'This saves you money fast',
    'This is the easiest fix',
    'You need this right now',
    'This actually works'
  ]
};

// Hook scoring: fear +30, emotion +30, specificity +20, brevity +20
const HOOK_SCORE_WEIGHTS = {
  fear:        { patterns: [/you.re|your|lose|break|fail|miss|danger|targ|wrong|ruin|kill|die|late|risk/i], score: 30 },
  emotion:     { patterns: [/insane|crazy|finally|nobody|secret|truth|stop|don.t|never|always|hate|love|need/i], score: 30 },
  specificity: { patterns: [/\d+|saves|costs|hours|days|minutes|seconds|actually|instantly|exactly/i], score: 20 },
  brevity:     { patterns: [/^.{0,45}$/], score: 20 }
};

/**
 * Score a single hook text (0-100)
 */
function scoreHook(text) {
  let total = 0;
  for (const { patterns, score } of Object.values(HOOK_SCORE_WEIGHTS)) {
    if (patterns.some(p => p.test(text))) total += score;
  }
  return Math.min(total, 100);
}

/**
 * Shuffle array in-place (Fisher-Yates)
 */
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Get top DB hooks for a market + niche.
 * Falls back: niche match → universal → all market hooks
 * Returns array of { text, score, source }
 */
function getHooks(market = 'US', niche = '', count = 5) {
  const marketKey = (market || 'US').toUpperCase();
  const nicheKey  = (niche || '').toLowerCase();

  const marketData = HOOK_DB[marketKey] || HOOK_DB['US'];
  let pool = [];

  // 1. Exact niche match
  if (marketData && typeof marketData === 'object' && !Array.isArray(marketData)) {
    for (const [key, hooks] of Object.entries(marketData)) {
      if (nicheKey.includes(key) || key.split(' ').some(w => nicheKey.includes(w))) {
        pool.push(...hooks);
      }
    }
    // 2. All market hooks as fallback
    if (!pool.length) pool = Object.values(marketData).flat();
  }

  // 3. Always add universal hooks
  pool.push(...HOOK_DB.UNIVERSAL);

  // Deduplicate, score, sort, return top N
  const unique = [...new Set(pool)];
  const scored = unique.map(text => ({ text, score: scoreHook(text), source: 'db' }));
  scored.sort((a, b) => b.score - a.score);
  return shuffle(scored.slice(0, Math.max(count * 2, 10))).slice(0, count);
}

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
  const topic   = input.topic   || 'AI content system';
  const product = input.product || 'affiliate product';
  const market  = input.market  || 'US';

  // Pull real DB hooks instead of placeholder strings
  const dbHooks   = getHooks(market, topic, 5);
  const topHook   = dbHooks[0]?.text || `Stop scrolling. Here is the fastest way to fix ${topic}.`;
  const hookScore = dbHooks[0]?.score || 80;

  const scenes = [
    { scene_id: 1, voiceover: topHook,                                                                    on_screen_text: topHook.slice(0, 40).toUpperCase(), search_query: `${topic} problem close up`,        duration_sec: 4 },
    { scene_id: 2, voiceover: `Most people keep doing the obvious thing, but the real fix starts with one hidden detail.`, on_screen_text: 'WHAT EVERYONE MISSES',  search_query: `${topic} hidden issue`,              duration_sec: 4 },
    { scene_id: 3, voiceover: `This is where ${product} comes in. It removes the friction completely.`,    on_screen_text: 'THE SOLUTION',             search_query: `${product} product demo`,            duration_sec: 4 },
    { scene_id: 4, voiceover: `It takes literally seconds to apply and you see the difference instantly.`,  on_screen_text: 'WORKS IN SECONDS',          search_query: `smiling person using ${product}`,   duration_sec: 5 },
    { scene_id: 5, voiceover: `If you want the exact setup, check the link right now.`,                    on_screen_text: 'LINK IN BIO',               search_query: 'smartphone interacting',            duration_sec: 4 }
  ];

  return {
    source: 'fallback',
    viral_structure: { hook: scenes[0].voiceover, problem: scenes[1].voiceover, solution: scenes[2].voiceover, proof: scenes[3].voiceover, cta: scenes[4].voiceover },
    hooks_pool: dbHooks.slice(0, 3).map(h => h.text),
    hooks_scored: dbHooks,
    hook_score: hookScore,
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

  // Seed AI with top DB hooks so it can compete / improve upon them
  const dbHookCandidates = getHooks(market, topic, 5);
  const dbHookLines = dbHookCandidates.map((h, i) => `  ${i + 1}. [score:${h.score}] "${h.text}"`).join('\n');

  const user = [
    `Topic: ${topic}`,
    `Product: ${product}`,
    `Platform: ${platform}`,
    `Target Market: ${market}`,
    `Total duration: ${durationSec} seconds`,
    `\nPRE-SCORED DB HOOKS (use, improve, or beat these):\n${dbHookLines}`,
    '\nTask: Generate 3 hooks. Prefer hooks that score highest on: fear/risk (+30), emotion (+30), specificity/numbers (+20), brevity <45 chars (+20). Use the best as scene 1. Include all 3 in "hooks_pool" with their calculated hook_score.',
    'Generate exactly 5 scenes corresponding to: HOOK → PROBLEM → SOLUTION → PROOF → CTA.',
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
    // Attach DB hooks alongside AI hooks for hybrid output
    const dbHooks = getHooks(market, topic, 5);
    const aiHooksPool = parsed.hooks_pool || [];
    // Merge: AI first, then unique DB hooks not already present
    const mergedPool = [...aiHooksPool];
    for (const h of dbHooks) {
      if (!mergedPool.some(x => x.toLowerCase() === h.text.toLowerCase())) {
        mergedPool.push(h.text);
      }
    }

    return {
      source: useAnthropic ? 'anthropic' : 'openai',
      title: parsed.title || `${topic} automation`,
      caption: parsed.caption || '',
      caption_uk: parsed.caption_uk || '',
      viral_structure: parsed.viral_structure || {},
      hooks_pool: mergedPool.slice(0, 6),
      hooks_scored: mergedPool.slice(0, 6).map(text => ({ text, score: scoreHook(text), source: aiHooksPool.includes(text) ? 'ai' : 'db' })),
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

module.exports = { callAnthropic, callOpenAI, cleanClaudeText, generateScriptPlan, generateSignalBrief, getHooks, scoreHook, HOOK_DB };
