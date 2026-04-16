'use strict';

const axios = require('axios');
const fs = require('fs/promises');
const path = require('path');

const RUNTIME_DIR = path.join(__dirname, '..', 'runtime');
const AUDIO_DIR = path.join(RUNTIME_DIR, 'audio');
const CLIP_DIR = path.join(RUNTIME_DIR, 'clips');

const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';

// ── Voice ─────────────────────────────────────────────────────────────────────

async function saveBuffer(buffer, filePath) {
  await fs.writeFile(filePath, buffer);
  return filePath;
}

async function generateVoiceAsset({ jobId, text, voiceId = ELEVENLABS_VOICE_ID }) {
  if (!text) return { status: 'skipped', reason: 'No voice text provided.' };

  const fileName = `${jobId}.mp3`;
  const filePath = path.join(AUDIO_DIR, fileName);
  const openaiVoice = process.env.OPENAI_TTS_VOICE || 'onyx';

  // PRIMARY: OpenAI TTS
  if (process.env.OPENAI_API_KEY) {
    try {
      console.log(`[Factory] 🎙️ OpenAI TTS (${openaiVoice}) → job ${jobId}`);
      const response = await axios.post(
        'https://api.openai.com/v1/audio/speech',
        { model: 'tts-1', input: text, voice: openaiVoice },
        {
          headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
          responseType: 'arraybuffer',
          timeout: 60000
        }
      );
      await saveBuffer(Buffer.from(response.data), filePath);
      return { status: 'completed', provider: 'openai', voice: openaiVoice, filePath, publicUrl: `/runtime/audio/${fileName}` };
    } catch (e) {
      console.error(`[OpenAI TTS Error]: ${(e.response?.data?.toString() || e.message).substring(0, 150)}`);
    }
  }

  // FALLBACK: ElevenLabs
  if (process.env.ELEVENLABS_API_KEY) {
    try {
      console.log(`[Factory] 🔄 ElevenLabs fallback → job ${jobId}`);
      const response = await axios.post(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
        { text, model_id: 'eleven_multilingual_v2' },
        {
          headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, Accept: 'audio/mpeg', 'Content-Type': 'application/json' },
          responseType: 'arraybuffer',
          timeout: 120000
        }
      );
      await saveBuffer(Buffer.from(response.data), filePath);
      return { status: 'completed', provider: 'elevenlabs', filePath, publicUrl: `/runtime/audio/${fileName}` };
    } catch (error) {
      console.error(`[ElevenLabs API Error]: ${(error.response?.data?.toString() || error.message).substring(0, 150)}`);
    }
  }

  return { status: 'fallback_error', provider: 'none', error: 'All TTS providers failed or are missing API keys.', filePath: null, publicUrl: null };
}

// ── Clips ─────────────────────────────────────────────────────────────────────

function pickPexelsFile(videoFiles = []) {
  const portrait = videoFiles.filter(f => f.height >= f.width).sort((a, b) => a.width - b.width);
  return portrait[0] || videoFiles[0] || null;
}

async function downloadBinary(url, filePath, headers = {}) {
  const response = await axios.get(url, { headers, responseType: 'arraybuffer', timeout: 120000 });
  await saveBuffer(Buffer.from(response.data), filePath);
  return filePath;
}

async function generateClipAssets({ jobId, scenes = [] }) {
  if (!scenes.length) return { status: 'skipped', assets: [] };
  if (!process.env.PEXELS_API_KEY) {
    return {
      status: 'not_configured', provider: 'pexels',
      assets: scenes.map(s => ({ scene_id: s.scene_id, query: s.search_query }))
    };
  }

  const assets = [];
  for (const scene of scenes) {
    const searchResponse = await axios.get('https://api.pexels.com/videos/search', {
      headers: { Authorization: process.env.PEXELS_API_KEY },
      params: { query: scene.search_query, per_page: 1, orientation: 'portrait' },
      timeout: 60000
    });
    const video = searchResponse.data.videos?.[0];
    const file = pickPexelsFile(video?.video_files || []);
    if (!file?.link) {
      assets.push({ scene_id: scene.scene_id, status: 'missing', query: scene.search_query });
      continue;
    }
    const fileName = `${jobId}_scene_${scene.scene_id}.mp4`;
    const filePath = path.join(CLIP_DIR, fileName);
    await downloadBinary(file.link, filePath);
    assets.push({ scene_id: scene.scene_id, status: 'completed', query: scene.search_query, filePath, publicUrl: `/runtime/clips/${fileName}`, duration_sec: scene.duration_sec });
  }

  return {
    status: assets.every(a => a.status === 'completed') ? 'completed' : 'partial',
    provider: 'pexels',
    assets
  };
}

module.exports = { generateVoiceAsset, generateClipAssets };
