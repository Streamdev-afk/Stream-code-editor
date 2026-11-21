// Plan gate: the editor follows the ION plan. Features and models above a person's plan are switched off here,
// so a locked option cannot be used by calling the API directly.
import { createClient } from '@supabase/supabase-js'
import { resolveTier } from './usage.js'

const RANK = { anonymous: 0, free: 0, go: 1, plus: 2, pro3x: 2, pro: 3, pro5x: 3, pro10x: 3, max: 4, max2: 4, max3: 4, max5: 4 }
const PLAN_RANK = { free: 0, go: 1, plus: 2, pro: 3, max: 4 }
const admin = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  : null

let models = { at: 0, map: new Map() }
async function modelRanks() {
  if (Date.now() - models.at < 5 * 60 * 1000) return models.map
  try {
    const { data } = await admin.from('ai_models').select('id, min_plan, active, credit_cost')
    models = { at: Date.now(), map: new Map((data || []).filter((m) => m.active !== false).map((m) => [m.id, { rank: PLAN_RANK[m.min_plan] ?? 0, cost: Math.max(1, Number(m.credit_cost) || 1) }])) }
  } catch { models.at = Date.now() - 4 * 60 * 1000 }
  return models.map
}

export async function planGate(req, _res, next) {
  try {
    if (req.method !== 'POST' || !/^\/api\/(chat|edit|agent)/.test(req.path) || req.byok || !req.body || typeof req.body !== 'object') return next()
    const tier = await resolveTier(req)
    const rank = RANK[tier] ?? 0
    const b = req.body
    if (rank < 1) b.fullAccess = false
    if (rank < 2) b.team = false
    if (b.model && admin) {
      const info = (await modelRanks()).get(b.model)
      if (info && info.rank > rank) delete b.model // falls back to the server's default model
      else if (info) req.creditWeight = info.cost
    }
  } catch { /* never block a request because the gate failed */ }
  next()
}
