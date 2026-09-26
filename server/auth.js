import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY

let supabase = null
if (SUPABASE_URL && SUPABASE_ANON_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  console.log('✅ Supabase auth enabled on backend')
} else {
  console.warn('⚠️  Supabase env vars missing — anonymous-only mode')
}

/**
 * Express middleware — extracts the user (if any) from the Authorization header.
 * Always calls next() — anonymous requests are allowed.
 * Sets:
 *   req.user   = { id, email, ... } or null
 *   req.isAuth = true if authenticated
 */
export async function attachUser(req, res, next) {
  req.user = null
  req.isAuth = false

  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next()
  }

  const token = authHeader.slice(7)
  if (!token || !supabase) return next()

  try {
    const { data, error } = await supabase.auth.getUser(token)
    if (error || !data?.user) return next()
    req.user = {
      id: data.user.id,
      email: data.user.email,
      metadata: data.user.user_metadata,
    }
    req.isAuth = true
  } catch (err) {
    // Bad token — treat as anonymous
    console.warn('Auth verify failed:', err.message)
  }

  next()
}