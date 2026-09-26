/**
 * Simple in-memory usage tracker. Resets on server restart.
 * When we add a database, swap this out for real storage.
 */

// userId or IP -> { count, tokens, cost, dayStart }
const usage = new Map()

// Free tier limits
export const LIMITS = {
  anonymous: {
    requestsPerDay: 10,
    label: 'Guest',
  },
  free: {
    requestsPerDay: 100,
    label: 'Free',
  },
  pro: {
    requestsPerDay: 2000,
    label: 'Pro',
  },
}

function todayKey() {
  return new Date().toISOString().slice(0, 10) // YYYY-MM-DD
}

function getUserKey(req) {
  if (req.isAuth && req.user?.id) return `user:${req.user.id}`
  // Anonymous — key by IP
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.socket?.remoteAddress
    || 'unknown'
  return `ip:${ip}`
}

function getUserTier(req) {
  if (!req.isAuth) return 'anonymous'
  // Later: check subscription in DB. For now, all logged-in users are 'free'.
  return 'free'
}

/**
 * Check if the user can make a request. Returns:
 *   { allowed: true, tier, used, limit }
 *   { allowed: false, tier, used, limit, message }
 */
export function checkLimit(req) {
  const key = getUserKey(req)
  const tier = getUserTier(req)
  const limit = LIMITS[tier]
  const today = todayKey()

  let entry = usage.get(key)
  if (!entry || entry.day !== today) {
    entry = { day: today, count: 0, tokens: 0, cost: 0 }
    usage.set(key, entry)
  }

  if (entry.count >= limit.requestsPerDay) {
    return {
      allowed: false,
      tier,
      used: entry.count,
      limit: limit.requestsPerDay,
      message:
        tier === 'anonymous'
          ? `Guest limit reached (${limit.requestsPerDay}/day). Sign in for more.`
          : `Daily limit reached (${limit.requestsPerDay}/day). Upgrade for more.`,
    }
  }

  return {
    allowed: true,
    tier,
    used: entry.count,
    limit: limit.requestsPerDay,
  }
}

/**
 * Record a completed request.
 */
export function recordUsage(req, { tokens = 0, cost = 0 } = {}) {
  const key = getUserKey(req)
  const today = todayKey()

  let entry = usage.get(key)
  if (!entry || entry.day !== today) {
    entry = { day: today, count: 0, tokens: 0, cost: 0 }
    usage.set(key, entry)
  }

  entry.count += 1
  entry.tokens += tokens
  entry.cost += cost
}

/**
 * Get current usage summary for a request context.
 */
export function getUsage(req) {
  const key = getUserKey(req)
  const tier = getUserTier(req)
  const limit = LIMITS[tier]
  const today = todayKey()

  const entry = usage.get(key)
  if (!entry || entry.day !== today) {
    return {
      tier,
      used: 0,
      limit: limit.requestsPerDay,
      remaining: limit.requestsPerDay,
      tokens: 0,
      cost: 0,
    }
  }

  return {
    tier,
    used: entry.count,
    limit: limit.requestsPerDay,
    remaining: Math.max(0, limit.requestsPerDay - entry.count),
    tokens: entry.tokens,
    cost: entry.cost,
  }
}