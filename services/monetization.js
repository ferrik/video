'use strict';

/**
 * monetization.js
 *
 * Affiliate link generation with:
 *  - Market-aware Amazon storefront routing (US/UK/AU/CA)
 *  - ASIN deep links (official format: /dp/ASIN/ref=nosim?tag=TAG)
 *  - Tracked /go/:linkId redirect + click logging
 *
 * Required env vars:
 *   AMAZON_AFFILIATE_TAG   — your real Associates ID (e.g. "mysite-21")
 *   PUBLIC_BASE_URL        — server origin for tracked links (optional)
 */

const axios = require('axios');
const fs = require('fs/promises');
const path = require('path');

const RUNTIME_DIR = path.join(__dirname, '..', 'runtime');
const CLICKS_FILE = path.join(RUNTIME_DIR, 'clicks.json');

// ── Market → Amazon Storefront ─────────────────────────────────────────────────
// Maps market codes to the correct Amazon domain + Associates tag env var.
// Each market needs its own Associates account per Amazon policy.
const MARKET_CONFIG = {
  UK:     { domain: 'www.amazon.co.uk',  tagEnv: 'AMAZON_TAG_UK' },
  US:     { domain: 'www.amazon.com',    tagEnv: 'AMAZON_TAG_US' },
  AU:     { domain: 'www.amazon.com.au', tagEnv: 'AMAZON_TAG_AU' },
  CA:     { domain: 'www.amazon.ca',     tagEnv: 'AMAZON_TAG_CA' },
  Global: { domain: 'www.amazon.co.uk',  tagEnv: 'AMAZON_TAG_UK' } // default fallback
};

function getMarketConfig(market = 'UK') {
  const key = String(market).toUpperCase();
  return MARKET_CONFIG[key] || MARKET_CONFIG['UK'];
}

function getAffiliateTag(market) {
  const { tagEnv } = getMarketConfig(market);
  // Per-market tag first, then shared fallback, then placeholder
  return process.env[tagEnv]
    || process.env.AMAZON_AFFILIATE_TAG
    || null; // null = not configured
}

// ── ASIN Map ───────────────────────────────────────────────────────────────────
// Key = lowercase product name fragment  →  Value = Amazon ASIN
// ASINs are shared across storefronts for most products.
const PRODUCT_ASIN_MAP = {
  'ring video doorbell 4': 'B08N5WRWNW',
  'ring doorbell':         'B08N5WRWNW',
  'ring indoor cam':       'B07Q9VBYVA',
  'sunpower solar panel':  'B01N2WG4UE',
  'solar panel':           'B01N2WG4UE',
  'destructive chewer dog toy': 'B007R1BN56',
  'dog toy':               'B007R1BN56',
  'lawn fertilizer':       'B00X797T5W',
  'robot vacuum':          'B08B3FTTM8',
  'air purifier':          'B08FGH34W5'
};

// ── URL Builder ────────────────────────────────────────────────────────────────

/**
 * Build the correct Amazon affiliate URL.
 * Official deep link format (Amazon Associates docs):
 *   https://{domain}/dp/{ASIN}/ref=nosim?tag={tag}
 *
 * Falls back to search link only if no ASIN found — but logs a warning.
 */
function buildAmazonUrl(product, market = 'UK') {
  const { domain } = getMarketConfig(market);
  const tag = getAffiliateTag(market);

  if (!tag) {
    console.warn(`[Monetization] ⚠️  No affiliate tag for market "${market}". Set AMAZON_TAG_${market.toUpperCase()} or AMAZON_AFFILIATE_TAG in env.`);
  }

  const tagParam = tag ? `?tag=${tag}` : '';
  const normalized = (product || '').toLowerCase().trim();

  // Try exact or partial ASIN match → deep link (highest conversion)
  const matchedKey = Object.keys(PRODUCT_ASIN_MAP).find(k => normalized.includes(k));
  if (matchedKey) {
    const asin = PRODUCT_ASIN_MAP[matchedKey];
    // Official Amazon Associates deep link format
    return `https://${domain}/dp/${asin}/ref=nosim${tagParam}`;
  }

  // Fallback: search link (allowed by Amazon but lower conversion)
  console.warn(`[Monetization] No ASIN for "${product}" — using search link fallback.`);
  const query = encodeURIComponent(product);
  return `https://${domain}/s?k=${query}${tag ? `&tag=${tag}` : ''}&ref=nb_sb_noss`;
}

// ── Click Store ────────────────────────────────────────────────────────────────

async function readClicks() {
  try {
    const raw = await fs.readFile(CLICKS_FILE, 'utf8');
    return JSON.parse(raw);
  } catch { return []; }
}

async function recordClick({ linkId, jobId, product, market, url }) {
  const clicks = await readClicks();
  const entry = { linkId, jobId, product, market, url, clickedAt: new Date().toISOString() };
  clicks.push(entry);
  // Structured log — visible in Render dashboard in real-time
  console.log('[CLICK]', JSON.stringify({ linkId, jobId, product, market, ts: entry.clickedAt }));
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
    byMarket: relevant.reduce((acc, c) => {
      if (c.market) acc[c.market] = (acc[c.market] || 0) + 1;
      return acc;
    }, {}),
    recent: relevant.slice(-20).reverse()
  };
}

// ── Link Generation ────────────────────────────────────────────────────────────

async function shortenUrl(longUrl) {
  try {
    const res = await axios.get(
      `https://tinyurl.com/api-create.php?url=${encodeURIComponent(longUrl)}`,
      { timeout: 5000 }
    );
    return res.data;
  } catch (err) {
    console.warn('[Monetization] TinyURL failed, using long URL:', err.message);
    return longUrl;
  }
}

/**
 * Generate a tracked affiliate link.
 *
 * @param {string} product  - product name (used for ASIN lookup)
 * @param {string} jobId    - factory job ID for attribution
 * @param {string} market   - market code: US | UK | AU | CA | Global
 * @param {string} baseUrl  - public server base URL for /go/ tracking redirect
 */
async function generateAffiliateLink(product, jobId = null, market = 'UK', baseUrl = '') {
  const longUrl = buildAmazonUrl(product, market);
  const linkId = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

  // Persist linkId → destination so /go/:linkId can resolve and record the click
  const linksFile = path.join(RUNTIME_DIR, 'links.json');
  let linksMap = {};
  try { linksMap = JSON.parse(await fs.readFile(linksFile, 'utf8')); } catch { /* first run */ }
  linksMap[linkId] = { product, jobId, market, url: longUrl, createdAt: new Date().toISOString() };
  await fs.mkdir(RUNTIME_DIR, { recursive: true });
  await fs.writeFile(linksFile, JSON.stringify(linksMap, null, 2));

  if (baseUrl) {
    // Preferred: tracked link via our server → records click + redirects
    return `${baseUrl}/go/${linkId}`;
  }

  // Fallback: shorten with TinyURL (no click tracking but clean URL)
  return shortenUrl(longUrl);
}

// ── Express Route Handler ──────────────────────────────────────────────────────

async function affiliateRedirectHandler(req, res) {
  const { linkId } = req.params;
  const linksFile = path.join(RUNTIME_DIR, 'links.json');
  try {
    const linksMap = JSON.parse(await fs.readFile(linksFile, 'utf8'));
    const entry = linksMap[linkId];
    if (!entry) return res.status(404).send('Link not found');
    await recordClick({
      linkId,
      jobId: entry.jobId,
      product: entry.product,
      market: entry.market,
      url: entry.url
    });
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
  getAffiliateTag,
  PRODUCT_ASIN_MAP,
  MARKET_CONFIG
};
