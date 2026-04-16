const express = require('express');
const cors = require('cors');
const axios = require('axios');
const rateLimit = require('express-rate-limit');
const dotenv = require('dotenv');
const fs = require('fs/promises');
const path = require('path');
const packageJson = require('./package.json');

dotenv.config();

// ── Service modules ───────────────────────────────────────────────────────────
const { generateScriptPlan, generateSignalBrief, callAnthropic, callOpenAI, cleanClaudeText } = require('./services/ai.service');
const { generateVoiceAsset, generateClipAssets } = require('./services/media.service');
const { renderVideoAsset, buildRenderArgs } = require('./services/render.service');
const { generateAffiliateLink, affiliateRedirectHandler, getClickStats } = require('./services/monetization');
const { writeJob, readJob, listJobs, updateJob } = require('./services/jobs.store');
const { getWinners, cloneWinner, getRanking, DEFAULT_WINNER_THRESHOLD } = require('./services/winner.engine');

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
  const RUNTIME_DIR = path.join(__dirname, 'runtime');
  await Promise.all([
    fs.mkdir(RUNTIME_DIR, { recursive: true }),
    fs.mkdir(path.join(RUNTIME_DIR, 'audio'), { recursive: true }),
    fs.mkdir(path.join(RUNTIME_DIR, 'clips'), { recursive: true }),
    fs.mkdir(path.join(RUNTIME_DIR, 'jobs'), { recursive: true }),
    fs.mkdir(path.join(RUNTIME_DIR, 'renders'), { recursive: true }),
    fs.mkdir(path.join(RUNTIME_DIR, 'queue'), { recursive: true })
  ]);
}

function jsonError(res, status, error, details) {
  return res.status(status).json({ error, ...(details ? { details } : {}) });
}

// Voice generation handled by services/media.service.js

// Render handled by services/render.service.js
// Affiliate + monetization handled by services/monetization.js


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

// Jobs store handled by services/jobs.store.js


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

// updateFactoryJob wraps updateJob from jobs.store
async function updateFactoryJob(jobId, patch = {}, logMessage = '') {
  return updateJob(jobId, patch, logMessage);
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

/* ── Affiliate redirect + Click Tracking ── */
app.get('/go/:linkId', affiliateRedirectHandler);

app.get('/api/clicks', async (req, res) => {
  try {
    const stats = await getClickStats(req.query.jobId || null);
    res.json(stats);
  } catch (err) {
    jsonError(res, 500, 'Failed to read click stats', err.message);
  }
});

/* ── Winner Engine ── */

// GET /api/winners — list jobs that crossed the click threshold
app.get('/api/winners', async (req, res) => {
  try {
    const threshold = Number(req.query.threshold) || DEFAULT_WINNER_THRESHOLD;
    const winners = await getWinners(threshold);
    res.json({ threshold, count: winners.length, winners });
  } catch (err) {
    jsonError(res, 500, 'Failed to get winners', err.message);
  }
});

// GET /api/winners/ranking — combined score ranking (clicks + hook score)
app.get('/api/winners/ranking', async (req, res) => {
  try {
    const ranking = await getRanking(Number(req.query.limit) || 20);
    res.json({ count: ranking.length, ranking });
  } catch (err) {
    jsonError(res, 500, 'Failed to get ranking', err.message);
  }
});

// POST /api/winners/:jobId/clone — scale a winner by cloning with alternate hooks
app.post('/api/winners/:jobId/clone', requireApiKey, async (req, res) => {
  const { jobId } = req.params;
  const n = Number(req.body?.variants) || 3;
  try {
    const variants = await cloneWinner(
      jobId,
      n,
      executeFactoryJob,   // runner
      createFactoryJob     // creator
    );
    res.json({
      clonedFrom: jobId,
      variantsQueued: variants.filter(v => v.status === 'queued').length,
      variants
    });
  } catch (err) {
    jsonError(res, 400, 'Clone failed', err.message);
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
