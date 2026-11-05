/**
 * Subscription storage — reads/writes Supabase `subscriptions` table.
 * Uses the service_role key for full write access.
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

let supabaseAdmin = null

if (SUPABASE_URL && SERVICE_ROLE_KEY) {
  supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  console.log('✅ Supabase admin (service_role) enabled')
} else {
  console.warn('⚠️  SUPABASE_SERVICE_ROLE_KEY missing — subscriptions disabled')
}

// Simple in-memory cache so we don't hit the DB on every request
// key -> { tier, expiresAt }
const tierCache = new Map()
const CACHE_TTL_MS = 60 * 1000 // 1 minute

export function isConfigured() {
  return !!supabaseAdmin
}

/**
 * Get the tier for a user. Cached for 1 minute.
 * Returns 'free' if no subscription found.
 */
export async function getUserTier(userId) {
  if (!userId) return 'free'
  if (!supabaseAdmin) return 'free'

  const cached = tierCache.get(userId)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.tier
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('subscriptions')
      .select('tier, status, current_period_end')
      .eq('user_id', userId)
      .maybeSingle()

    if (error || !data) {
      tierCache.set(userId, { tier: 'free', expiresAt: Date.now() + CACHE_TTL_MS })
      return 'free'
    }

    // Only active subscriptions grant the paid tier
    const isActive = data.status === 'active'
    const notExpired = !data.current_period_end || new Date(data.current_period_end) > new Date()
    const tier = isActive && notExpired ? (data.tier || 'free') : 'free'

    tierCache.set(userId, { tier, expiresAt: Date.now() + CACHE_TTL_MS })
    return tier
  } catch (err) {
    console.warn('getUserTier failed:', err.message)
    return 'free'
  }
}

/**
 * Clear cached tier for a user (call after subscription changes).
 */
export function invalidateTierCache(userId) {
  if (userId) tierCache.delete(userId)
}

/**
 * Get full subscription record for a user.
 */
export async function getSubscription(userId) {
  if (!supabaseAdmin || !userId) return null

  const { data, error } = await supabaseAdmin
    .from('subscriptions')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw error
  return data
}

/**
 * Upsert a subscription (create or update).
 */
export async function upsertSubscription(userId, fields) {
  if (!supabaseAdmin) throw new Error('Subscriptions not configured')

  const payload = {
    user_id: userId,
    updated_at: new Date().toISOString(),
    ...fields,
  }

  const { data, error } = await supabaseAdmin
    .from('subscriptions')
    .upsert(payload, { onConflict: 'user_id' })
    .select()
    .single()

  if (error) throw error
  invalidateTierCache(userId)
  return data
}

/**
 * Cancel a subscription — sets status to 'cancelled'.
 * The tier downgrade happens naturally when current_period_end passes.
 */
export async function cancelSubscription(userId) {
  if (!supabaseAdmin) throw new Error('Subscriptions not configured')

  const { data, error } = await supabaseAdmin
    .from('subscriptions')
    .update({
      status: 'cancelled',
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .select()
    .single()

  if (error) throw error
  invalidateTierCache(userId)
  return data
}