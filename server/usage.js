/**
 * Usage tracker with two rolling windows.
 *  - Short window: 5 hours
 *  - Long window: 2 weeks
 * Both must have room for a request to succeed.
 * Stored in Supabase (table stream_usage) so limits survive server restarts and sleeps.
 * If the database is unreachable it falls back to memory, so the app never goes down because of it.
 */

// key -> { shortWindowStart, shortCount, longWindowStart, longCount, tokens }
const usage = new Map()

import { randomBytes } from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { getUserTier as getUserTierFromDB } from './subscriptions.js'

const SB_URL = process.env.SUPABASE_URL
const SB_SECRET = process.env.SUPABASE_SERVICE_ROLE_KEY
const db = SB_URL && SB_SECRET
  ? createClient(SB_URL, SB_SECRET, { auth: { persistSession: false, autoRefreshToken: false } })
  : null

export const SHORT_WINDOW_MS = 5 * 60 * 60 * 1000          // 5 hours
export const LONG_WINDOW_MS = 14 * 24 * 60 * 60 * 1000     // 2 weeks

// Per-tier limits — per short window and per long window
export const TIER_LIMITS = {
  anonymous: {
    label: 'Guest',
    short: 5,
    long: 20,
  },
  free: {
    label: 'Free',
    short: 20,
    long: 500,
  },
  pro3x: {
    label: 'Pro 3×',
    short: 60,
    long: 1500,
  },
  pro5x: {
    label: 'Pro 5×',
    short: 100,
    long: 2500,
  },
  pro10x: {
    label: 'Pro 10×',
    short: 200,
    long: 5000,
  },
}

// Thinking-level multipliers (usage cost per request)
export const THINKING_MULTIPLIERS = {
  low: 1,
  medium: 2,
  high: 4,
  ultra: 8,
}

// ------------------------------------------------------------
// Identity + tier
// ------------------------------------------------------------

function getUserKey(req) {
  if (req.isAuth && req.user?.id) return `user:${req.user.id}`
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.socket?.remoteAddress
    || 'unknown'
  return `ip:${ip}`
}


// Simple cache so we don't hit DB on every request
const tierCache = new Map() // userId -> { tier, expiresAt }
const TIER_CACHE_TTL = 30 * 1000 // 30 seconds

async function resolveTier(req) {
  if (!req.isAuth) return 'anonymous'

  // Dev override for testing
  const override = process.env.ADMIN_TIER_OVERRIDE
  if (override && TIER_LIMITS[override]) return override

  const userId = req.user?.id
  if (!userId) return 'free'

  const cached = tierCache.get(userId)
  if (cached && cached.expiresAt > Date.now()) return cached.tier

  try {
    const tier = await getUserTierFromDB(userId)
    const normalized = TIER_LIMITS[tier] ? tier : 'free'
    tierCache.set(userId, { tier: normalized, expiresAt: Date.now() + TIER_CACHE_TTL })
    return normalized
  } catch {
    return 'free'
  }
}

// ------------------------------------------------------------
// Windowed usage store
// ------------------------------------------------------------

function getOrCreateEntry(key) {
  const now = Date.now()
  let entry = usage.get(key)
  if (!entry) {
    entry = {
      shortWindowStart: now,
      shortCount: 0,
      longWindowStart: now,
      longCount: 0,
      tokens: 0,
    }
    usage.set(key, entry)
  }
  // Roll short window if expired
  if (now - entry.shortWindowStart >= SHORT_WINDOW_MS) {
    entry.shortWindowStart = now
    entry.shortCount = 0
  }
  // Roll long window if expired
  if (now - entry.longWindowStart >= LONG_WINDOW_MS) {
    entry.longWindowStart = now
    entry.longCount = 0
  }
  return entry
}

function fromRow(r) {
  return {
    shortWindowStart: Date.parse(r.short_start),
    shortCount: Number(r.short_count),
    longWindowStart: Date.parse(r.long_start),
    longCount: Number(r.long_count),
    tokens: Number(r.tokens),
  }
}

let lastDbWarn = 0
function warnDb(msg) {
  if (Date.now() - lastDbWarn > 60 * 1000) {
    lastDbWarn = Date.now()
    console.warn('[usage] database unavailable, using memory:', msg)
  }
}

// Current numbers for a key: Supabase first (rolls expired windows there), memory as a backup
async function getEntry(key) {
  if (db) {
    try {
      const { data, error } = await db.rpc('stream_usage_touch', {
        p_key: key,
        p_short_ms: SHORT_WINDOW_MS,
        p_long_ms: LONG_WINDOW_MS,
      })
      const row = Array.isArray(data) ? data[0] : data
      if (!error && row) return fromRow(row)
      if (error) warnDb(error.message)
    } catch (e) {
      warnDb(e?.message || String(e))
    }
  }
  return getOrCreateEntry(key)
}

// ------------------------------------------------------------
// Public API
// ------------------------------------------------------------

/**
 * Check if the user can make a request.
 * `cost` is the number of units the request will consume.
 */
export async function checkLimit(req, cost = 1) {
  const key = getUserKey(req)
  const tier = await resolveTier(req)
  const limits = TIER_LIMITS[tier]
  const entry = await getEntry(key)

  const shortRemaining = limits.short - entry.shortCount
  const longRemaining = limits.long - entry.longCount

  const shortBlocked = shortRemaining < cost
  const longBlocked = longRemaining < cost

  if (shortBlocked || longBlocked) {
    let message
    if (shortBlocked) {
      const resetIn = Math.ceil((SHORT_WINDOW_MS - (Date.now() - entry.shortWindowStart)) / (60 * 1000))
      message = tier === 'anonymous'
        ? `Guest 5-hour limit reached (${limits.short} requests). Sign in for more — resets in ${resetIn} min.`
        : `5-hour limit reached (${limits.short} requests). ${tier === 'free' ? 'Upgrade for more — ' : ''}resets in ${resetIn} min.`
    } else {
      const resetIn = Math.ceil((LONG_WINDOW_MS - (Date.now() - entry.longWindowStart)) / (24 * 60 * 60 * 1000))
      message = tier === 'anonymous'
        ? `Guest total limit reached (${limits.long} requests). Sign in for more — resets in ${resetIn} days.`
        : `2-week limit reached (${limits.long} requests). Upgrade for more — resets in ${resetIn} days.`
    }
    return {
      allowed: false,
      tier,
      tierLabel: limits.label,
      message,
      cost,
      short: {
        used: entry.shortCount,
        limit: limits.short,
        remaining: Math.max(0, shortRemaining),
        blocked: shortBlocked,
        windowStart: entry.shortWindowStart,
        windowEndsAt: entry.shortWindowStart + SHORT_WINDOW_MS,
      },
      long: {
        used: entry.longCount,
        limit: limits.long,
        remaining: Math.max(0, longRemaining),
        blocked: longBlocked,
        windowStart: entry.longWindowStart,
        windowEndsAt: entry.longWindowStart + LONG_WINDOW_MS,
      },
    }
  }

  return {
    allowed: true,
    tier,
    tierLabel: limits.label,
    cost,
    short: {
      used: entry.shortCount,
      limit: limits.short,
      remaining: shortRemaining,
      blocked: false,
      windowStart: entry.shortWindowStart,
      windowEndsAt: entry.shortWindowStart + SHORT_WINDOW_MS,
    },
    long: {
      used: entry.longCount,
      limit: limits.long,
      remaining: longRemaining,
      blocked: false,
      windowStart: entry.longWindowStart,
      windowEndsAt: entry.longWindowStart + LONG_WINDOW_MS,
    },
  }
}

/**
 * Record a completed request. `cost` is the number of units consumed.
 */
export function recordUsage(req, cost = 1, { tokens = 0 } = {}) {
  const key = getUserKey(req)
  // memory copy (backup if the database is down)
  const entry = getOrCreateEntry(key)
  entry.shortCount += cost
  entry.longCount += cost
  entry.tokens += tokens
  // database copy (this is the one that survives restarts); fire and forget
  if (db) {
    db.rpc('stream_usage_add', {
      p_key: key,
      p_cost: cost,
      p_tokens: Math.round(tokens) || 0,
      p_short_ms: SHORT_WINDOW_MS,
      p_long_ms: LONG_WINDOW_MS,
    }).then(({ error }) => {
      if (error) warnDb(error.message)
    }).catch((e) => warnDb(e?.message || String(e)))
  }
}

/**
 * Current usage summary for a request context.
 */
export async function getUsage(req) {
  const key = getUserKey(req)
  const tier = await resolveTier(req)
  const limits = TIER_LIMITS[tier]
  const entry = await getEntry(key)

  const shortPercent = limits.short > 0
    ? Math.min(100, Math.round((entry.shortCount / limits.short) * 100))
    : 0
  const longPercent = limits.long > 0
    ? Math.min(100, Math.round((entry.longCount / limits.long) * 100))
    : 0

  return {
    tier,
    tierLabel: limits.label,

    short: {
      used: entry.shortCount,
      limit: limits.short,
      remaining: Math.max(0, limits.short - entry.shortCount),
      percent: shortPercent,
      windowEndsAt: entry.shortWindowStart + SHORT_WINDOW_MS,
      windowMs: SHORT_WINDOW_MS,
    },

    long: {
      used: entry.longCount,
      limit: limits.long,
      remaining: Math.max(0, limits.long - entry.longCount),
      percent: longPercent,
      windowEndsAt: entry.longWindowStart + LONG_WINDOW_MS,
      windowMs: LONG_WINDOW_MS,
    },

    tokens: entry.tokens,
  }
}

// ------------------------------------------------------------
// "Turns": when the AI reads your project with terminal commands it needs several quick
// round trips for ONE question. The first round is charged; the follow-ups ride on a
// turn id the server handed out, so a single question costs a single request.
// ------------------------------------------------------------
const turns = new Map()
const TURN_TTL_MS = 10 * 60 * 1000
const MAX_FOLLOWUPS = 6

export function issueTurn(req) {
  if (turns.size > 500) {
    const now = Date.now()
    for (const [id, t] of turns) if (t.expires < now) turns.delete(id)
  }
  const id = randomBytes(8).toString('hex')
  turns.set(id, { key: getUserKey(req), used: 0, expires: Date.now() + TURN_TTL_MS })
  return id
}

export function useTurn(req, id) {
  const t = turns.get(String(id || ''))
  if (!t) return false
  if (t.expires < Date.now()) { turns.delete(String(id)); return false }
  if (t.key !== getUserKey(req)) return false
  if (t.used >= MAX_FOLLOWUPS) return false
  t.used++
  return true
}
