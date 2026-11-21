// The editor follows the plan bought in the ION app. This reads it (and which models it unlocks) and tells the UI what is locked.
import { useEffect, useState } from 'react'
import { supabase } from './supabase'

export const PLAN_RANK = { free: 0, go: 1, plus: 2, pro: 3, max: 4 }
export const PLAN_NAME = { free: 'Free', go: 'Go', plus: 'Plus', pro: 'Pro', max: 'Max' }
// the lowest plan that gets each feature
export const FEATURE_MIN = { fullAccess: 'go', team: 'plus', crew: 'plus', thinkHigh: 'plus', thinkUltra: 'pro' }
export const THINK_MIN = { high: 'plus', ultra: 'pro' }

let cache = { plan: 'free', models: {}, at: 0, loaded: false }
const listeners = new Set()
async function refresh(force) {
  if (!supabase || (!force && Date.now() - cache.at < 45000)) return
  cache.at = Date.now()
  try {
    const [p, m] = await Promise.all([supabase.rpc('my_plan'), supabase.rpc('my_models')])
    const plan = p?.data?.plan || 'free'
    const models = {}
    for (const x of Array.isArray(m?.data) ? m.data : []) models[x.id] = { allowed: x.allowed !== false, min: x.min_plan }
    cache = { plan, models, at: Date.now(), loaded: true }
    listeners.forEach((f) => f(cache))
  } catch { /* stay on what we have */ }
}

export function usePlan() {
  const [c, setC] = useState(cache)
  useEffect(() => {
    listeners.add(setC)
    refresh()
    const t = setInterval(() => refresh(), 60000)
    return () => { listeners.delete(setC); clearInterval(t) }
  }, [])
  const rank = PLAN_RANK[c.plan] ?? 0
  return {
    plan: c.plan,
    loaded: c.loaded,
    rank,
    can: (feature) => rank >= (PLAN_RANK[FEATURE_MIN[feature]] ?? 0),
    canThink: (lvl) => rank >= (PLAN_RANK[THINK_MIN[lvl]] ?? 0),
    modelLock: (id) => (c.models[id] && !c.models[id].allowed ? c.models[id].min : null),
  }
}
export const refreshPlan = () => refresh(true)
export const lockToast = (feature, min) => `${feature} needs the ${PLAN_NAME[min] || min} plan. Buy it in the ION app (Plans page) with the same login.`
