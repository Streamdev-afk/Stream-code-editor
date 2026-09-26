/**
 * In-memory usage tracker with multi-window support.
 * Currently: 2-week window. Later we'll add a rolling 5-hour window.
 * Resets on server restart — swap for DB later.
 */

// key -> { windowStart, count, tokens, cost }
const usage = new Map()

// Window length in ms
export const WINDOW_2WEEKS_MS = 14 * 24 * 60 * 60 * 1000

// Tier limits — 2-week window for now
export const LIMITS = {
  anonymous: {
    requestsPerWindow: 10,
    label: 'Guest',
  },
  free: {
    requestsPerWindow: 500,
    label: 'Free',
  },
  pro3x: {
    requestsPerWindow: 1500,
    label: 'Pro 3×',
  },
  pro5x: {
    requestsPerWindow: 2500,
    label: 'Pro 5×',
  },
  pro10x: {
    requestsPerWindow: 5000,
    label: 'Pro 10×',
  },
}

// Thinking-level multipliers (used later when we add thinking levels)
export const THINKING_MULTIPLIERS = {
  low: 1,
  medium: 2,
  high: 4,
  ultra: 8,
}

function getUserKey(req) {
  if (req.isAuth && req.user?.id) return `user:${req.user.id}`
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.socket?.remoteAddress
    || 'unknown'
  return `ip:${ip}`
}

function getUserTier(req) {
  if (!req.isAuth) return 'anonymous'
  // Later: check subscription in DB to determine pro tier
  return 'free'
}

function getOrCreateEntry(key) {
  const now = Date.now()
  let entry = usage.get(key)
  if (!entry || now - entry.windowStart >= WINDOW_2WEEKS_MS) {
    entry = { windowStart: now, count: 0, tokens: 0, cost: 0 }
    usage.set(key, entry)
  }
  return entry
}

/**
 * Check if the user can make a request.
 */
export function checkLimit(req, cost = 1) {
  const key = getUserKey(req)
  const tier = getUserTier(req)
  const limit = LIMITS[tier]
  const entry = getOrCreateEntry(key)

  const remaining = limit.requestsPerWindow - entry.count

  if (remaining < cost) {
    return {
      allowed: false,
      tier,
      tierLabel: limit.label,
      used: entry.count,
      limit: limit.requestsPerWindow,
      remaining: Math.max(0, remaining),
      windowStart: entry.windowStart,
      windowEndsAt: entry.windowStart + WINDOW_2WEEKS_MS,
      message:
        tier === 'anonymous'
          ? `Guest limit reached (${limit.requestsPerWindow} requests). Sign in for more.`
          : `Usage limit reached (${limit.requestsPerWindow} requests). Upgrade for more.`,
    }
  }

  return {
    allowed: true,
    tier,
    tierLabel: limit.label,
    used: entry.count,
    limit: limit.requestsPerWindow,
    remaining,
    windowStart: entry.windowStart,
    windowEndsAt: entry.windowStart + WINDOW_2WEEKS_MS,
  }
}

/**
 * Record a completed request. `cost` is the number of units consumed.
 */
export function recordUsage(req, cost = 1, { tokens = 0 } = {}) {
  const key = getUserKey(req)
  const entry = getOrCreateEntry(key)
  entry.count += cost
  entry.tokens += tokens
}

/**
 * Get current usage summary for a request context.
 */
export function getUsage(req) {
  const key = getUserKey(req)
  const tier = getUserTier(req)
  const limit = LIMITS[tier]
  const entry = getOrCreateEntry(key)

  const used = entry.count
  const total = limit.requestsPerWindow
  const remaining = Math.max(0, total - used)
  const percent = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0

  return {
    tier,
    tierLabel: limit.label,
    used,
    limit: total,
    remaining,
    percent,
    tokens: entry.tokens,
    windowStart: entry.windowStart,
    windowEndsAt: entry.windowStart + WINDOW_2WEEKS_MS,
  }
}