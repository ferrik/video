'use strict';

/**
 * monetization.js
 *
 * Handles affiliate link generation (ASIN-based deep links + TinyURL shortening)
 * AND click tracking — logging every redirect with jobId + timestamp.
 *
 * Routes consumed by index.js:
 *   GET /go/:linkId   → redirect to affiliate URL, record click
 */

const axios = require('axios');
const fs = require('fs/promises');
const path = require('path');

const RUNTIME_DIR = path.join(__dirname, '..', 'runtime');
const CLICKS_FILE = path.join(RUNTIME_DIR, 'clicks.json');

// ── ASIN Map ──────────────────────────────────────────────────────────────────
// Key = lowercase product name fragment, Value = Amazon ASIN
const PRODUCT_ASIN_MAP = {
  'ring video doorbell 4': 'B08N5WRWNW',
  'ring doorbell':         'B08N5WRWNW',
  'sunpower solar panel':  'B01N2WG4UE',
  'solar panel':           'B01N2WG4UE',
  'destructive chewer dog toy': 'B007R1BN56',
  'dog toy':               'B007R1BN56',
  'lawn fertilizer':       'B00X797T5W',
  'ring indoor cam':       'B07Q9VBYVA',
  'robot vacuum':          'B08B3FTTM8',
  'air purifier':          'B08FGH34W5'
};

// ── Click Store (file-based) ───────────────────────────────────────────────────

async function readClicks() {
  try {
    const raw = await fs.readFile(CLICKS_FILE, 'utf8');
    return JSON.parse(raw);
  } catch { return []; }
}

async function recordClick({ linkId, jobId, product, url }) {
  const clicks = await readClicks();
  clicks.push({ linkId, jobId, product, url, clickedAt: new Date().toISOString() });
  // Keep only last 5000 clicks to prevent unbounded growth
  const trimmed = clicks.slice(-5000);
  await fs.mkdir(RUNTIME_DIR, { recursive: true });
  await fs.writeFile(CLICKS_FILE, JSON.stringify(trimmed, null, 2));
}

async function getClickStats(jobId = null) {
  const clicks = await readClicks();
  const relevant = jobId ? clicks.filter(c => c.jobId === jobId) : clicks;
  return {
    total: relevant.length,
    byProduct: relevant.reduce((acc, c) => {
      acc[c.product] = (acc[c.product] || 0) + 1;
      return acc;
    }, {}),
    recent: relevant.slice(-20).reverse()
  };
}

// ── Link Generation ────────────────────────────────────────────────────────────

function buildAmazonUrl(product) {
  const normalized = (product || '').toLowerCase().trim();
  const amazonTag = process.env.AMAZON_AFFILIATE_TAG || 'YOUR_TAG';

  // Try direct ASIN (High Conversion)
  const matchedKey = Object.keys(PRODUCT_ASIN_MAP).find(k => normalized.includes(k));
  if (matchedKey) {
    const asin = PRODUCT_ASIN_MAP[matchedKey];
    return `https://www.amazon.co.uk/dp/${asin}/?tag=${amazonTag}`;
  }

  // Fallback: search link (Medium Conversion)
  const query = encodeURIComponent(product);
  return `https://www.amazon.co.uk/s?k=${query}&tag=${amazonTag}&ref=nb_sb_noss`;
}

async function shortenUrl(longUrl) {
  try {
    const res = await axios.get(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(longUrl)}`, { timeout: 5000 });
    return res.data;
  } catch (err) {
    console.warn('TinyURL failed, using long URL:', err.message);
    return longUrl;
  }
}

/**
 * Generate a trackable affiliate link.
 * Returns a short URL that first hits /go/:linkId on our server, logs the click,
 * then redirects to Amazon.
 *
 * @param {string} product - product name
 * @param {string} jobId   - factory job id for attribution
 * @param {string} baseUrl - public server base (e.g. https://creator-os-backend-3uor.onrender.com)
 */
async function generateAffiliateLink(product, jobId = null, baseUrl = '') {
  const longUrl = buildAmazonUrl(product);
  const linkId = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

  // Store linkId → destination mapping so the redirect route can retrieve it
  const clicksData = await readClicks();
  // Save a "pending" entry with linkId so redirect works even before first click
  const linksFile = path.join(RUNTIME_DIR, 'links.json');
  let linksMap = {};
  try { linksMap = JSON.parse(await fs.readFile(linksFile, 'utf8')); } catch { /* ok */ }
  linksMap[linkId] = { product, jobId, url: longUrl, createdAt: new Date().toISOString() };
  await fs.mkdir(RUNTIME_DIR, { recursive: true });
  await fs.writeFile(linksFile, JSON.stringify(linksMap, null, 2));

  if (baseUrl) {
    // Tracked link: server redirects + records click
    return `${baseUrl}/go/${linkId}`;
  }

  // No base URL configured → fall back to TinyURL without tracking
  return shortenUrl(longUrl);
}

/**
 * Express route handler for tracked affiliate redirect.
 * Mount as: app.get('/go/:linkId', affiliateRedirectHandler)
 */
async function affiliateRedirectHandler(req, res) {
  const { linkId } = req.params;
  const linksFile = path.join(RUNTIME_DIR, 'links.json');
  try {
    const linksMap = JSON.parse(await fs.readFile(linksFile, 'utf8'));
    const entry = linksMap[linkId];
    if (!entry) return res.status(404).send('Link not found');
    await recordClick({ linkId, jobId: entry.jobId, product: entry.product, url: entry.url });
    return res.redirect(302, entry.url);
  } catch (err) {
    console.error('[affiliateRedirect] error:', err.message);
    return res.redirect(302, 'https://www.amazon.co.uk');
  }
}

module.exports = {
  generateAffiliateLink,
  affiliateRedirectHandler,
  getClickStats,
  buildAmazonUrl,
  PRODUCT_ASIN_MAP
};
