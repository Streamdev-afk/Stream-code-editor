import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  console.warn(
    '[ION Qoders] Supabase env vars missing. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env'
  )
}

export const supabase = url && anonKey
  ? createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null

/**
 * Returns the current session's access token, or null.
 */
export async function getAccessToken() {
  if (!supabase) return null
  const { data } = await supabase.auth.getSession()
  return data?.session?.access_token || null
}

/**
 * Fetch helper — automatically attaches the Supabase JWT if the user is signed in.
 */
export async function apiFetch(url, options = {}) {
  const token = await getAccessToken()
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  }
  if (token) headers.Authorization = `Bearer ${token}`

  // The free Render server sleeps and answers the first request with a dropped connection
  // or a 502/503/504. Wait for it to wake up instead of showing an error.
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  let lastErr
  for (let attempt = 0; attempt < 3; attempt++) {
    if (options.signal?.aborted) break
    try {
      const res = await fetch(url, { ...options, headers })
      if ([502, 503, 504].includes(res.status) && attempt < 2) {
        await wait(2500 * (attempt + 1))
        continue
      }
      return res
    } catch (e) {
      lastErr = e
      if (e?.name === 'AbortError') throw e
      if (attempt < 2) await wait(2500 * (attempt + 1))
    }
  }
  throw new Error('Could not reach the server. Check your internet and try again in a moment.')
}