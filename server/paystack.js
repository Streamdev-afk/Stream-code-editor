/**
 * Paystack API wrapper.
 * All calls use the secret key from env.
 * Test mode keys start with sk_test_, live keys with sk_live_.
 */

const PAYSTACK_BASE = 'https://api.paystack.co'

const SECRET_KEY = process.env.PAYSTACK_SECRET_KEY

export function isConfigured() {
  return !!SECRET_KEY
}

if (!isConfigured()) {
  console.warn('⚠️  PAYSTACK_SECRET_KEY missing — payments disabled')
}

async function paystackFetch(path, options = {}) {
  if (!SECRET_KEY) {
    throw new Error('Paystack not configured')
  }

  const res = await fetch(`${PAYSTACK_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${SECRET_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data?.message || `Paystack error: HTTP ${res.status}`)
  }
  return data
}

/**
 * Initialize a transaction — creates a checkout URL.
 * `plan` is the Paystack plan code (e.g. PLN_xxx).
 */
export async function initializeTransaction({
  email,
  amount,          // in kobo (NGN * 100)
  plan,            // Paystack plan code (optional — for subscriptions)
  callbackUrl,
  metadata = {},
}) {
  const payload = {
    email,
    amount,
    callback_url: callbackUrl,
    metadata,
  }
  if (plan) payload.plan = plan

  const data = await paystackFetch('/transaction/initialize', {
    method: 'POST',
    body: JSON.stringify(payload),
  })

  return {
    authorizationUrl: data.data.authorization_url,
    accessCode: data.data.access_code,
    reference: data.data.reference,
  }
}

/**
 * Verify a transaction by reference.
 * Returns the full transaction object.
 */
export async function verifyTransaction(reference) {
  const data = await paystackFetch(`/transaction/verify/${encodeURIComponent(reference)}`)
  return data.data
}

/**
 * Fetch a subscription by code or email token.
 */
export async function fetchSubscription(codeOrToken) {
  const data = await paystackFetch(`/subscription/${encodeURIComponent(codeOrToken)}`)
  return data.data
}

/**
 * Disable (cancel) a subscription.
 * Requires email_token from the subscription.
 */
export async function disableSubscription({ code, emailToken }) {
  const data = await paystackFetch('/subscription/disable', {
    method: 'POST',
    body: JSON.stringify({
      code,
      token: emailToken,
    }),
  })
  return data.data
}

/**
 * Verify a webhook signature — ensures the payload came from Paystack.
 * Paystack signs with HMAC SHA512 using the secret key.
 */
export async function verifyWebhookSignature(rawBody, signature) {
  if (!SECRET_KEY) return false

  const crypto = await import('crypto')
  const hash = crypto
    .createHmac('sha512', SECRET_KEY)
    .update(rawBody)
    .digest('hex')

  return hash === signature
}