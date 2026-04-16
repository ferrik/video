'use strict';

/**
 * winner.engine.js
 *
 * The feedback loop that turns "viral guesses" into "business decisions."
 *
 * Flow:
 *   1. Scan click data to find jobs above the click threshold → "winners"
 *   2. For each winner, extract its hooks_pool (alternative hooks from AI)
 *   3. Generate N clone jobs — each using a different hook variant
 *   4. These clone jobs run through the full factory pipeline automatically
 *
 * Exposed functions for index.js routes:
 *   getWinners(threshold)         → list of winning jobs with click stats
 *   cloneWinner(jobId, n, runner) → spawn N variant factory jobs
 */

const { getClickStats } = require('./monetization');
const { readJob, listJobs } = require('./jobs.store');

// Внутрішня функція для читання кліків напряму (без HTTP-агрегації)
async function readClicksRaw() {
  const fs = require('fs/promises');
  const path = require('path');
  const CLICKS_FILE = path.join(__dirname, '..', 'runtime', 'clicks.json');
  try {
    const raw = await fs.readFile(CLICKS_FILE, 'utf8');
    return JSON.parse(raw);
  } catch { return []; }
}

// Default click threshold to be considered a "winner"
const DEFAULT_WINNER_THRESHOLD = Number(process.env.WINNER_CLICK_THRESHOLD || 5);

// ── Identify Winners ────────────────────────────────────────────────────────────

/**
 * Returns jobs that have >= threshold clicks, sorted by clicks descending.
 * @param {number} threshold
 * @returns {Promise<Array>}
 */
async function getWinners(threshold = DEFAULT_WINNER_THRESHOLD) {
  const [clicks, jobs] = await Promise.all([
    readClicksRaw(),
    listJobs(100)
  ]);

  // Count clicks per jobId
  const clicksByJob = clicks.reduce((acc, c) => {
    if (!c.jobId) return acc;
    acc[c.jobId] = (acc[c.jobId] || 0) + 1;
    return acc;
  }, {});

  // Find jobs that passed the threshold
  const winners = jobs
    .filter(job => (clicksByJob[job.id] || 0) >= threshold)
    .map(job => ({
      jobId: job.id,
      topic: job.input?.topic || '',
      product: job.input?.product || '',
      clicks: clicksByJob[job.id] || 0,
      hookScore: job.resultPackage?.hook_score || 0,
      hooksPool: job.resultPackage?.hooks_pool || [],
      videoUrl: job.resultPackage?.videoUrl || null,
      status: job.status,
      createdAt: job.createdAt
    }))
    .sort((a, b) => b.clicks - a.clicks);

  return winners;
}

// ── Clone Winner ────────────────────────────────────────────────────────────────

/**
 * Creates N variant jobs from a winning jobId.
 * Each variant uses a different hook from hooks_pool.
 * The actual factory execution is delegated to executeFactoryJob (passed as runner).
 *
 * @param {string}   jobId    - source job to clone from
 * @param {number}   n        - number of variants to generate (default 3)
 * @param {Function} runner   - async function(jobId, input) that runs the factory pipeline
 * @param {Function} creator  - async function(input) that creates and persists a new job
 * @returns {Promise<Array>}  - array of created variant jobs
 */
async function cloneWinner(jobId, n = 3, runner, creator) {
  const source = await readJob(jobId);
  if (!source) throw new Error(`Source job ${jobId} not found`);

  const hooksPool = source.resultPackage?.hooks_pool || [];
  const baseInput = source.input || {};
  const baseScriptPlan = source.resultPackage || {};

  if (!hooksPool.length) {
    throw new Error(`Job ${jobId} has no hooks_pool — cannot generate variants`);
  }

  console.log(`[WinnerEngine] Cloning winner ${jobId} → ${n} variants using ${hooksPool.length} hooks`);

  const variantJobs = [];
  const targetCount = Math.min(n, hooksPool.length);

  for (let i = 0; i < targetCount; i++) {
    const hookOverride = hooksPool[i];
    
    // Build variant input — force the specific hook via scriptPlan override
    const variantInput = {
      ...baseInput,
      // Override topic to signal which hook variant this is
      topic: baseInput.topic,
      product: baseInput.product,
      market: Array.isArray(baseInput.market) ? baseInput.market[0] : (baseInput.market || 'US'),
      platforms: baseInput.platform || baseInput.platforms || ['TikTok'],
      durationSec: baseInput.durationSec || 24,
      // Pre-supply scriptPlan with the alternative hook so AI is bypassed for this step
      scriptPlan: {
        ...baseScriptPlan,
        source: `winner_variant_${i + 1}`,
        title: hookOverride,
        viral_structure: {
          ...(baseScriptPlan.viral_structure || {}),
          hook: hookOverride
        },
        // Patch scene 1 voiceover to be the selected hook
        scenes: (baseScriptPlan.scenes || []).map((scene, idx) =>
          idx === 0 ? { ...scene, voiceover: hookOverride, on_screen_text: hookOverride.slice(0, 40).toUpperCase() } : scene
        ),
        // Tag the variant in hooks_pool so we can identify it
        hooks_pool: [`[VARIANT ${i + 1}] ${hookOverride}`],
        hook_score: baseScriptPlan.hook_score || 0
      },
      // Metadata for traceability
      clonedFrom: jobId,
      variantIndex: i + 1,
      variantHook: hookOverride
    };

    try {
      const variantJob = await creator(variantInput);
      // Fire and forget — track errors but don't block
      runner(variantJob.id, variantInput).catch(err =>
        console.error(`[WinnerEngine] Variant ${i + 1} failed [${variantJob.id}]:`, err.message)
      );
      variantJobs.push({
        id: variantJob.id,
        variantIndex: i + 1,
        hook: hookOverride,
        status: 'queued'
      });
      console.log(`[WinnerEngine] ✅ Variant ${i + 1} queued: ${variantJob.id} — hook: "${hookOverride.slice(0, 60)}"`);
    } catch (err) {
      console.error(`[WinnerEngine] ❌ Variant ${i + 1} creation failed:`, err.message);
      variantJobs.push({
        variantIndex: i + 1,
        hook: hookOverride,
        status: 'error',
        error: err.message
      });
    }
  }

  return variantJobs;
}

// ── Scoring Helpers ────────────────────────────────────────────────────────────

/**
 * Returns a ranking of jobs by combined score: clicks + hook_score normalized.
 * Useful for surfacing the best-performing content overall.
 */
async function getRanking(limit = 20) {
  const [clicks, jobs] = await Promise.all([
    readClicksRaw(),
    listJobs(100)
  ]);

  const clicksByJob = clicks.reduce((acc, c) => {
    if (!c.jobId) return acc;
    acc[c.jobId] = (acc[c.jobId] || 0) + 1;
    return acc;
  }, {});

  return jobs
    .filter(job => job.resultPackage)
    .map(job => {
      const clickCount = clicksByJob[job.id] || 0;
      const hookScore = job.resultPackage?.hook_score || 0;
      // Combined score: clicks are worth 10x because they're real data
      const combinedScore = (clickCount * 10) + hookScore;
      return {
        jobId: job.id,
        topic: job.input?.topic || '',
        product: job.input?.product || '',
        clicks: clickCount,
        hookScore,
        combinedScore,
        isWinner: clickCount >= DEFAULT_WINNER_THRESHOLD,
        videoUrl: job.resultPackage?.videoUrl || null
      };
    })
    .sort((a, b) => b.combinedScore - a.combinedScore)
    .slice(0, limit);
}

module.exports = { getWinners, cloneWinner, getRanking, DEFAULT_WINNER_THRESHOLD };
