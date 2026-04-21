'use strict';

const axios = require('axios');
const fs = require('fs/promises');
const path = require('path');
const { getSupabaseClient } = require('./supabase.client');

const RUNTIME_DIR = path.join(__dirname, '..', 'runtime');
const JOB_DIR = path.join(RUNTIME_DIR, 'jobs');

// ── Supabase (optional) ───────────────────────────────────────────────────────


async function syncJobToSupabase(job) {
  const sb = getSupabaseClient();
  if (!sb) return { status: 'not_configured' };
  try {
    const payload = {
      id: job.id,
      data: job,
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
  const sb = getSupabaseClient();
  if (!sb) return null;
  try {
    const { data, error } = await sb.from('factory_jobs').select('data').eq('id', jobId).maybeSingle();
    if (error) throw error;
    return data?.data || null;
  } catch (error) {
    console.warn('Supabase job read skipped:', error.message);
    return null;
  }
}

async function listJobsFromSupabase(limit = 20) {
  const sb = getSupabaseClient();
  if (!sb) return [];
  try {
    const { data, error } = await sb.from('factory_jobs').select('data, updated_at').order('updated_at', { ascending: false }).limit(limit);
    if (error) throw error;
    return (data || []).map(row => row.data).filter(Boolean);
  } catch (error) {
    console.warn('Supabase job list skipped:', error.message);
    return [];
  }
}

// ── File-based storage (primary) ──────────────────────────────────────────────

async function writeJob(job) {
  const filePath = path.join(JOB_DIR, `${job.id}.json`);
  const tempPath = `${filePath}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(job, null, 2));
  await fs.rename(tempPath, filePath);
  await syncJobToSupabase(job);
  return filePath;
}

async function readJob(jobId) {
  const remote = await readJobFromSupabase(jobId);
  if (remote) return remote;
  const filePath = path.join(JOB_DIR, `${jobId}.json`);
  const content = await fs.readFile(filePath, 'utf8');
  return JSON.parse(content);
}

async function listLocalJobs(limit = 20) {
  try {
    const files = await fs.readdir(JOB_DIR);
    const jobFiles = files.filter(f => f.endsWith('.json'));
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
}

async function listJobs(limit = 20) {
  const [remoteJobs, localJobs] = await Promise.all([
    listJobsFromSupabase(limit).catch(() => []),
    listLocalJobs(limit)
  ]);

  const merged = new Map();
  [...remoteJobs, ...localJobs].forEach(job => {
    if (!job?.id) return;
    const existing = merged.get(job.id);
    const currentTs = new Date(job.updatedAt || job.createdAt || 0);
    if (!existing || currentTs > new Date(existing.updatedAt || existing.createdAt || 0)) {
      merged.set(job.id, job);
    }
  });

  return Array.from(merged.values())
    .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0))
    .slice(0, limit);
}

async function updateJob(jobId, patch = {}, logMessage = '') {
  const current = await readJob(jobId);
  const nextLog = logMessage
    ? [...(current.log || []), { at: new Date().toISOString(), message: logMessage }]
    : (current.log || []);
  const next = { ...current, ...patch, updatedAt: new Date().toISOString(), log: nextLog };
  await writeJob(next);
  return next;
}

module.exports = { writeJob, readJob, listJobs, updateJob };
