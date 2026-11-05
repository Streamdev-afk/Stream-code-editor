import { API_BASE } from './api'
import { apiFetch } from './supabase'

/**
 * Start a Paystack checkout. Returns { authorizationUrl, reference, tier }.
 * User must be signed in.
 */
export async function startCheckout(tier) {
  const res = await apiFetch(`${API_BASE}/api/paystack/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tier }),
  })

  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)

  return data
}

/**
 * Fetch the current user's subscription.
 */
export async function getSubscription() {
  const res = await apiFetch(`${API_BASE}/api/subscription`)
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data.subscription
}

/**
 * Cancel the current user's subscription.
 */
export async function cancelSubscription() {
  const res = await apiFetch(`${API_BASE}/api/subscription/cancel`, {
    method: 'POST',
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data.subscription
}

/**
 * Redirect the browser to the Paystack checkout URL.
 */
export function redirectToCheckout(authorizationUrl) {
  window.location.href = authorizationUrl
}