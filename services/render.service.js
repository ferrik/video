'use strict';

const fs = require('fs/promises');
const path = require('path');
const { promisify } = require('util');
const { execFile } = require('child_process');

const execFileAsync = promisify(execFile);
const RUNTIME_DIR = path.join(__dirname, '..', 'runtime');
const RENDER_DIR = path.join(RUNTIME_DIR, 'renders');

let FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg';
try {
  const ffmpeg = require('@ffmpeg-installer/ffmpeg');
  if (ffmpeg && ffmpeg.path) FFMPEG_PATH = ffmpeg.path;
} catch (e) {
  console.log('render.service: using system ffmpeg or FFMPEG_PATH env var.');
}

// ── FFmpeg helpers ─────────────────────────────────────────────────────────────

function shellQuote(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function escapeDrawtext(text) {
  return String(text || '')
    .toUpperCase()
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\\\'")
    .replace(/:/g, '\\\\:')
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, 80);
}

function buildRenderArgs({ clipAssets, audioFilePath, outputFilePath, scenes }) {
  const clipInputs = clipAssets.flatMap(asset => ['-i', asset.filePath]);
  const hasAudio = Boolean(audioFilePath);
  const audioInput = hasAudio ? ['-i', audioFilePath] : [];

  const filters = clipAssets.map((asset, index) => {
    const scene = scenes.find(item => item.scene_id === asset.scene_id) || {};
    const duration = Number(scene.duration_sec || asset.duration_sec || 6);
    let f = `[${index}:v]trim=duration=${duration},setpts=PTS-STARTPTS,scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,format=yuv420p`;
    const rawText = scene.on_screen_text || '';
    if (rawText) {
      const safeText = escapeDrawtext(rawText);
      f += `,drawtext=text='${safeText}'`
        + ':fontsize=52'
        + ':fontcolor=white'
        + ':x=(w-text_w)/2'
        + ':y=h/4-(text_h/2)'
        + ':box=1'
        + ':boxcolor=black@0.55'
        + ':boxborderw=12'
        + ':shadowcolor=black@0.8'
        + ':shadowx=2'
        + ':shadowy=2';
    }
    f += `[v${index}]`;
    return f;
  });

  const concatInputs = clipAssets.map((_, i) => `[v${i}]`).join('');
  const filterComplex = `${filters.join(';')};${concatInputs}concat=n=${clipAssets.length}:v=1:a=0[v]`;

  const args = [
    ...clipInputs, ...audioInput,
    '-filter_complex', filterComplex,
    '-map', '[v]',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28', '-threads', '1', '-y'
  ];

  if (hasAudio) {
    args.push('-map', `${clipAssets.length}:a`, '-c:a', 'aac', '-shortest');
  } else {
    args.push('-an');
  }
  args.push(outputFilePath);
  return args;
}

async function isFfmpegAvailable() {
  try {
    await execFileAsync(FFMPEG_PATH, ['-version']);
    return true;
  } catch { return false; }
}

async function renderVideoAsset({ jobId, clipAssets = [], audioFilePath, scenes = [], dryRun = false }) {
  const outputFileName = `${jobId}.mp4`;
  const outputFilePath = path.join(RENDER_DIR, outputFileName);

  // 1. Check FFmpeg availability
  const ffmpegAvailable = await isFfmpegAvailable();
  if (!ffmpegAvailable) {
    return { status: 'not_configured', provider: 'ffmpeg', reason: 'FFmpeg is not available on the server.' };
  }

  // 2. Filter clips to only files that physically exist on disk
  const validClips = [];
  for (const asset of clipAssets) {
    if (!asset.filePath) continue;
    try { await fs.access(asset.filePath); validClips.push(asset); }
    catch { console.warn(`[render] Clip missing, skipping: ${asset.filePath}`); }
  }
  if (!validClips.length) {
    return { status: 'blocked', reason: 'No valid local clips found. Check Pexels API key and clip download.' };
  }

  // 3. Validate audio file exists (skip silently if missing — render mute)
  let resolvedAudioPath = null;
  if (audioFilePath) {
    try { await fs.access(audioFilePath); resolvedAudioPath = audioFilePath; }
    catch { console.warn(`[render] Audio file missing, rendering without audio: ${audioFilePath}`); }
  }

  // 4. Build FFmpeg args with validated assets
  const args = buildRenderArgs({
    clipAssets: validClips,
    audioFilePath: resolvedAudioPath,
    outputFilePath,
    scenes
  });
  const commandPreview = `${FFMPEG_PATH} ${args.map(shellQuote).join(' ')}`;

  if (dryRun) return { status: 'planned', provider: 'ffmpeg', commandPreview, outputFilePath };

  // 5. Run FFmpeg — degrade gracefully on failure instead of crashing the job
  try {
    await fs.mkdir(RENDER_DIR, { recursive: true });
    await execFileAsync(FFMPEG_PATH, args, {
      maxBuffer: 1024 * 1024 * 50,  // 50 MB
      timeout: 120000               // 2 min hard limit
    });
    return {
      status: 'completed',
      provider: 'ffmpeg',
      commandPreview,
      filePath: outputFilePath,
      publicUrl: `/runtime/renders/${outputFileName}`,
      clipsUsed: validClips.length,
      hasAudio: Boolean(resolvedAudioPath)
    };
  } catch (err) {
    const detail = (err.stderr || err.stdout || err.message || '').slice(0, 400);
    console.error(`[render] FFmpeg failed [${jobId}]:`, detail);
    return {
      status: 'requires_follow_up',
      provider: 'ffmpeg',
      commandPreview,
      reason: 'FFmpeg render failed — likely invalid clip format or codec issue.',
      ffmpegError: detail
    };
  }
}

module.exports = { renderVideoAsset, buildRenderArgs, escapeDrawtext, isFfmpegAvailable };
