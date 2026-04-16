'use strict';

const axios = require('axios');
const fs = require('fs/promises');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const RUNTIME_DIR = path.join(__dirname, '..', 'runtime');
const JOB_DIR = path.join(RUNTIME_DIR, 'jobs');

// ── Supabase (optional) ───────────────────────────────────────────────────────

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
  supabaseServerClient = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
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
  const sb = getSupabaseServerClient();
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
  const sb = getSupabaseServerClient();
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
    } catch { return []; }
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
