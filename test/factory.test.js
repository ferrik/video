const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');

const {
  startServer,
  ensureRuntimeDirs,
  validateFactoryInput,
  createFactoryJob,
  readJob,
  listJobs
} = require('../index.js');

const JOB_DIR = path.join(__dirname, '..', 'runtime', 'jobs');

async function cleanupFactoryJobs() {
  await ensureRuntimeDirs();
  const files = await fs.readdir(JOB_DIR);
  await Promise.all(
    files
      .filter(file => file.startsWith('factory_') && file.endsWith('.json'))
      .map(file => fs.unlink(path.join(JOB_DIR, file)))
  );
}

async function waitForTerminalJob(baseUrl, jobId, options = {}) {
  const { attempts = 60, delayMs = 200 } = options;
  const terminalStatuses = ['completed', 'requires_follow_up', 'failed', 'cancelled'];
  let job = null;
  for (let i = 0; i < attempts; i += 1) {
    const resp = await fetch(`${baseUrl}/api/factory/jobs/${jobId}`);
    assert.strictEqual(resp.status, 200);
    job = await resp.json();
    if (terminalStatuses.includes(job?.status)) return job;
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }
  return job;
}

test.before(async () => {
  await cleanupFactoryJobs();
});

test('validateFactoryInput accepts a valid factory payload', () => {
  const result = validateFactoryInput({
    topic: 'Pool cleaning Miami',
    product: 'Chlorine tabs',
    market: 'US',
    platforms: ['TikTok', 'TikTok'],
    durationSec: 24,
    advanced: { scenesCount: 4, renderMode: 'dry' }
  });

  assert.strictEqual(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.strictEqual(result.value.topic, 'Pool cleaning Miami');
  assert.strictEqual(result.value.product, 'Chlorine tabs');
  assert.deepEqual(result.value.platforms, ['TikTok']);
  assert.strictEqual(result.value.advanced.renderMode, 'dry');
  assert.strictEqual(result.value.dryRun, true);
});

test('validateFactoryInput rejects invalid payloads with useful errors', () => {
  const result = validateFactoryInput({
    topic: '',
    product: '',
    market: '',
    platforms: [],
    durationSec: 100,
    advanced: { scenesCount: 15, renderMode: 'broken' }
  });

  assert.strictEqual(result.ok, false);
  assert.match(result.errors.join(' '), /Topic is required/);
  assert.match(result.errors.join(' '), /Product is required/);
  assert.match(result.errors.join(' '), /Market is required/);
  assert.match(result.errors.join(' '), /At least one platform is required/);
  assert.match(result.errors.join(' '), /Duration must be between 6 and 90 seconds/);
  assert.match(result.errors.join(' '), /Scenes count must be between 1 and 12/);
  assert.match(result.errors.join(' '), /Render mode must be either "live" or "dry"/);
});

test('validateFactoryInput rejects too many platforms', () => {
  const result = validateFactoryInput({
    topic: 'Pool cleaning Miami',
    product: 'Chlorine tabs',
    market: 'US',
    platforms: ['TikTok', 'Instagram', 'YouTube Shorts', 'Facebook Reels'],
    durationSec: 24,
    advanced: { scenesCount: 4, renderMode: 'dry' }
  });

  assert.strictEqual(result.ok, false);
  assert.match(result.errors.join(' '), /No more than 3 platforms are allowed per run/);
});

test('createFactoryJob persists a queued job that can be read and listed', async () => {
  const job = await createFactoryJob({
    topic: 'Pool cleaning Miami',
    product: 'Chlorine tabs',
    market: 'US',
    platforms: ['TikTok'],
    durationSec: 20,
    advanced: { scenesCount: 4, renderMode: 'dry' }
  });

  const saved = await readJob(job.id);
  const jobs = await listJobs(10);

  assert.strictEqual(saved.id, job.id);
  assert.strictEqual(saved.status, 'queued');
  assert.ok(jobs.some(item => item.id === job.id));
});

test('createFactoryJob stores retry metadata when present', async () => {
  const job = await createFactoryJob({
    topic: 'Pool cleaning Miami',
    product: 'Chlorine tabs',
    market: 'US',
    platforms: ['TikTok'],
    durationSec: 20,
    advanced: { scenesCount: 4, renderMode: 'dry' },
    retryOf: 'factory_original_123',
    retryDepth: 2
  });

  const saved = await readJob(job.id);

  assert.strictEqual(saved.retryOf, 'factory_original_123');
  assert.strictEqual(saved.retryDepth, 2);
});

test('listJobs sorts by updatedAt instead of filename order', async () => {
  const older = await createFactoryJob({
    topic: 'Older but newer update',
    product: 'A',
    market: 'US',
    platforms: ['TikTok'],
    durationSec: 20,
    advanced: { scenesCount: 4, renderMode: 'dry' }
  });
  const newer = await createFactoryJob({
    topic: 'Newer file but older update',
    product: 'B',
    market: 'US',
    platforms: ['TikTok'],
    durationSec: 20,
    advanced: { scenesCount: 4, renderMode: 'dry' }
  });

  const olderPath = path.join(JOB_DIR, `${older.id}.json`);
  const newerPath = path.join(JOB_DIR, `${newer.id}.json`);

  const olderSaved = JSON.parse(await fs.readFile(olderPath, 'utf8'));
  const newerSaved = JSON.parse(await fs.readFile(newerPath, 'utf8'));

  olderSaved.updatedAt = '2099-01-01T00:00:00.000Z';
  newerSaved.updatedAt = '2000-01-01T00:00:00.000Z';

  await fs.writeFile(olderPath, JSON.stringify(olderSaved, null, 2));
  await fs.writeFile(newerPath, JSON.stringify(newerSaved, null, 2));

  const jobs = await listJobs(2);
  assert.strictEqual(jobs[0].id, older.id);
});

test('factory API creates a job and returns it in recent jobs list', async () => {
  const server = await startServer(0);

  try {
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const postResp = await fetch(`${baseUrl}/api/factory/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topic: 'Pool cleaning Miami',
        product: 'Chlorine tabs',
        market: 'US',
        platforms: ['TikTok'],
        durationSec: 20,
        advanced: { scenesCount: 4, renderMode: 'dry' }
      })
    });

    assert.strictEqual(postResp.status, 202);
    const created = await postResp.json();
    assert.ok(created.id);

    const listResp = await fetch(`${baseUrl}/api/factory/jobs?limit=5`);
    assert.strictEqual(listResp.status, 200);
    const payload = await listResp.json();

    assert.ok(Array.isArray(payload.jobs));
    assert.ok(payload.jobs.some(job => job.id === created.id));
  } finally {
    await new Promise((resolve, reject) => {
      server.close(error => (error ? reject(error) : resolve()));
    });
  }
});

test('factory API rejects invalid payloads with 400', async () => {
  const server = await startServer(0);

  try {
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const resp = await fetch(`${baseUrl}/api/factory/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topic: '',
        product: '',
        market: '',
        platforms: []
      })
    });

    assert.strictEqual(resp.status, 400);
    const body = await resp.json();
    assert.strictEqual(body.error, 'Invalid factory payload');
    assert.ok(Array.isArray(body.details));
  } finally {
    await new Promise((resolve, reject) => {
      server.close(error => (error ? reject(error) : resolve()));
    });
  }
});

test('factory API exposes shared meta for steps and statuses', async () => {
  const server = await startServer(0);

  try {
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const resp = await fetch(`${baseUrl}/api/factory/meta`);
    assert.strictEqual(resp.status, 200);
    const body = await resp.json();

    assert.ok(Array.isArray(body.steps));
    assert.ok(body.steps.some(step => step.key === 'signal_generation'));
    assert.strictEqual(body.steps.find(step => step.key === 'signal_generation')?.label, 'Сигнал');
    assert.strictEqual(body.steps.find(step => step.key === 'voice_generation')?.label, 'Озвучка');
    assert.ok(Array.isArray(body.activeStatuses));
    assert.ok(body.activeStatuses.includes('running'));
    assert.ok(Array.isArray(body.terminalStatuses));
    assert.ok(body.terminalStatuses.includes('requires_follow_up'));
    assert.ok(Array.isArray(body.retryableStatuses));
    assert.ok(body.retryableStatuses.includes('failed'));
    assert.strictEqual(body.statusMeta.completed.label, 'Завершено');
    assert.strictEqual(body.statusMeta.requires_follow_up.tone, 'blue');
    assert.strictEqual(body.stepStateMeta.done.tone, 'green');
    assert.strictEqual(body.stepStateMeta.needs_review.label, 'потрібен review');
  } finally {
    await new Promise((resolve, reject) => {
      server.close(error => (error ? reject(error) : resolve()));
    });
  }
});

test('factory API can cancel a queued job', async () => {
  const queued = await createFactoryJob({
    topic: 'Pool cleaning Miami',
    product: 'Chlorine tabs',
    market: 'US',
    platforms: ['TikTok'],
    durationSec: 20,
    advanced: { scenesCount: 4, renderMode: 'dry' }
  });

  const server = await startServer(0);

  try {
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const cancelResp = await fetch(`${baseUrl}/api/factory/jobs/${queued.id}/cancel`, {
      method: 'POST'
    });
    assert.strictEqual(cancelResp.status, 200);
    const cancelled = await cancelResp.json();

    assert.strictEqual(cancelled.id, queued.id);
    assert.strictEqual(cancelled.status, 'cancelled');
    assert.strictEqual(cancelled.step, 'cancelled');
  } finally {
    await new Promise((resolve, reject) => {
      server.close(error => (error ? reject(error) : resolve()));
    });
  }
});

test('factory API retry creates a linked retry job and blocked renders become requires_follow_up', async () => {
  const server = await startServer(0);

  try {
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const createResp = await fetch(`${baseUrl}/api/factory/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topic: 'Pool cleaning Miami',
        product: 'Chlorine tabs',
        market: 'US',
        platforms: ['TikTok'],
        durationSec: 20,
        advanced: { scenesCount: 4, renderMode: 'dry' }
      })
    });
    assert.strictEqual(createResp.status, 202);
    const original = await createResp.json();

    const retryResp = await fetch(`${baseUrl}/api/factory/jobs/${original.id}/retry`, {
      method: 'POST'
    });
    assert.strictEqual(retryResp.status, 202);
    const retryJob = await retryResp.json();

    assert.strictEqual(retryJob.retryOf, original.id);
    assert.strictEqual(retryJob.retryDepth, 1);

    const finalJob = await waitForTerminalJob(baseUrl, retryJob.id);
    assert.ok(finalJob);
    assert.strictEqual(finalJob.retryOf, original.id);
    assert.strictEqual(finalJob.retryDepth, 1);
    assert.strictEqual(finalJob.status, 'requires_follow_up');
  } finally {
    await new Promise((resolve, reject) => {
      server.close(error => (error ? reject(error) : resolve()));
    });
  }
});

test('factory package endpoint returns text export for a known job', async () => {
  const server = await startServer(0);

  try {
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const createResp = await fetch(`${baseUrl}/api/factory/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topic: 'Pool cleaning Miami',
        product: 'Chlorine tabs',
        market: 'US',
        platforms: ['TikTok'],
        durationSec: 20,
        advanced: { scenesCount: 4, renderMode: 'dry' }
      })
    });
    assert.strictEqual(createResp.status, 202);
    const created = await createResp.json();

    const finalJob = await waitForTerminalJob(baseUrl, created.id);

    const packageResp = await fetch(`${baseUrl}/api/factory/jobs/${created.id}/package.txt`);
    assert.strictEqual(packageResp.status, 200);
    const text = await packageResp.text();

    assert.match(text, /CREATOR OS — FACTORY PACKAGE/);
    assert.match(text, new RegExp(created.id));
    assert.match(text, /Topic: Pool cleaning Miami/);
  } finally {
    await new Promise((resolve, reject) => {
      server.close(error => (error ? reject(error) : resolve()));
    });
  }
});

test('factory API refuses to cancel a completed-like job', async () => {
  const server = await startServer(0);

  try {
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const createResp = await fetch(`${baseUrl}/api/factory/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topic: 'Pool cleaning Miami',
        product: 'Chlorine tabs',
        market: 'US',
        platforms: ['TikTok'],
        durationSec: 20,
        advanced: { scenesCount: 4, renderMode: 'dry' }
      })
    });
    assert.strictEqual(createResp.status, 202);
    const created = await createResp.json();

    let finalJob = null;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const statusResp = await fetch(`${baseUrl}/api/factory/jobs/${created.id}`);
      assert.strictEqual(statusResp.status, 200);
      finalJob = await statusResp.json();
      if (['completed', 'requires_follow_up', 'failed', 'cancelled'].includes(finalJob.status)) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    const cancelResp = await fetch(`${baseUrl}/api/factory/jobs/${created.id}/cancel`, {
      method: 'POST'
    });
    assert.strictEqual(cancelResp.status, 409);
    const body = await cancelResp.json();
    assert.strictEqual(body.error, 'Cannot cancel job');
  } finally {
    await new Promise((resolve, reject) => {
      server.close(error => (error ? reject(error) : resolve()));
    });
  }
});

// --- Security / API Key Auth Flow ---
test('API key protection - rejects factory endpoints without X-Api-Key', async () => {
  const OLD_KEY = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = 'test-secret';
  const server = await startServer(0);

  try {
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const res = await fetch(`${baseUrl}/api/factory/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topic: 'Test topic', product: 'Test product',
        market: 'UK', platforms: ['TikTok']
      })
    });
    
    assert.strictEqual(res.status, 401);
    const body = await res.json();
    assert.match(body.error, /Unauthorized/i);
  } finally {
    if (OLD_KEY === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = OLD_KEY;
    await new Promise((resolve, reject) => {
      server.close(error => (error ? reject(error) : resolve()));
    });
  }
});

test('API key protection - accepts factory run with valid X-Api-Key', async () => {
  const OLD_KEY = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = 'test-secret';
  const server = await startServer(0);

  try {
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const res = await fetch(`${baseUrl}/api/factory/run`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'X-Api-Key': 'test-secret'
      },
      body: JSON.stringify({
        topic: 'Test topic', product: 'Test product',
        market: 'UK', platforms: ['TikTok']
      })
    });
    
    assert.ok([200, 202].includes(res.status), `Expected 200 or 202 but got ${res.status}`);
  } finally {
    if (OLD_KEY === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = OLD_KEY;
    await new Promise((resolve, reject) => {
      server.close(error => (error ? reject(error) : resolve()));
    });
  }
});
