const express = require('express');
const cors = require('cors');
const axios = require('axios');
const rateLimit = require('express-rate-limit');
const dotenv = require('dotenv');
const fs = require('fs/promises');
const path = require('path');
const { promisify } = require('util');
const { execFile } = require('child_process');
const { createClient } = require('@supabase/supabase-js');
const packageJson = require('./package.json');

dotenv.config();
const execFileAsync = promisify(execFile);

function checkEnv() {
  const required = ['ANTHROPIC_API_KEY', 'ELEVENLABS_API_KEY', 'PEXELS_API_KEY'];
  const recommended = ['OPENAI_API_KEY'];
  const missingKeys = required.filter(key => !process.env[key]);
  if (missingKeys.length > 0) {
    console.warn('⚠️  Missing required environment variables:', missingKeys.join(', '));
    if (!process.env.OPENAI_API_KEY) {
      console.warn('   ⚠️  Also missing OPENAI_API_KEY fallback.');
    }
  } else {
    console.log('✅ All core API keys are set.');
  }
}

checkEnv();
const app = express();

const PORT = process.env.PORT || 3000;
const APP_VERSION = packageJson.version || '1.0.3';
const FRONTEND_LABEL = `v${APP_VERSION} · LIVE ON RENDER`;
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20240620';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';
let FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg';

try {
  const ffmpeg = require('@ffmpeg-installer/ffmpeg');
  if (ffmpeg && ffmpeg.path) FFMPEG_PATH = ffmpeg.path;
} catch (e) {
  console.log('Using system ffmpeg or FFMPEG_PATH env var.');
}

const RUNTIME_DIR = path.join(__dirname, 'runtime');
const AUDIO_DIR = path.join(RUNTIME_DIR, 'audio');
const CLIP_DIR = path.join(RUNTIME_DIR, 'clips');
const JOB_DIR = path.join(RUNTIME_DIR, 'jobs');
const RENDER_DIR = path.join(RUNTIME_DIR, 'renders');
const QUEUE_DIR = path.join(RUNTIME_DIR, 'queue');

// ── CORS allowlist ──
const ALLOWED_ORIGINS = [
  'https://creator-os-backend-3uor.onrender.com',
  'http://localhost:3000',
  'http://localhost:3001',
  ...(process.env.CORS_ALLOWED_ORIGIN ? [process.env.CORS_ALLOWED_ORIGIN] : [])
];
app.use(cors({
  origin: (origin, callback) => {
    // allow server-to-server / curl (no origin header)
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-Api-Key']
}));

app.use(express.json({ limit: '2mb' }));
app.use((_req, res, next) => {
  res.setHeader('X-App-Version', APP_VERSION);
  res.setHeader('X-Frontend-Label', FRONTEND_LABEL);
  next();
});

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/', limiter);

// ── Auth middleware (protects mutating endpoints) ──
function requireApiKey(req, res, next) {
  const serverKey = process.env.ADMIN_API_KEY;
  if (!serverKey) return next(); // disabled if key not set (dev mode)
  const clientKey = req.headers['x-api-key'];
  if (!clientKey || clientKey !== serverKey) {
    return res.status(401).json({ error: 'Unauthorized. Missing or invalid X-Api-Key header.' });
  }
  next();
}

app.use(express.static('public', { index: false }));

// ── Runtime static — only renders & audio are public ──
app.use('/runtime/renders', express.static(path.join(RUNTIME_DIR, 'renders')));
app.use('/runtime/audio', express.static(path.join(RUNTIME_DIR, 'audio')));

function uid(prefix = 'job') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function ensureRuntimeDirs() {
  await Promise.all([
    fs.mkdir(RUNTIME_DIR, { recursive: true }),
    fs.mkdir(AUDIO_DIR, { recursive: true }),
    fs.mkdir(CLIP_DIR, { recursive: true }),
    fs.mkdir(JOB_DIR, { recursive: true }),
    fs.mkdir(RENDER_DIR, { recursive: true }),
    fs.mkdir(QUEUE_DIR, { recursive: true })
  ]);
}

function jsonError(res, status, error, details) {
  return res.status(status).json({ error, ...(details ? { details } : {}) });
}

function cleanClaudeText(data) {
  const text = data.content?.map(block => block.text || '').join('') || '';
  return text.replace(/```json|```/g, '').trim();
}

function splitScenes(text, count = 4) {
  const chunks = text
    .split(/[.!?]\s+/)
    .map(chunk => chunk.trim())
    .filter(Boolean);

  if (!chunks.length) {
    return Array.from({ length: count }, (_, index) => ({
      scene_id: index + 1,
      voiceover: `Scene ${index + 1} about the topic.`,
      on_screen_text: `Scene ${index + 1}`,
      search_query: 'product demo',
      duration_sec: 6
    }));
  }

  return chunks.slice(0, count).map((chunk, index) => ({
    scene_id: index + 1,
    voiceover: chunk,
    on_screen_text: chunk.slice(0, 70),
    search_query: chunk.slice(0, 60),
    duration_sec: 6
  }));
}

function fallbackScriptPlan(input) {
  const topic = input.topic || 'AI content system';
  const product = input.product || 'affiliate product';
  const platform = input.platform || 'TikTok';
  const scenes = [
    { scene_id: 1, voiceover: `Stop scrolling. Here is the fastest way to fix ${topic}.`, on_screen_text: `The ${topic} mistake`, search_query: `${topic} problem close up`, duration_sec: 4 },
    { scene_id: 2, voiceover: `Most people keep doing the obvious thing, but the real fix starts with one hidden detail.`, on_screen_text: 'What everyone misses', search_query: `${topic} hidden issue`, duration_sec: 4 },
    { scene_id: 3, voiceover: `This is where ${product} comes in. It removes the friction completely.`, on_screen_text: `${product} solution`, search_query: `${product} product demo`, duration_sec: 4 },
    { scene_id: 4, voiceover: `It takes literally seconds to apply and you see the difference instantly.`, on_screen_text: 'Works in seconds', search_query: `smiling person using ${product}`, duration_sec: 5 },
    { scene_id: 5, voiceover: `If you want the exact setup, check the link right now.`, on_screen_text: 'Link in bio', search_query: `smartphone interacting`, duration_sec: 4 }
  ];

  return {
    source: 'fallback',
    viral_structure: {
      hook: scenes[0].voiceover,
      problem: scenes[1].voiceover,
      solution: scenes[2].voiceover,
      proof: scenes[3].voiceover,
      cta: scenes[4].voiceover
    },
    hooks_pool: [scenes[0].voiceover, "Alternative Hook A", "Alternative Hook B"],
    hook_score: 85,
    full_voiceover: scenes.map(scene => scene.voiceover).join(' '),
    scenes
  };
}

async function callAnthropic(system, messages, model = ANTHROPIC_MODEL, maxTokens = 2500) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not set on server');
  }

  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model,
      max_tokens: maxTokens,
      system,
      messages
    },
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
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY not set on server');
  }

  const response = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model,
      messages,
      response_format: { type: "json_object" }
    },
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

async function generateScriptPlan(input) {
  const useAnthropic = !!process.env.ANTHROPIC_API_KEY;
  const useOpenAI = !!process.env.OPENAI_API_KEY;

  if (!useAnthropic && !useOpenAI) {
    return fallbackScriptPlan(input);
  }

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
        const content = await callOpenAI([
          { role: 'system', content: system },
          { role: 'user', content: user }
        ]);
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
      full_voiceover: parsed.full_voiceover || (parsed.scenes || []).map(scene => scene.voiceover).join(' '),
      scenes: Array.isArray(parsed.scenes) && parsed.scenes.length
        ? parsed.scenes
        : splitScenes(topic, scenesCount)
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

  if (!useAnthropic && !useOpenAI) {
    return {
      source: 'fallback',
      topic,
      angle: `${topic} with a direct product-led hook`,
      audience: `buyers in ${market}`,
      problem: `People in ${market} do not have a simple fast solution for ${topic}.`,
      promise: `${product} helps reduce friction and speed up the outcome.`,
      marketNote: `Prioritize short-form hooks for ${platforms}.`
    };
  }

  const system = [
    'You create compact market-ready signal briefs for an automated short-form content factory.',
    'Return only valid JSON.',
    'Keep the output concise, practical, and ready for script generation.'
  ].join(' ');

  let scrapedIntel = '';
  try {
    const q = encodeURIComponent(`${topic} ${market}`);
    const res = await axios.get(`https://www.reddit.com/search.json?q=${q}&sort=relevance&t=year&limit=5`, {
      headers: { 'User-Agent': 'CreatorOS/1.0' }
    });
    if (res.data?.data?.children) {
      const posts = res.data.data.children.map((c, i) => `${i+1}. ${c.data.title} (Upvotes: ${c.data.score})`);
      scrapedIntel = '\n\nREAL MARKET SIGNALS (Reddit top posts):\n' + posts.join('\n');
    }
  } catch (e) {
    console.warn('Scraping skipped/failed:', e.message);
  }

  const user = [
    `Topic: ${topic}`,
    `Product: ${product}`,
    `Market: ${market}`,
    `Platforms: ${platforms}`,
    scrapedIntel,
    '\nSchema:',
    '{"topic":"string","angle":"string","audience":"string","problem":"string","promise":"string","marketNote":"string"}'
  ].filter(Boolean).join('\n');

  try {
    if (useAnthropic) {
      const data = await callAnthropic(system, [{ role: 'user', content: user }], ANTHROPIC_MODEL, 600);
      return JSON.parse(cleanClaudeText(data));
    }

    const content = await callOpenAI([
      { role: 'system', content: system },
      { role: 'user', content: user }
    ]);
    return JSON.parse(content);
  } catch (error) {
    console.warn('Signal generation fallback:', error.message);
    return {
      source: 'fallback',
      topic,
      angle: `${topic} with a direct product-led hook`,
      audience: `buyers in ${market}`,
      problem: `People in ${market} do not have a simple fast solution for ${topic}.`,
      promise: `${product} helps reduce friction and speed up the outcome.`,
      marketNote: `Prioritize short-form hooks for ${platforms}.`
    };
  }
}

async function saveBuffer(buffer, filePath) {
  await fs.writeFile(filePath, buffer);
  return filePath;
}

async function generateVoiceAsset({ jobId, text, voiceId = ELEVENLABS_VOICE_ID }) {
  if (!text) {
    return { status: 'skipped', reason: 'No voice text provided.' };
  }

  const fileName = `${jobId}.mp3`;
  const filePath = path.join(AUDIO_DIR, fileName);
  const openaiVoice = process.env.OPENAI_TTS_VOICE || 'onyx'; // affordable, confident, neutral

  // PRIMARY: OpenAI TTS ($0.015 / 1k chars — 15x cheaper than ElevenLabs)
  if (process.env.OPENAI_API_KEY) {
    try {
      console.log(`[Factory] 🎙️ OpenAI TTS (${openaiVoice}) → job ${jobId}`);
      const response = await axios.post(
        'https://api.openai.com/v1/audio/speech',
        { model: 'tts-1', input: text, voice: openaiVoice },
        {
          headers: {
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
          },
          responseType: 'arraybuffer',
          timeout: 60000
        }
      );
      await saveBuffer(Buffer.from(response.data), filePath);
      return {
        status: 'completed',
        provider: 'openai',
        voice: openaiVoice,
        filePath,
        publicUrl: `/runtime/audio/${fileName}`
      };
    } catch (e) {
      const errText = e.response?.data ? e.response.data.toString() : e.message;
      console.error(`[OpenAI TTS Error]: ${errText.substring(0, 150)}`);
    }
  }

  // FALLBACK: ElevenLabs (high quality, higher cost)
  if (process.env.ELEVENLABS_API_KEY) {
    try {
      console.log(`[Factory] 🔄 ElevenLabs fallback → job ${jobId}`);
      const response = await axios.post(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
        { text, model_id: 'eleven_multilingual_v2' },
        {
          headers: {
            'xi-api-key': process.env.ELEVENLABS_API_KEY,
            Accept: 'audio/mpeg',
            'Content-Type': 'application/json'
          },
          responseType: 'arraybuffer',
          timeout: 120000
        }
      );
      await saveBuffer(Buffer.from(response.data), filePath);
      return {
        status: 'completed',
        provider: 'elevenlabs',
        filePath,
        publicUrl: `/runtime/audio/${fileName}`
      };
    } catch (error) {
      const errText = error.response?.data ? error.response.data.toString() : error.message;
      console.error(`[ElevenLabs API Error]: ${errText.substring(0, 150)}`);
    }
  }

  return {
    status: 'fallback_error',
    provider: 'none',
    error: 'All TTS providers failed or are missing API keys.',
    filePath: null,
    publicUrl: null
  };
}

function pickPexelsFile(videoFiles = []) {
  const portrait = videoFiles
    .filter(file => file.height >= file.width)
    .sort((a, b) => a.width - b.width);

  if (portrait.length) return portrait[0];
  return videoFiles[0] || null;
}

async function downloadBinary(url, filePath, headers = {}) {
  const response = await axios.get(url, {
    headers,
    responseType: 'arraybuffer',
    timeout: 120000
  });

  await saveBuffer(Buffer.from(response.data), filePath);
  return filePath;
}

async function generateClipAssets({ jobId, scenes = [] }) {
  if (!scenes.length) {
    return { status: 'skipped', assets: [] };
  }

  if (!process.env.PEXELS_API_KEY) {
    return {
      status: 'not_configured',
      provider: 'pexels',
      assets: scenes.map(scene => ({
        scene_id: scene.scene_id,
        query: scene.search_query
      }))
    };
  }

  const assets = [];

  for (const scene of scenes) {
    const searchResponse = await axios.get('https://api.pexels.com/videos/search', {
      headers: { Authorization: process.env.PEXELS_API_KEY },
      params: {
        query: scene.search_query,
        per_page: 1,
        orientation: 'portrait'
      },
      timeout: 60000
    });

    const video = searchResponse.data.videos?.[0];
    const file = pickPexelsFile(video?.video_files || []);

    if (!file?.link) {
      assets.push({
        scene_id: scene.scene_id,
        status: 'missing',
        query: scene.search_query
      });
      continue;
    }

    const fileName = `${jobId}_scene_${scene.scene_id}.mp4`;
    const filePath = path.join(CLIP_DIR, fileName);
    await downloadBinary(file.link, filePath);

    assets.push({
      scene_id: scene.scene_id,
      status: 'completed',
      query: scene.search_query,
      filePath,
      publicUrl: `/runtime/clips/${fileName}`,
      duration_sec: scene.duration_sec
    });
  }

  return {
    status: assets.every(asset => asset.status === 'completed') ? 'completed' : 'partial',
    provider: 'pexels',
    assets
  };
}

function shellQuote(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

// Escape text for FFmpeg drawtext filter
function escapeDrawtext(text) {
  return String(text || '')
    .toUpperCase()
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\\\'")  // escape single quotes
    .replace(/:/g, '\\\\:')  // escape colons
    .replace(/[\r\n]+/g, ' ')  // remove newlines
    .trim()
    .slice(0, 80);  // max 80 chars safety
}

function buildRenderArgs({ clipAssets, audioFilePath, outputFilePath, scenes }) {
  const clipInputs = clipAssets.flatMap(asset => ['-i', asset.filePath]);
  const hasAudio = Boolean(audioFilePath);
  const audioInput = hasAudio ? ['-i', audioFilePath] : [];

  const filters = clipAssets.map((asset, index) => {
    const scene = scenes.find(item => item.scene_id === asset.scene_id) || {};
    const duration = Number(scene.duration_sec || asset.duration_sec || 6);

    // Base video processing
    let f = `[${index}:v]trim=duration=${duration},setpts=PTS-STARTPTS,scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,format=yuv420p`;

    // Add text overlay if on_screen_text exists
    const rawText = scene.on_screen_text || '';
    if (rawText) {
      const safeText = escapeDrawtext(rawText);
      // White bold uppercase text, centered in upper third, semi-transparent dark background box
      f += `,drawtext=text='${safeText}'`
        + `:fontsize=96`
        + `:fontcolor=white`
        + `:x=(w-text_w)/2`
        + `:y=(h-text_h)/3`
        + `:box=1`
        + `:boxcolor=black@0.55`
        + `:boxborderw=30`
        + `:shadowcolor=black@0.8`
        + `:shadowx=3`
        + `:shadowy=3`;
    }

    f += `[v${index}]`;
    return f;
  });

  const concatInputs = clipAssets.map((_, index) => `[v${index}]`).join('');
  const filterComplex = `${filters.join(';')};${concatInputs}concat=n=${clipAssets.length}:v=1:a=0[v]`;

  const args = [
    ...clipInputs,
    ...audioInput,
    '-filter_complex', filterComplex,
    '-map', '[v]',
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-crf', '28',
    '-threads', '1',
    '-y'
  ];

  if (hasAudio) {
    // map the audio file which is the last input (index = clipAssets.length)
    args.push('-map', `${clipAssets.length}:a`, '-c:a', 'aac', '-shortest');
  } else {
    // explicitly say no audio
    args.push('-an');
  }

  args.push(outputFilePath);
  
  return args;
}

// Mapping of products to Amazon ASINs for maximum conversion (Direct Product Links)
const PRODUCT_ASIN_MAP = {
  'ring video doorbell 4': 'B08N5WRWNW',
  'ring doorbell': 'B08N5WRWNW',
  'sunpower solar panel': 'B01N2WG4UE',
  'solar panel': 'B01N2WG4UE',
  'destructive chewer dog toy': 'B007R1BN56',
  'dog toy': 'B007R1BN56',
  'lawn fertilizer': 'B00X797T5W'
};

async function generateAffiliateLink(product) {
  const normalized = (product || '').toLowerCase().trim();
  const amazonTag = process.env.AMAZON_AFFILIATE_TAG || 'YOUR_TAG';
  
  let longUrl;
  
  // Try to find direct ASIN link (High Conversion)
  const asin = PRODUCT_ASIN_MAP[normalized] || Object.keys(PRODUCT_ASIN_MAP).find(k => normalized.includes(k));
  
  if (asin) {
    longUrl = `https://www.amazon.co.uk/dp/${PRODUCT_ASIN_MAP[asin] || asin}/?tag=${amazonTag}`;
  } else {
    // Fallback to search link (Medium Conversion)
    const query = encodeURIComponent(product);
    longUrl = `https://www.amazon.co.uk/s?k=${query}&tag=${amazonTag}&ref=nb_sb_noss`;
  }

  try {
    const res = await axios.get(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(longUrl)}`, { timeout: 5000 });
    return res.data;
  } catch (err) {
    console.warn('TinyURL failed, using long URL:', err.message);
    return longUrl;
  }
}

async function isFfmpegAvailable() {
  try {
    await execFileAsync(FFMPEG_PATH, ['-version']);
    return true;
  } catch {
    return false;
  }
}

async function renderVideoAsset({ jobId, clipAssets = [], audioFilePath, scenes = [], dryRun = false }) {
  if (!clipAssets.length) {
    return {
      status: 'blocked',
      reason: 'Missing local clips for rendering.'
    };
  }

  const ffmpegAvailable = await isFfmpegAvailable();
  const outputFileName = `${jobId}.mp4`;
  const outputFilePath = path.join(RENDER_DIR, outputFileName);
  const args = buildRenderArgs({ clipAssets, audioFilePath, outputFilePath, scenes });
  const commandPreview = `${FFMPEG_PATH} ${args.map(shellQuote).join(' ')}`;

  if (!ffmpegAvailable) {
    return {
      status: 'not_configured',
      provider: 'ffmpeg',
      commandPreview,
      reason: 'FFmpeg is not available on the server.'
    };
  }

  if (dryRun) {
    return {
      status: 'planned',
      provider: 'ffmpeg',
      commandPreview,
      outputFilePath
    };
  }

  await execFileAsync(FFMPEG_PATH, args, { maxBuffer: 1024 * 1024 * 20 });

  return {
    status: 'completed',
    provider: 'ffmpeg',
    commandPreview,
    filePath: outputFilePath,
    publicUrl: `/runtime/renders/${outputFileName}`
  };
}

function buildPublishPlan({ jobId, platform = 'TikTok', renderResult }) {
  const uploadTargets = Array.isArray(platform) ? platform : String(platform).split(',').map(item => item.trim()).filter(Boolean);
  const configured = {
    buffer: Boolean(process.env.BUFFER_ACCESS_TOKEN),
    youtube: Boolean(process.env.YOUTUBE_API_KEY)
  };

  return {
    jobId,
    status: configured.buffer || configured.youtube ? 'ready_for_integration' : 'not_configured',
    output: renderResult?.publicUrl || null,
    uploadTargets,
    configured
  };
}

function buildAnalyticsPlan({ jobId, platform = 'TikTok' }) {
  return {
    jobId,
    status: process.env.YOUTUBE_API_KEY || process.env.TIKTOK_SESSION_ID ? 'ready_for_collection' : 'manual_mode',
    providers: {
      youtube: Boolean(process.env.YOUTUBE_API_KEY),
      tiktok: Boolean(process.env.TIKTOK_SESSION_ID)
    },
    targets: Array.isArray(platform) ? platform : String(platform).split(',').map(item => item.trim()).filter(Boolean)
  };
}

const FACTORY_STEP_DEFS = [
  { key: 'signal_generation', label: 'Сигнал' },
  { key: 'script_generation', label: 'Скрипт' },
  { key: 'voice_generation', label: 'Озвучка' },
  { key: 'clip_fetch', label: 'Кліпи' },
  { key: 'render_plan', label: 'План' },
  { key: 'publish_package', label: 'Пакет' },
  { key: 'save_outputs', label: 'Збереження' },
  { key: 'done', label: 'Готово' }
];

const FACTORY_ACTIVE_STATUSES = ['queued', 'running', 'cancelling'];
const FACTORY_TERMINAL_STATUSES = ['completed', 'failed', 'cancelled', 'requires_follow_up'];
const FACTORY_RETRYABLE_STATUSES = ['failed', 'cancelled', 'requires_follow_up'];

const FACTORY_STATUS_META = {
  queued: { label: 'У черзі', tone: 'amber' },
  running: { label: 'В роботі', tone: 'amber' },
  cancelling: { label: 'Зупиняється', tone: 'amber' },
  completed: { label: 'Завершено', tone: 'green' },
  failed: { label: 'Помилка', tone: 'red' },
  cancelled: { label: 'Зупинено', tone: 'muted' },
  requires_follow_up: { label: 'Потрібен review', tone: 'blue' }
};

const FACTORY_STEP_STATE_META = {
  idle: { label: 'очікує', tone: 'muted' },
  active: { label: 'активно', tone: 'amber' },
  done: { label: 'готово', tone: 'green' },
  failed: { label: 'помилка', tone: 'red' },
  cancelled: { label: 'зупинено', tone: 'muted' },
  needs_review: { label: 'потрібен review', tone: 'blue' }
};

let supabaseServerClient = null;
let supabaseServerInit = false;

function getSupabaseServerClient() {
  if (supabaseServerInit) return supabaseServerClient;
  supabaseServerInit = true;

  const url = process.env.SUPABASE_URL || process.env.SUPABASE_PROJECT_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

  if (!url || !key) {
    console.warn('[Supabase] Server sync disabled: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    supabaseServerClient = null;
    return null;
  }

  supabaseServerClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  return supabaseServerClient;
}

async function syncJobToSupabase(job) {
  const sb = getSupabaseServerClient();
  if (!sb) return { status: 'not_configured' };

  try {
    const payload = {
      id: job.id,
      topic: job.input?.topic || '',
      market: job.input?.market || '',
      status: job.status || 'queued',
      progress: job.progress || 0,
      video_url: job.resultPackage?.videoUrl || null,
      error_message: job.error || null,
      data: job, // full artifact
      updated_at: job.updatedAt || new Date().toISOString()
    };
    
    const { error } = await sb.from('factory_jobs').upsert(payload, { onConflict: 'id' });
    if (error) throw error;
    return { status: 'synced' };
  } catch (error) {
    console.warn('Supabase job sync skipped:', error.message);
    return { status: 'error', error: error.message };
  }
}

async function readJobFromSupabase(jobId) {
  const sb = getSupabaseServerClient();
  if (!sb) return null;

  try {
    const { data, error } = await sb
      .from('factory_jobs')
      .select('data')
      .eq('id', jobId)
      .maybeSingle();
    if (error) throw error;
    return data?.data || null;
  } catch (error) {
    console.warn('Supabase job read skipped:', error.message);
    return null;
  }
}

async function listJobsFromSupabase(limit = 20) {
  const sb = getSupabaseServerClient();
  if (!sb) return [];

  try {
    const { data, error } = await sb
      .from('factory_jobs')
      .select('data, updated_at')
      .order('updated_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data || []).map(row => row.data).filter(Boolean);
  } catch (error) {
    console.warn('Supabase job list skipped:', error.message);
    return [];
  }
}

async function writeJob(job) {
  const filePath = path.join(JOB_DIR, `${job.id}.json`);
  const tempPath = `${filePath}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(job, null, 2));
  await fs.rename(tempPath, filePath);
  await syncJobToSupabase(job);
  return filePath;
}

async function readJob(jobId) {
  const filePath = path.join(JOB_DIR, `${jobId}.json`);
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    const remote = await readJobFromSupabase(jobId);
    if (remote) return remote;
    throw error;
  }
}

async function listJobs(limit = 20) {
  const localJobs = await (async () => {
    try {
      const files = await fs.readdir(JOB_DIR);
      const jobFiles = files.filter(file => file.endsWith('.json'));
      const jobs = await Promise.all(jobFiles.map(async file => {
        try {
          const content = await fs.readFile(path.join(JOB_DIR, file), 'utf8');
          return JSON.parse(content);
        } catch { return null; }
      }));
      return jobs
        .filter(Boolean)
        .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0))
        .slice(0, limit);
    } catch {
      return [];
    }
  })();

  const remoteJobs = await listJobsFromSupabase(limit);
  const merged = new Map();
  [...localJobs, ...remoteJobs].forEach(job => {
    if (!job?.id) return;
    const existing = merged.get(job.id);
    if (!existing || new Date(job.updatedAt || job.createdAt || 0) > new Date(existing.updatedAt || existing.createdAt || 0)) {
      merged.set(job.id, job);
    }
  });

  return Array.from(merged.values())
    .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0))
    .slice(0, limit);
}

function validateFactoryInput(input = {}) {
  const errors = [];
  const topic = String(input.topic || '').trim();
  const product = String(input.product || '').trim();
  const market = String(input.market || '').trim();
  const platformsRaw = Array.isArray(input.platforms)
    ? input.platforms.map(item => String(item).trim()).filter(Boolean)
    : String(input.platform || input.platforms || '')
      .split(',')
      .map(item => item.trim())
      .filter(Boolean);
  const platforms = [...new Set(platformsRaw)];
  const durationSec = Number(input.durationSec || 24);
  const scenesCount = Number(input.advanced?.scenesCount || input.scenesCount || 4);
  const mode = String(input.mode || 'simple').trim() || 'simple';
  const renderMode = String(input.advanced?.renderMode || (input.dryRun ? 'dry' : 'live')).trim() || 'live';

  const ALLOWED_MARKETS = ['AU', 'US', 'UK', 'CA', 'Global'];
  const ALLOWED_PLATFORMS = ['TikTok', 'YouTube Shorts', 'Instagram Reels', 'Pinterest', 'Shorts', 'Reels', 'Instagram'];

  if (!topic) errors.push('Topic is required.');
  if (topic.length < 5) errors.push('Topic must be at least 5 characters long for context.');
  if (topic.length > 180) errors.push('Topic must be 180 characters or less.');
  if (!product) errors.push('Product is required.');
  if (product.length > 100) errors.push('Product name must be 100 characters or less.');
  if (!market) errors.push('Market is required.');
  if (!ALLOWED_MARKETS.includes(market.toUpperCase()) && !ALLOWED_MARKETS.includes(market)) {
    errors.push(`Market "${market}" is not supported. Use: ${ALLOWED_MARKETS.join(', ')}.`);
  }
  
  if (!platforms.length) errors.push('At least one platform is required.');
  if (platforms.length > 3) errors.push('No more than 3 platforms are allowed per run.');
  
  const invalidPlatforms = platforms.filter(p => !ALLOWED_PLATFORMS.includes(p) && !p.toLowerCase().includes('tiktok') && !p.toLowerCase().includes('short') && !p.toLowerCase().includes('reel'));
  if (invalidPlatforms.length > 0) {
    errors.push(`Unsupported platforms: ${invalidPlatforms.join(', ')}. Supported platforms: TikTok, YouTube Shorts, Instagram Reels, Pinterest.`);
  }

  if (!Number.isFinite(durationSec) || durationSec < 6 || durationSec > 90) errors.push('Duration must be between 6 and 90 seconds.');
  if (!Number.isFinite(scenesCount) || scenesCount < 1 || scenesCount > 12) errors.push('Scenes count must be between 1 and 12.');
  if (!['simple', 'advanced'].includes(mode)) errors.push('Mode must be either "simple" or "advanced".');
  if (!['live', 'dry'].includes(renderMode)) errors.push('Render mode must be either "live" or "dry".');

  return {
    ok: errors.length === 0,
    errors,
    value: {
      topic,
      product,
      market,
      platforms,
      durationSec,
      mode,
      advanced: {
        ...(input.advanced || {}),
        scenesCount,
        renderMode
      },
      dryRun: renderMode === 'dry'
    }
  };
}

async function createFactoryJob(input = {}) {
  const job = {
    id: uid('factory'),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    mode: input.mode || 'simple',
    retryOf: input.retryOf || null,
    retryDepth: Number(input.retryDepth || 0),
    input: {
      topic: input.topic || null,
      product: input.product || null,
      market: input.market || null,
      platform: input.platform || input.platforms || null,
      durationSec: input.durationSec || null,
      advanced: input.advanced || {}
    },
    status: 'queued',
    step: 'queued',
    progress: 0,
    stepIndex: 0,
    stepCount: FACTORY_STEP_DEFS.length,
    log: []
  };
  await writeJob(job);
  return job;
}

async function updateFactoryJob(jobId, patch = {}, logMessage = '') {
  const current = await readJob(jobId);
  const nextLog = logMessage
    ? [...(current.log || []), { at: new Date().toISOString(), message: logMessage }]
    : (current.log || []);
  const next = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
    log: nextLog
  };
  await writeJob(next);
  return next;
}

function isFactoryJobTerminal(job) {
  return ['completed', 'failed', 'cancelled', 'requires_follow_up'].includes(job?.status);
}

async function assertFactoryJobNotCancelled(jobId) {
  const job = await readJob(jobId);
  if (!job?.cancelRequested && job?.status !== 'cancelled') return job;

  await updateFactoryJob(jobId, {
    status: 'cancelled',
    cancelRequested: false,
    step: 'cancelled'
  }, 'Factory job зупинено користувачем');

  const error = new Error('Factory job cancelled');
  error.code = 'FACTORY_JOB_CANCELLED';
  throw error;
}

async function cancelFactoryJob(jobId) {
  const current = await readJob(jobId);

  if (isFactoryJobTerminal(current)) {
    return {
      ok: false,
      status: 409,
      error: `Cannot cancel a job in status "${current.status}".`
    };
  }

  if (current.status === 'queued') {
    const cancelled = await updateFactoryJob(jobId, {
      status: 'cancelled',
      cancelRequested: false,
      step: 'cancelled',
      progress: current.progress || 0
    }, 'Factory job скасовано до старту');
    return { ok: true, job: cancelled };
  }

  const cancelling = await updateFactoryJob(jobId, {
    cancelRequested: true,
    status: 'cancelling'
  }, 'Отримано запит на зупинку job');

  return { ok: true, job: cancelling };
}

async function executeFactoryJob(jobId, input = {}) {
  const platform = Array.isArray(input.platforms)
    ? input.platforms.join(',')
    : (input.platform || input.platforms || 'TikTok,YouTube Shorts,Instagram');
  const dryRun = Boolean(input.dryRun || input.advanced?.dryRun || input.advanced?.renderMode === 'dry');

  try {
    await assertFactoryJobNotCancelled(jobId);
    await updateFactoryJob(jobId, {
      status: 'running',
      step: 'signal_generation',
      stepIndex: 1,
      progress: 8
    }, 'Генерація signal brief');

    const signalBrief = await generateSignalBrief({
      topic: input.topic,
      product: input.product,
      market: input.market,
      platforms: input.platforms || input.platform
    });

    await assertFactoryJobNotCancelled(jobId);
    await updateFactoryJob(jobId, {
      signalBrief,
      step: 'script_generation',
      stepIndex: 2,
      progress: 18
    }, 'Генерація script plan');

    const scriptPlan = input.scriptPlan || await generateScriptPlan({
      topic: signalBrief?.topic || input.topic,
      product: input.product,
      platform,
      durationSec: input.durationSec,
      scenesCount: input.advanced?.scenesCount || input.scenesCount
    });

    await assertFactoryJobNotCancelled(jobId);
    await updateFactoryJob(jobId, {
      scriptPlan,
      step: 'voice_generation',
      stepIndex: 3,
      progress: 32
    }, 'Генерація voiceover');

    const voiceResult = await generateVoiceAsset({
      jobId,
      text: scriptPlan.full_voiceover,
      voiceId: input.advanced?.voiceId || input.voiceId || ELEVENLABS_VOICE_ID
    });

    await assertFactoryJobNotCancelled(jobId);
    await updateFactoryJob(jobId, {
      voiceResult,
      step: 'clip_fetch',
      stepIndex: 4,
      progress: 46
    }, 'Пошук кліпів');

    const clipResult = await generateClipAssets({
      jobId,
      scenes: scriptPlan.scenes || []
    });

    await assertFactoryJobNotCancelled(jobId);
    await updateFactoryJob(jobId, {
      clipResult,
      step: 'render_plan',
      stepIndex: 5,
      progress: 60
    }, 'Планування рендера');

    const clipAssets = (clipResult.assets || []).filter(asset => asset.status === 'completed');
    const renderResult = await renderVideoAsset({
      jobId,
      clipAssets,
      audioFilePath: voiceResult.filePath,
      scenes: scriptPlan.scenes || [],
      dryRun
    });

    await assertFactoryJobNotCancelled(jobId);
    await updateFactoryJob(jobId, {
      renderResult,
      step: 'publish_package',
      stepIndex: 6,
      progress: 76
    }, 'Підготовка publish package');

    const publishPlan = buildPublishPlan({
      jobId,
      platform,
      renderResult
    });

    const analyticsPlan = buildAnalyticsPlan({
      jobId,
      platform
    });

    const hashtags = (scriptPlan.caption || '')
      .split(/\s+/)
      .filter(token => token.startsWith('#'))
      .slice(0, 8);

    const wordCount = (scriptPlan.full_voiceover || '').split(' ').length;
    const estDuration = Math.round(wordCount / 2.5); // ~2.5 words per sec
    const qualityScore = (scriptPlan.title?.length > 10 && scriptPlan.hook?.length > 10 && clipResult.assets?.length >= 2) ? 'HIGH' : 'STANDARD';

    let affiliateLink = `https://www.amazon.co.uk/s?k=${encodeURIComponent(input.product || 'affiliate')}&tag=YOUR_TAG`;
    try {
      affiliateLink = await generateAffiliateLink(input.product || 'affiliate product');
    } catch (affErr) {
      console.warn('Affiliate link generation failed, using fallback:', affErr.message);
    }

    const resultPackage = {
      signalBrief,
      videoUrl: renderResult?.publicUrl || null,
      title: scriptPlan.title || input.topic || 'Factory output',
      caption: scriptPlan.caption || '',
      caption_uk: scriptPlan.caption_uk || '',
      hooks_pool: scriptPlan.hooks_pool || [],
      hook_score: scriptPlan.hook_score || 0,
      hashtags,
      affiliateLink,
      publishNotes: `Ready for manual publishing on ${platform}. Target: ${input.market}.`,
      voiceUrl: voiceResult?.publicUrl || null,
      metadata: {
        wordCount,
        estimatedDurationSec: estDuration,
        scenesCount: scriptPlan.scenes?.length || 0,
        quality: qualityScore,
        hook: scriptPlan.hook
      },
      clips: (clipResult.assets || []).map(asset => ({
        scene_id: asset.scene_id,
        query: asset.query,
        publicUrl: asset.publicUrl || null,
        status: asset.status,
        duration: asset.duration_sec || 6
      }))
    };

    await assertFactoryJobNotCancelled(jobId);
    await updateFactoryJob(jobId, {
      publishPlan,
      analyticsPlan,
      resultPackage,
      step: 'save_outputs',
      stepIndex: 7,
      progress: 92
    }, 'Збереження результатів job');

    return await updateFactoryJob(jobId, {
      status: renderResult.status === 'completed' ? 'completed' : 'requires_follow_up',
      step: 'done',
      stepIndex: 8,
      progress: 100
    }, 'Factory job завершено');
  } catch (error) {
    if (error?.code === 'FACTORY_JOB_CANCELLED') {
      return readJob(jobId);
    }
    const errorDetails = error.response?.data || error.message;
    await updateFactoryJob(jobId, {
      status: 'failed',
      step: 'failed',
      error: errorDetails
    }, `Помилка: ${typeof errorDetails === 'string' ? errorDetails : JSON.stringify(errorDetails)}`);
    throw error;
  }
}

function buildFactoryPackageText(job) {
  const result = job?.resultPackage || {};
  const lines = [
    'CREATOR OS — FACTORY PACKAGE',
    `Job: ${job?.id || '—'}`,
    `Status: ${job?.status || '—'}`,
    `Created: ${job?.createdAt || '—'}`,
    '',
    `Topic: ${job?.input?.topic || '—'}`,
    `Product: ${job?.input?.product || '—'}`,
    `Market: ${job?.input?.market || '—'}`,
    `Platforms: ${Array.isArray(job?.input?.platform) ? job.input.platform.join(', ') : (job?.input?.platform || '—')}`,
    '',
    'SIGNAL',
    result.signalBrief?.angle || '—',
    result.signalBrief?.audience ? `Audience: ${result.signalBrief.audience}` : '',
    result.signalBrief?.problem ? `Problem: ${result.signalBrief.problem}` : '',
    result.signalBrief?.promise ? `Promise: ${result.signalBrief.promise}` : '',
    result.signalBrief?.marketNote ? `Market note: ${result.signalBrief.marketNote}` : '',
    '',
    'TITLE',
    result.title || '—',
    '',
    'CAPTION',
    result.caption || '—',
    '',
    'HASHTAGS',
    (result.hashtags || []).join(' ') || '—',
    '',
    'AFFILIATE LINK / OUTPUT',
    result.affiliateLink || '—',
    '',
    'METADATA',
    `Quality: ${result.metadata?.quality || '—'}`,
    `Est. Duration: ${result.metadata?.estimatedDurationSec || '—'}s (${result.metadata?.wordCount || 0} words)`,
    `Scenes: ${result.metadata?.scenesCount || '—'}`,
    `Hook: ${result.metadata?.hook || '—'}`,
    '',
    'PUBLISH NOTES',
    result.publishNotes || '—',
    '',
    'VIDEO URL',
    result.videoUrl || '—',
    '',
    'VOICE URL',
    result.voiceUrl || '—',
    '',
    'CLIPS',
    ...((result.clips || []).map(clip => `Scene ${clip.scene_id} (${clip.duration}s): [${clip.status}] ${clip.query || '—'} -> ${clip.publicUrl || '—'}`))
  ];
  return lines.join('\n');
}

function getAutomationStatus(ffmpegAvailable) {
  return {
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
    openai: Boolean(process.env.OPENAI_API_KEY),
    elevenlabs: Boolean(process.env.ELEVENLABS_API_KEY),
    pexels: Boolean(process.env.PEXELS_API_KEY),
    buffer: Boolean(process.env.BUFFER_ACCESS_TOKEN),
    youtube: Boolean(process.env.YOUTUBE_API_KEY),
    tiktok: Boolean(process.env.TIKTOK_SESSION_ID),
    ffmpeg: ffmpegAvailable
  };
}

app.get('/health', async (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.get('/api/version', (_req, res) => {
  res.json({
    version: APP_VERSION,
    frontendLabel: FRONTEND_LABEL
  });
});

app.get('/version', (_req, res) => {
  res.json({
    version: APP_VERSION,
    frontendLabel: FRONTEND_LABEL
  });
});

// Public config endpoint — exposes client key for the frontend
app.get('/api/config', (_req, res) => {
  res.json({ 
    adminAuthEnabled: Boolean(process.env.ADMIN_API_KEY),
    appVersion: APP_VERSION 
  });
});

app.get('/api/automation/status', async (_req, res) => {
  const ffmpegAvailable = await isFfmpegAvailable();
  res.json({
    status: 'ok',
    services: getAutomationStatus(ffmpegAvailable)
  });
});

app.get('/api/factory/meta', (_req, res) => {
  res.json({
    steps: FACTORY_STEP_DEFS,
    activeStatuses: FACTORY_ACTIVE_STATUSES,
    terminalStatuses: FACTORY_TERMINAL_STATUSES,
    retryableStatuses: FACTORY_RETRYABLE_STATUSES,
    statusMeta: FACTORY_STATUS_META,
    stepStateMeta: FACTORY_STEP_STATE_META
  });
});

app.get('/api/factory/jobs', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 50);
    const jobs = await listJobs(limit);
    res.json({ jobs });
  } catch (error) {
    jsonError(res, 500, 'Failed to list jobs', error.message);
  }
});

app.get('/api/factory/jobs/:jobId', async (req, res) => {
  try {
    const job = await readJob(req.params.jobId);
    res.json(job);
  } catch (error) {
    jsonError(res, 404, 'Job not found', error.message);
  }
});

app.get('/api/factory/jobs/:jobId/package.txt', async (req, res) => {
  try {
    const job = await readJob(req.params.jobId);
    const body = buildFactoryPackageText(job);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${job.id}-package.txt"`);
    res.send(body);
  } catch (error) {
    jsonError(res, 404, 'Job package not found', error.message);
  }
});

app.post('/api/factory/jobs/:jobId/cancel', requireApiKey, async (req, res) => {
  try {
    const result = await cancelFactoryJob(req.params.jobId);
    if (!result.ok) {
      return jsonError(res, result.status || 500, 'Cannot cancel job', result.error);
    }
    res.json(result.job);
  } catch (error) {
    jsonError(res, 404, 'Job not found', error.message);
  }
});

app.post('/api/factory/jobs/:jobId/retry', requireApiKey, async (req, res) => {
  try {
    const existing = await readJob(req.params.jobId);
    const validation = validateFactoryInput({
      ...existing.input,
      ...req.body
    });
    if (!validation.ok) {
      return jsonError(res, 400, 'Invalid factory payload', validation.errors);
    }
    const job = await createFactoryJob({
      ...validation.value,
      retryOf: existing.id,
      retryDepth: Number(existing.retryDepth || 0) + 1
    });
    executeFactoryJob(job.id, validation.value).catch(err => console.error(`❌ Factory retry error [${job.id}]:`, err.response?.data || err.message));
    res.status(202).json(job);
  } catch (error) {
    jsonError(res, 404, 'Retry source job not found', error.message);
  }
});

app.post('/api/factory/run', requireApiKey, async (req, res) => {
  const validation = validateFactoryInput(req.body || {});
  try {
    if (!validation.ok) {
      return jsonError(res, 400, 'Invalid factory payload', validation.errors);
    }
    const job = await createFactoryJob(validation.value);
    executeFactoryJob(job.id, validation.value).catch(err => console.error(`❌ Factory job error [${job.id}]:`, err.response?.data || err.message));
    res.status(202).json(job);
  } catch (error) {
    jsonError(res, 500, 'Failed to start factory job', error.message);
  }
});

app.post('/api/chat', requireApiKey, async (req, res) => {
  const { system, messages, model } = req.body;

  if (!process.env.ANTHROPIC_API_KEY) {
    return jsonError(res, 500, 'ANTHROPIC_API_KEY not set on server');
  }

  try {
    const data = await callAnthropic(system, messages, model);
    res.json(data);
  } catch (error) {
    const errorDetails = error.response?.data || error.message;
    console.error(`❌ AI Proxy Error [${model}]:`, errorDetails);
    jsonError(res, error.response?.status || 500, 'AI Call Failed', errorDetails);
  }
});

app.post('/api/automation/script', requireApiKey, async (req, res) => {
  try {
    const plan = await generateScriptPlan(req.body || {});
    res.json(plan);
  } catch (error) {
    console.error('Script automation error:', error.message);
    jsonError(res, 500, 'Failed to generate script', error.message);
  }
});

app.post('/api/automation/full-video', requireApiKey, async (req, res) => {
  const input = req.body || {};
  const jobId = uid('video');

  try {
    const scriptPlan = input.scriptPlan || await generateScriptPlan(input);
    const voiceResult = await generateVoiceAsset({
      jobId,
      text: scriptPlan.full_voiceover,
      voiceId: input.voiceId || ELEVENLABS_VOICE_ID
    });

    const clipResult = await generateClipAssets({
      jobId,
      scenes: scriptPlan.scenes || []
    });

    const clipAssets = (clipResult.assets || []).filter(asset => asset.status === 'completed');
    const renderResult = await renderVideoAsset({
      jobId,
      clipAssets,
      audioFilePath: voiceResult.filePath,
      scenes: scriptPlan.scenes || [],
      dryRun: Boolean(input.dryRun)
    });

    const publishPlan = buildPublishPlan({
      jobId,
      platform: input.platform || 'TikTok,YouTube Shorts,Instagram',
      renderResult
    });

    const analyticsPlan = buildAnalyticsPlan({
      jobId,
      platform: input.platform || 'TikTok,YouTube Shorts,Instagram'
    });

    const job = {
      id: jobId,
      createdAt: new Date().toISOString(),
      input: {
        topic: input.topic || null,
        product: input.product || null,
        platform: input.platform || null,
        durationSec: input.durationSec || null
      },
      status: renderResult.status === 'completed' ? 'completed' : 'requires_follow_up',
      scriptPlan,
      voiceResult,
      clipResult,
      renderResult,
      publishPlan,
      analyticsPlan
    };

    await writeJob(job);
    console.log(`✅ Job ${jobId} completed successfully.`);
    res.json(job);
  } catch (error) {
    const errorDetails = error.response?.data || error.message;
    console.error(`❌ Full automation error [Job ${jobId}]:`, errorDetails);
    jsonError(res, 500, 'Failed to run full automation', errorDetails);
  }
});

/* ── / route ── */
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index_factory.html'));
});

/* ── /legacy route ── */
app.get('/legacy', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/* ── QUEUE HELPERS ── */
const QUEUE_FILE = path.join(QUEUE_DIR, 'queue.json');

async function readQueue() {
  try {
    const raw = await fs.readFile(QUEUE_FILE, 'utf8');
    return JSON.parse(raw);
  } catch { return []; }
}

async function writeQueue(scenarios) {
  await fs.mkdir(QUEUE_DIR, { recursive: true });
  await fs.writeFile(QUEUE_FILE, JSON.stringify(scenarios, null, 2));
}

/* ── GET /api/factory/queue ── */
app.get('/api/factory/queue', async (_req, res) => {
  try {
    const scenarios = await readQueue();
    res.json({ scenarios });
  } catch (error) {
    jsonError(res, 500, 'Failed to read queue', error.message);
  }
});

/* ── POST /api/factory/queue/generate ── */
app.post('/api/factory/queue/generate', requireApiKey, async (req, res) => {
  const market = String(req.body?.market || 'AU').toUpperCase();
  const niche = String(req.body?.niche || 'pest control');
  const count = Math.min(Number(req.body?.count || 10), 20);

  const useAnthropic = !!process.env.ANTHROPIC_API_KEY;
  const useOpenAI = !!process.env.OPENAI_API_KEY;

  if (!useAnthropic && !useOpenAI) {
    // FALLBACK IF NO KEYS ARE SET
    const dummyScenarios = [
      { id: uid('scenario'), topic: 'Spider season prep', product: 'Raid Max AU$18', hook: 'Why AU renters need this now', market, score: 85, status: 'pending', createdAt: new Date().toISOString() },
      { id: uid('scenario'), topic: 'Cockroach gel trick', product: 'Yates Gel AU$12', hook: 'The $12 trick landlords hate', market, score: 92, status: 'pending', createdAt: new Date().toISOString() },
      { id: uid('scenario'), topic: 'Ants in kitchen', product: 'Ant Rid AU$9', hook: 'Stop ants in 5 minutes', market, score: 71, status: 'pending', createdAt: new Date().toISOString() }
    ];
    await writeQueue(dummyScenarios);
    return res.json({ scenarios: dummyScenarios, count: dummyScenarios.length });
  }

  const MARKET_CONTEXTS = {
    AU: { name: 'Australia', currency: 'AU$', amazon: 'amazon.com.au', cities: ['Sydney','Melbourne','Brisbane','Perth'] },
    US: { name: 'United States', currency: '$', amazon: 'amazon.com', cities: ['New York','Los Angeles','Chicago','Houston'] },
    UK: { name: 'United Kingdom', currency: '£', amazon: 'amazon.co.uk', cities: ['London','Manchester','Birmingham','Leeds'] },
    CA: { name: 'Canada', currency: 'CA$', amazon: 'amazon.ca', cities: ['Toronto','Vancouver','Calgary','Montreal'] },
    Global: { name: 'Global', currency: '$', amazon: 'amazon.com', cities: ['London','New York','Sydney','Toronto'] },
  };
  const mCtx = MARKET_CONTEXTS[market] || MARKET_CONTEXTS['Global'];

  const system = 'You are a content strategy AI for short-form video affiliate marketing. Return only valid JSON.';
  const user = [
    `Generate ${count} unique video scenario ideas for the ${niche} niche targeting the ${mCtx.name} market.`,
    `Cities: ${mCtx.cities.join(', ')}. Amazon: ${mCtx.amazon}. Currency: ${mCtx.currency}.`,
    'For each scenario provide: topic (short punchy title), product (specific product name + price), hook (first sentence), score (0-100 based on CTR potential/seasonality/competition).',
    'Vary the score realistically. High score=75-90, medium=55-74, low=35-54.',
    'Schema: {"scenarios":[{"topic":"string","product":"string","hook":"string","market":"string","score":number,"scoreBreakdown":{"ctr":number,"competition":number,"product":number,"geo":number}}]}'
  ].join(' ');

  try {
    let parsed;
    try {
      if (useAnthropic) {
        const data = await callAnthropic(system, [{ role: 'user', content: user }], ANTHROPIC_MODEL, 2000);
        parsed = JSON.parse(cleanClaudeText(data));
      } else {
        throw new Error('Пропуск Anthropic (відсутній ключ)');
      }
    } catch (anthropicErr) {
      console.log('Anthropic failed/skipped, trying OpenAI...', anthropicErr.message);
      if (useOpenAI) {
        const content = await callOpenAI([{ role: 'system', content: system }, { role: 'user', content: user }]);
        parsed = JSON.parse(cleanClaudeText({ content: [{ text: content }] }));
      } else {
        throw new Error('Усі AI-моделі недоступні (Або вичерпано ліміти балансу). Перевірте налаштування ключів API.');
      }
    }

    const scenarios = (parsed.scenarios || []).slice(0, count).map((s, i) => ({
      id: uid('scenario'),
      topic: s.topic || `${niche} tip ${i + 1}`,
      product: s.product || 'affiliate product',
      hook: s.hook || '',
      market,
      score: Number(s.score) || 60,
      scoreBreakdown: s.scoreBreakdown || {},
      status: 'pending',
      createdAt: new Date().toISOString()
    }));

    await writeQueue(scenarios);
    res.json({ scenarios, count: scenarios.length });
  } catch (error) {
    console.error('Queue generation error:', error.message);
    jsonError(res, 500, 'Збій під час створення списку ідей', error.message);
  }
});

/* ── PATCH /api/factory/queue/:scenarioId ── */
app.patch('/api/factory/queue/:scenarioId', async (req, res) => {
  try {
    const scenarios = await readQueue();
    const idx = scenarios.findIndex(s => s.id === req.params.scenarioId);
    if (idx === -1) return jsonError(res, 404, 'Scenario not found');
    scenarios[idx] = { ...scenarios[idx], ...req.body, id: scenarios[idx].id };
    await writeQueue(scenarios);
    res.json(scenarios[idx]);
  } catch (error) {
    jsonError(res, 500, 'Failed to update scenario', error.message);
  }
});

async function startServer(port = PORT) {
  await ensureRuntimeDirs();
  return app.listen(port, () => console.log(`Server running on port ${port}`));
}

if (require.main === module) {
  startServer().catch(error => {
    console.error('Failed to initialize runtime directories:', error);
    process.exit(1);
  });
}

module.exports = {
  app,
  startServer,
  ensureRuntimeDirs,
  validateFactoryInput,
  createFactoryJob,
  readJob,
  listJobs
};
