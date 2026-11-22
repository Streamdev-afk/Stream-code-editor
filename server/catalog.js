// Multi-provider model catalog. Each entry names a model by a pattern (not an exact id), the server looks the real id up
// from the provider's own /models list, so new versions keep working. Add the key in Render and the model appears.
// Tiers: free (OpenRouter/Groq, handled elsewhere) · go · plus · pro · max   (min ION plan that unlocks it)
export const PROVIDERS = {
  fireworks: { name: 'Fireworks', env: 'FIREWORKS_API_KEY', base: 'https://api.fireworks.ai/inference/v1' },
  cerebras: { name: 'Cerebras', env: 'CEREBRAS_API_KEY', base: 'https://api.cerebras.ai/v1' },
  together: { name: 'Together', env: 'TOGETHER_API_KEY', base: 'https://api.together.xyz/v1' },
}

// providers: tried in order (first one with a key, falls through to the next if it fails)
export const CATALOG = [
  { key: 'kimi', providers: ['fireworks', 'together'], match: /kimi-k3(?!.*(flash|fast))/i, label: 'Kimi K3', tier: 'pro', cost: 5, speed: 2, power: 5, badge: 'max',
    best: 'Hardest coding, big refactors, long agent jobs', weak: 'Slower and uses the most credits' },
  { key: 'glm', providers: ['fireworks', 'together'], match: /glm-5p3$|glm-5\.3$/i, label: 'GLM 5.3', tier: 'plus', cost: 3, speed: 3, power: 4, badge: 'pro',
    best: 'Strong all-round coder, full projects, debugging', weak: 'Not the fastest' },
  { key: 'deepseek', providers: ['fireworks', 'together'], match: /deepseek-v4p?1?.*flash(?!-\d)/i, label: 'DeepSeek V4.1 Flash', tier: 'go', cost: 1, speed: 4, power: 3, badge: 'alt',
    best: 'Cheap and quick coding, edits, explanations', weak: 'Can miss details on very large tasks' },
  { key: 'minimax', providers: ['fireworks', 'together'], match: /minimax-m3.*flash/i, label: 'MiniMax M3.1 Flash', tier: 'go', cost: 1, speed: 4, power: 3, badge: 'alt',
    best: 'Agent tasks and tool use at low cost', weak: 'Simpler reasoning than GLM or Kimi' },
  { key: 'glmflash', providers: ['fireworks', 'together'], match: /glm-5p3-flash|glm-5\.3-flash/i, label: 'GLM 5.3 Flash', tier: 'go', cost: 1, speed: 5, power: 2, badge: 'fast',
    best: 'Quick questions and small fixes', weak: 'Simple tasks only' },
  { key: 'gptoss120', providers: ['cerebras'], match: /gpt-oss-120b/i, label: 'GPT-OSS 120B (Cerebras)', tier: 'go', cost: 1, speed: 5, power: 3, badge: 'fast',
    best: 'Lightning-fast replies, quick edits, autocomplete-style work', weak: 'Smaller context, fewer models' },
  { key: 'cbqwen', providers: ['cerebras'], match: /qwen/i, label: 'Qwen (Cerebras)', tier: 'go', cost: 1, speed: 5, power: 3, badge: 'fast',
    best: 'Very fast general coding', weak: 'Smaller than Kimi or GLM' },
]

const RANK = { free: 0, go: 1, plus: 2, pro: 3, max: 4 }
export const tierRank = (t) => RANK[t] ?? 0
export const isCatalogId = (id) => /^[a-z0-9]+::[a-z0-9]+$/i.test(String(id || ''))
export const entryFor = (id) => CATALOG.find((e) => `${e.providers[0]}::${e.key}` === id || id === `cat::${e.key}`)
export const catId = (e) => `cat::${e.key}`
export const hasKey = (p) => !!(PROVIDERS[p] && process.env[PROVIDERS[p].env])

const cache = new Map() // provider -> { at, ids }
async function providerModels(p) {
  const c = cache.get(p)
  if (c && Date.now() - c.at < 3600e3) return c.ids
  try {
    const r = await fetch(`${PROVIDERS[p].base}/models`, { headers: { Authorization: `Bearer ${process.env[PROVIDERS[p].env]}` }, signal: AbortSignal.timeout(10000) })
    const j = await r.json()
    const arr = Array.isArray(j) ? j : (j.data || [])
    const ids = arr.map((m) => m.id).filter(Boolean)
    if (ids.length) { cache.set(p, { at: Date.now(), ids }); return ids }
  } catch (e) { console.log(`[catalog] ${p} model list failed: ${e.message}`) }
  return c?.ids || []
}
// real id on a provider, or null
export async function resolve(entry, p) {
  if (!hasKey(p)) return null
  const ids = await providerModels(p)
  const hit = ids.filter((i) => entry.match.test(i))
  return hit.sort((a, b) => a.length - b.length)[0] || null
}
// everything the person can pick right now (a key is set and the model really exists there)
export async function availableCatalog() {
  const out = []
  for (const e of CATALOG) {
    let from = null
    for (const p of e.providers) { if (await resolve(e, p)) { from = p; break } }
    if (from) out.push({ id: catId(e), label: e.label, tier: e.tier, cost: e.cost, speed: e.speed, power: e.power, badge: e.badge, best: e.best, weak: e.weak, provider: PROVIDERS[from].name })
  }
  return out
}
