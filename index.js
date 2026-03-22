const express = require('express');
const cors = require('cors');
const axios = require('axios');
const rateLimit = require('express-rate-limit');
const dotenv = require('dotenv');
const fs = require('fs/promises');
const path = require('path');
const { promisify } = require('util');
const { execFile } = require('child_process');

dotenv.config();

const execFileAsync = promisify(execFile);
const app = express();

const PORT = process.env.PORT || 3000;
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';
const FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg';
const ELEVENLABS_VOICE_PRESETS = {
  energetic: 'EXAVITQu4vr4xnSDxMaL',
  calm: '21m00Tcm4TlvDq8ikWAM',
  urgent: 'AZnzlk1XvdvUeBnXmlld',
  friendly: 'MF3mGyEYCl7XYWbV9V6O'
};

const RUNTIME_DIR = path.join(__dirname, 'runtime');
const AUDIO_DIR = path.join(RUNTIME_DIR, 'audio');
const CLIP_DIR = path.join(RUNTIME_DIR, 'clips');
const JOB_DIR = path.join(RUNTIME_DIR, 'jobs');
const RENDER_DIR = path.join(RUNTIME_DIR, 'renders');

app.use(cors());
app.use(express.json({ limit: '2mb' }));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, please try again later.' }
});

app.use('/api/', limiter);
app.use(express.static('public'));
app.use('/runtime', express.static(RUNTIME_DIR));

function uid(prefix = 'job') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function ensureRuntimeDirs() {
  await Promise.all([
    fs.mkdir(RUNTIME_DIR, { recursive: true }),
    fs.mkdir(AUDIO_DIR, { recursive: true }),
    fs.mkdir(CLIP_DIR, { recursive: true }),
    fs.mkdir(JOB_DIR, { recursive: true }),
    fs.mkdir(RENDER_DIR, { recursive: true })
  ]);
}

function jsonError(res, status, error, details) {
  return res.status(status).json({ error, ...(details ? { details } : {}) });
}

function getEnvConfig(key) {
  const value = process.env[key];
  return {
    configured: Boolean(value),
    source: value ? 'render_environment' : 'missing'
  };
}

function mapPexelsVideo(video, keywords = '') {
  return {
    id: video?.id || 0,
    title: keywords,
    thumb: video?.image || null,
    duration: video?.duration || null,
    url: video?.url || null,
    download:
      video?.video_files?.find(file => file.quality === 'hd' && file.width <= 1080)?.link ||
      pickPexelsFile(video?.video_files || [])?.link ||
      video?.url ||
      null,
    pexels_url: video?.url || null
  };
}

function cleanClaudeText(data) {
  return data.content?.map(block => block.text || '').join('').replace(/```json|```/g, '').trim();
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
    {
      scene_id: 1,
      voiceover: `Stop scrolling. Here is the fastest way to make ${topic} impossible to ignore.`,
      on_screen_text: `The ${topic} mistake`,
      search_query: `${topic} problem close up`,
      duration_sec: 6
    },
    {
      scene_id: 2,
      voiceover: `Most people keep doing the obvious thing, but the real fix starts with one hidden detail.`,
      on_screen_text: 'What everyone misses',
      search_query: `${topic} hidden issue`,
      duration_sec: 6
    },
    {
      scene_id: 3,
      voiceover: `This is where ${product} becomes useful, because it removes friction and saves time immediately.`,
      on_screen_text: product,
      search_query: `${product} product demo`,
      duration_sec: 6
    },
    {
      scene_id: 4,
      voiceover: `If you want the exact setup, check the link and copy this workflow for ${platform}.`,
      on_screen_text: 'Link in bio',
      search_query: `${platform} phone scrolling`,
      duration_sec: 6
    }
  ];

  return {
    source: 'fallback',
    title: `${topic} automation hook`,
    hook: scenes[0].voiceover,
    cta: `Use ${product} and test this angle today.`,
    caption: `${topic} -> signal -> video -> clicks -> sales`,
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

async function generateScriptPlan(input) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return fallbackScriptPlan(input);
  }

  const topic = input.topic || 'AI content system';
  const product = input.product || 'affiliate product';
  const platform = input.platform || 'TikTok';
  const durationSec = input.durationSec || 24;
  const scenesCount = input.scenesCount || 4;

  const system = [
    'You generate short-form video plans for a fully automated content pipeline.',
    'Return only valid JSON.',
    'Use concise scene-by-scene voiceover, screen text, and search queries for stock clips.'
  ].join(' ');

  const user = [
    `Topic: ${topic}`,
    `Product: ${product}`,
    `Platform: ${platform}`,
    `Total duration: ${durationSec} seconds`,
    `Scene count: ${scenesCount}`,
    'Schema:',
    '{"title":"string","hook":"string","cta":"string","caption":"string","full_voiceover":"string","scenes":[{"scene_id":1,"voiceover":"string","on_screen_text":"string","search_query":"string","duration_sec":6}]}'
  ].join('\n');

  try {
    const data = await callAnthropic(system, [{ role: 'user', content: user }]);
    const parsed = JSON.parse(cleanClaudeText(data));
    return {
      source: 'anthropic',
      title: parsed.title || `${topic} automation hook`,
      hook: parsed.hook || '',
      cta: parsed.cta || '',
      caption: parsed.caption || '',
      full_voiceover: parsed.full_voiceover || (parsed.scenes || []).map(scene => scene.voiceover).join(' '),
      scenes: Array.isArray(parsed.scenes) && parsed.scenes.length
        ? parsed.scenes
        : splitScenes(parsed.full_voiceover || topic, scenesCount)
    };
  } catch (error) {
    console.warn('Script generation fallback:', error.message);
    return fallbackScriptPlan(input);
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

  if (!process.env.ELEVENLABS_API_KEY) {
    return {
      status: 'not_configured',
      provider: 'elevenlabs',
      request: {
        voiceId,
        text
      }
    };
  }

  const fileName = `${jobId}.mp3`;
  const filePath = path.join(AUDIO_DIR, fileName);
  const response = await axios.post(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      text,
      model_id: 'eleven_multilingual_v2'
    },
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

function buildRenderArgs({ clipAssets, audioFilePath, outputFilePath, scenes }) {
  const clipInputs = clipAssets.flatMap(asset => ['-i', asset.filePath]);
  const audioInput = ['-i', audioFilePath];
  const filters = clipAssets.map((asset, index) => {
    const scene = scenes.find(item => item.scene_id === asset.scene_id) || {};
    const duration = Number(scene.duration_sec || asset.duration_sec || 6);
    return `[${index}:v]trim=duration=${duration},setpts=PTS-STARTPTS,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,format=yuv420p[v${index}]`;
  });

  const concatInputs = clipAssets.map((_, index) => `[v${index}]`).join('');
  const filterComplex = `${filters.join(';')};${concatInputs}concat=n=${clipAssets.length}:v=1:a=0[v]`;

  return [
    ...clipInputs,
    ...audioInput,
    '-filter_complex', filterComplex,
    '-map', '[v]',
    '-map', `${clipAssets.length}:a`,
    '-c:v', 'libx264',
    '-c:a', 'aac',
    '-shortest',
    '-y',
    outputFilePath
  ];
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
  if (!clipAssets.length || !audioFilePath) {
    return {
      status: 'blocked',
      reason: 'Missing local clips or voice asset for rendering.'
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

async function writeJob(job) {
  const filePath = path.join(JOB_DIR, `${job.id}.json`);
  await fs.writeFile(filePath, JSON.stringify(job, null, 2));
  return filePath;
}

async function readJob(jobId) {
  const filePath = path.join(JOB_DIR, `${jobId}.json`);
  const content = await fs.readFile(filePath, 'utf8');
  return JSON.parse(content);
}


function appendJobHistory(job, event, payload = {}) {
  const history = Array.isArray(job.history) ? job.history : [];
  const entry = {
    id: uid('event'),
    event,
    timestamp: new Date().toISOString(),
    payload
  };
  return {
    ...job,
    history: [...history, entry],
    updatedAt: entry.timestamp
  };
}


function getAutomationReadiness(services) {
  const commonMissing = [];
  if (!services.elevenlabs.configured) commonMissing.push('ELEVENLABS_API_KEY');
  if (!services.pexels.configured) commonMissing.push('PEXELS_API_KEY');

  const liveMissing = [...commonMissing];
  if (!services.ffmpeg.configured) liveMissing.push('FFMPEG_PATH');

  return {
    dryRun: {
      ready: commonMissing.length === 0,
      missing: commonMissing,
      summary: commonMissing.length === 0
        ? 'Dry run can build a full asset-backed job.'
        : `Dry run still needs: ${commonMissing.join(', ')}`
    },
    liveRun: {
      ready: liveMissing.length === 0,
      missing: liveMissing,
      summary: liveMissing.length === 0
        ? 'Live render is ready.'
        : `Live render is blocked by: ${liveMissing.join(', ')}`
    },
    notes: [
      services.anthropic.configured ? 'Anthropic is configured.' : 'Anthropic is optional because fallback script generation is enabled.',
      services.buffer.configured || services.youtube.configured
        ? 'Auto publish credentials are partially configured, but manual publish is still supported.'
        : 'Publishing is expected to be manual in the current workflow.',
      services.youtube.configured || services.tiktok.configured
        ? 'Analytics credentials exist, but manual metrics entry remains available.'
        : 'Metrics collection is expected to be manual in the current workflow.'
    ]
  };
}

function getAutomationStatus(ffmpegAvailable) {
  return {
    anthropic: getEnvConfig('ANTHROPIC_API_KEY'),
    elevenlabs: getEnvConfig('ELEVENLABS_API_KEY'),
    pexels: getEnvConfig('PEXELS_API_KEY'),
    buffer: getEnvConfig('BUFFER_ACCESS_TOKEN'),
    youtube: getEnvConfig('YOUTUBE_API_KEY'),
    tiktok: getEnvConfig('TIKTOK_SESSION_ID'),
    ffmpeg: {
      configured: ffmpegAvailable,
      source: ffmpegAvailable ? 'render_environment' : 'missing'
    }
  };
}

app.get('/health', async (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.get('/api/automation/status', async (_req, res) => {
  const ffmpegAvailable = await isFfmpegAvailable();
  const services = getAutomationStatus(ffmpegAvailable);
  res.json({
    status: 'ok',
    services,
    readiness: getAutomationReadiness(services)
  });
});

app.post('/api/automation/tools/voice-preview', async (req, res) => {
  try {
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    const voiceStyle = typeof req.body?.voiceStyle === 'string' ? req.body.voiceStyle.trim() : '';
    const voiceId = ELEVENLABS_VOICE_PRESETS[voiceStyle] || req.body?.voiceId || ELEVENLABS_VOICE_ID;

    if (!text) return jsonError(res, 400, 'Voice text is required.');
    if (!process.env.ELEVENLABS_API_KEY) {
      return jsonError(res, 503, 'ELEVENLABS_API_KEY is not configured in the Render environment.', {
        source: 'render_environment'
      });
    }

    const voiceResult = await generateVoiceAsset({
      jobId: uid('voice_preview'),
      text,
      voiceId
    });

    res.json(voiceResult);
  } catch (error) {
    console.error('voice preview failed', error.message);
    jsonError(res, 500, 'Failed to generate voice preview.', error.message);
  }
});

app.post('/api/automation/tools/visual-search', async (req, res) => {
  try {
    const scenes = Array.isArray(req.body?.scenes) ? req.body.scenes : [];
    if (!scenes.length) return res.json({ status: 'ok', scenes: [] });

    if (!process.env.PEXELS_API_KEY) {
      return jsonError(res, 503, 'PEXELS_API_KEY is not configured in the Render environment.', {
        source: 'render_environment'
      });
    }

    const results = [];
    for (const scene of scenes) {
      const keywords = Array.isArray(scene?.visual_keywords)
        ? scene.visual_keywords.slice(0, 2).join(' ')
        : String(scene?.search_query || '').trim();

      if (!keywords) {
        results.push({
          scene_id: scene?.id || scene?.scene_id || 0,
          label: scene?.label || '',
          keywords: '',
          clips: []
        });
        continue;
      }

      const searchResponse = await axios.get('https://api.pexels.com/videos/search', {
        headers: { Authorization: process.env.PEXELS_API_KEY },
        params: {
          query: keywords,
          per_page: 3,
          orientation: 'portrait'
        },
        timeout: 60000
      });

      results.push({
        scene_id: scene?.id || scene?.scene_id || 0,
        label: scene?.label || '',
        keywords,
        clips: (searchResponse.data.videos || []).map(video => mapPexelsVideo(video, keywords))
      });
    }

    res.json({ status: 'ok', scenes: results });
  } catch (error) {
    console.error('visual search failed', error.message);
    jsonError(res, 500, 'Failed to load Pexels clips.', error.message);
  }
});

app.get('/api/automation/jobs/:jobId', async (req, res) => {
  try {
    const job = await readJob(req.params.jobId);
    res.json(job);
  } catch (error) {
    jsonError(res, 404, 'Job not found', error.message);
  }
});


app.patch('/api/automation/jobs/:jobId/manual-publish', async (req, res) => {
  try {
    const job = await readJob(req.params.jobId);
    const body = req.body || {};
    const manualPublish = {
      status: body.status || 'published_manually',
      platform: body.platform || 'Manual',
      publishedUrl: body.publishedUrl || '',
      notes: body.notes || '',
      publishedAt: body.publishedAt || new Date().toISOString()
    };

    let nextJob = {
      ...job,
      status: manualPublish.status === 'published_manually' ? 'published_manually' : job.status,
      manualPublish
    };
    nextJob = appendJobHistory(nextJob, 'manual_publish_saved', manualPublish);

    await writeJob(nextJob);
    res.json(nextJob);
  } catch (error) {
    jsonError(res, 404, 'Job not found', error.message);
  }
});

app.patch('/api/automation/jobs/:jobId/manual-metrics', async (req, res) => {
  try {
    const job = await readJob(req.params.jobId);
    const body = req.body || {};
    const manualMetrics = {
      views: Number(body.views || 0),
      likes: Number(body.likes || 0),
      comments: Number(body.comments || 0),
      ctr: Number(body.ctr || 0),
      revenue: Number(body.revenue || 0),
      conversions: Number(body.conversions || 0),
      notes: body.notes || '',
      recordedAt: body.recordedAt || new Date().toISOString()
    };

    let nextJob = {
      ...job,
      status: 'metrics_recorded',
      manualMetrics
    };
    nextJob = appendJobHistory(nextJob, 'manual_metrics_saved', manualMetrics);

    await writeJob(nextJob);
    res.json(nextJob);
  } catch (error) {
    jsonError(res, 404, 'Job not found', error.message);
  }
});

app.post('/api/chat', async (req, res) => {
  const { system, messages, model } = req.body;

  if (!process.env.ANTHROPIC_API_KEY) {
    return jsonError(res, 500, 'ANTHROPIC_API_KEY not set on server');
  }

  try {
    const data = await callAnthropic(system, messages, model);
    res.json(data);
  } catch (error) {
    console.error('API Error:', error.response?.data || error.message);
    jsonError(res, error.response?.status || 500, 'AI Call Failed', error.response?.data || error.message);
  }
});

app.post('/api/automation/script', async (req, res) => {
  try {
    const plan = await generateScriptPlan(req.body || {});
    res.json(plan);
  } catch (error) {
    console.error('Script automation error:', error.message);
    jsonError(res, 500, 'Failed to generate script', error.message);
  }
});

app.post('/api/automation/full-video', async (req, res) => {
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

    const createdAt = new Date().toISOString();
    let job = {
      id: jobId,
      createdAt,
      updatedAt: createdAt,
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
      analyticsPlan,
      manualPublish: null,
      manualMetrics: null,
      history: []
    };

    job = appendJobHistory(job, 'job_created', {
      input: job.input,
      status: job.status
    });

    await writeJob(job);
    res.json(job);
  } catch (error) {
    console.error('Full automation error:', error.response?.data || error.message);
    jsonError(res, 500, 'Failed to run full automation', error.response?.data || error.message);
  }
});

ensureRuntimeDirs()
  .then(() => {
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  })
  .catch(error => {
    console.error('Failed to initialize runtime directories:', error);
    process.exit(1);
  });
