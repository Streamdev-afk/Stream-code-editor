/**
 * Usage tracker with two rolling windows.
 *  - Short window: 5 hours
 *  - Long window: 2 weeks
 * Both must have room for a request to succeed.
 * Resets on server restart — swap for DB later.
 */

// key -> { shortWindowStart, shortCount, longWindowStart, longCount, tokens }
const usage = new Map()

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

function getUserTier(req) {
  if (!req.isAuth) return 'anonymous'

  // For now, everyone who signs in is 'free'.
  // Later: check Supabase DB for a subscription tier.
  // Test hook: set ADMIN_TIER_OVERRIDE=pro10x in .env to force a tier for your user.
  const override = process.env.ADMIN_TIER_OVERRIDE
  if (override && TIER_LIMITS[override]) return override

  return 'free'
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

// ------------------------------------------------------------
// Public API
// ------------------------------------------------------------

/**
 * Check if the user can make a request.
 * `cost` is the number of units the request will consume.
 */
export function checkLimit(req, cost = 1) {
  const key = getUserKey(req)
  const tier = getUserTier(req)
  const limits = TIER_LIMITS[tier]
  const entry = getOrCreateEntry(key)

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
  const entry = getOrCreateEntry(key)
  entry.shortCount += cost
  entry.longCount += cost
  entry.tokens += tokens
}

/**
 * Current usage summary for a request context.
 */
export function getUsage(req) {
  const key = getUserKey(req)
  const tier = getUserTier(req)
  const limits = TIER_LIMITS[tier]
  const entry = getOrCreateEntry(key)

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