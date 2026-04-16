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

// ── FFmpeg helpers ────────────────────────────────────────────────────────────

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
      // White bold uppercase text, centered in upper third
      f += `,drawtext=text='${safeText}'`
        + ':fontsize=96'
        + ':fontcolor=white'
        + ':x=(w-text_w)/2'
        + ':y=(h-text_h)/3'
        + ':box=1'
        + ':boxcolor=black@0.55'
        + ':boxborderw=30'
        + ':shadowcolor=black@0.8'
        + ':shadowx=3'
        + ':shadowy=3';
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
  if (!clipAssets.length) return { status: 'blocked', reason: 'Missing local clips for rendering.' };
  const ffmpegAvailable = await isFfmpegAvailable();
  const outputFileName = `${jobId}.mp4`;
  const outputFilePath = path.join(RENDER_DIR, outputFileName);
  const args = buildRenderArgs({ clipAssets, audioFilePath, outputFilePath, scenes });
  const commandPreview = `${FFMPEG_PATH} ${args.map(shellQuote).join(' ')}`;

  if (!ffmpegAvailable) return { status: 'not_configured', provider: 'ffmpeg', commandPreview, reason: 'FFmpeg is not available on the server.' };
  if (dryRun) return { status: 'planned', provider: 'ffmpeg', commandPreview, outputFilePath };

  await execFileAsync(FFMPEG_PATH, args, { maxBuffer: 1024 * 1024 * 20 });
  return { status: 'completed', provider: 'ffmpeg', commandPreview, filePath: outputFilePath, publicUrl: `/runtime/renders/${outputFileName}` };
}

module.exports = { renderVideoAsset, buildRenderArgs, escapeDrawtext };
