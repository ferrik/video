'use strict';

const fs = require('fs/promises');
const path = require('path');

const RUNTIME_DIR = path.join(__dirname, '..', 'runtime');
const AUDIO_DIR = path.join(RUNTIME_DIR, 'audio');
const CLIP_DIR = path.join(RUNTIME_DIR, 'clips');
const RENDER_DIR = path.join(RUNTIME_DIR, 'renders');
const QUEUE_FILE = path.join(RUNTIME_DIR, 'queue', 'queue.json');
const CLICKS_FILE = path.join(RUNTIME_DIR, 'clicks.json');
const LINKS_FILE = path.join(RUNTIME_DIR, 'links.json');

const DEFAULT_RETENTION_DAYS = 7;
const DEFAULT_MAX_ARTIFACT_FILES = 250;
const DEFAULT_MAX_CLICKS = 5000;
const DEFAULT_MAX_LINKS = 2000;
const DEFAULT_MAX_QUEUE = 50;

function retentionMs() {
  const days = Number(process.env.RUNTIME_ARTIFACT_TTL_DAYS ?? DEFAULT_RETENTION_DAYS);
  return Math.max(0, days) * 24 * 60 * 60 * 1000;
}

function maxArtifacts() {
  return Math.max(0, Number(process.env.RUNTIME_MAX_ARTIFACTS_PER_DIR ?? DEFAULT_MAX_ARTIFACT_FILES));
}

function maxEntries(key, def) {
  const value = Number(process.env[key]);
  if (Number.isFinite(value) && value > 0) return value;
  return def;
}

async function cleanupDirectory(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
  const entries = await fs.readdir(dirPath);
  if (!entries.length) return;

  const now = Date.now();
  const ttl = retentionMs();
  const stats = await Promise.all(entries.map(async (file) => {
    const filePath = path.join(dirPath, file);
    try {
      const stat = await fs.stat(filePath);
      if (stat.isDirectory()) return null;
      return { filePath, mtime: stat.mtimeMs };
    } catch {
      return null;
    }
  }));

  const valid = stats.filter(Boolean);
  const toDelete = [];
  if (ttl > 0) {
    for (const info of valid) {
      if (now - info.mtime > ttl) toDelete.push(info);
    }
  }

  const maxFiles = maxArtifacts();
  if (maxFiles > 0) {
    const remaining = valid.filter(info => !toDelete.includes(info));
    if (remaining.length > maxFiles) {
      remaining.sort((a, b) => a.mtime - b.mtime);
      toDelete.push(...remaining.slice(0, remaining.length - maxFiles));
    }
  }

  await Promise.all(toDelete.map(info => fs.unlink(info.filePath).catch(() => null)));
}

async function pruneJsonArray(filePath, maxEntries) {
  if (maxEntries <= 0) return;
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const data = JSON.parse(raw);
    if (!Array.isArray(data) || data.length <= maxEntries) return;
    const trimmed = data.slice(-maxEntries);
    await fs.writeFile(filePath, JSON.stringify(trimmed, null, 2));
  } catch {
    // ignore missing files or parse errors
  }
}

async function pruneJsonMap(filePath, maxEntries) {
  if (maxEntries <= 0) return;
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return;
    const entries = Object.entries(data);
    if (entries.length <= maxEntries) return;
    entries.sort((a, b) => {
      const aTime = new Date(a[1]?.createdAt).getTime() || 0;
      const bTime = new Date(b[1]?.createdAt).getTime() || 0;
      return bTime - aTime;
    });
    const trimmed = entries.slice(0, maxEntries).reduce((acc, [key, value]) => {
      acc[key] = value;
      return acc;
    }, {});
    await fs.writeFile(filePath, JSON.stringify(trimmed, null, 2));
  } catch {
    // ignore
  }
}

async function cleanupArtifacts() {
  try {
    await Promise.all([
      cleanupDirectory(AUDIO_DIR),
      cleanupDirectory(CLIP_DIR),
      cleanupDirectory(RENDER_DIR)
    ]);
  } catch (error) {
    console.warn('[RuntimeMaintenance] Artifact cleanup failed:', error.message);
  }
}

async function pruneLogs() {
  await Promise.all([
    pruneJsonArray(CLICKS_FILE, maxEntries('MAX_CLICK_ENTRIES', DEFAULT_MAX_CLICKS)),
    pruneJsonMap(LINKS_FILE, maxEntries('MAX_LINK_ENTRIES', DEFAULT_MAX_LINKS)),
    pruneJsonArray(QUEUE_FILE, maxEntries('MAX_QUEUE_ENTRIES', DEFAULT_MAX_QUEUE))
  ]);
}

async function runMaintenanceTasks() {
  await cleanupArtifacts();
  await pruneLogs();
}

module.exports = { runMaintenanceTasks };
