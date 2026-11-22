import { AsyncLocalStorage } from 'node:async_hooks'

// Bring-your-own-key: the browser sends its own provider key per request.
// The key lives only in memory for that request, is never logged, never stored.
const store = new AsyncLocalStorage()
export const getByok = () => store.getStore() || null

const PRESETS = {
  openrouter: 'https://openrouter.ai/api/v1',
  openai: 'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com/v1',
  together: 'https://api.together.xyz/v1',
  groq: 'https://api.groq.com/openai/v1',
  mistral: 'https://api.mistral.ai/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
  anthropic: 'https://api.anthropic.com/v1',
  xai: 'https://api.x.ai/v1',
  cerebras: 'https://api.cerebras.ai/v1',
  nvidia: 'https://integrate.api.nvidia.com/v1',
  fireworks: 'https://api.fireworks.ai/inference/v1',
}

const authHeaders = (cfg) => ({
  Authorization: `Bearer ${cfg.key}`,
  ...(cfg.provider === 'anthropic' ? { 'x-api-key': cfg.key, 'anthropic-version': '2023-06-01' } : {}),
})

function privateHost(h) {
  h = h.toLowerCase()
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return true
  if (/^\[.*\]$/.test(h) || h.includes(':')) return true // IPv6 literals
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (!m) return false
  const [a, b] = [Number(m[1]), Number(m[2])]
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
}

export function readByok(req, needModel = true) {
  const key = String(req.headers['x-ai-key'] || '').trim()
  const model = String(req.headers['x-ai-model'] || '').trim()
  if (!key || (needModel && !model)) return null
  const provider = String(req.headers['x-ai-provider'] || '').trim().toLowerCase()
  let base = provider === 'custom' ? String(req.headers['x-ai-base'] || '').trim() : PRESETS[provider]
  if (!base) return { error: 'Unknown AI provider.' }
  base = base.replace(/\/+$/, '')
  let u
  try { u = new URL(base) } catch { return { error: 'The base URL is not valid.' } }
  if (u.protocol !== 'https:') return { error: 'The base URL must start with https://' }
  if (privateHost(u.hostname)) return { error: 'That address is not allowed.' }
  return { key, model, base, provider }
}

export function byokMiddleware(req, res, next) {
  const cfg = readByok(req)
  if (!cfg) return next()
  if (cfg.error) return res.status(400).json({ error: cfg.error })
  req.byok = true
  store.run(cfg, next)
}

const SKIP = new Set(['__fb', 'reasoning_effort', 'reasoning_format', 'tools', 'tool_choice', 'service_tier'])

// one signal that fires when either the given signal aborts or the time runs out
function linkSignals(sig, ms) {
  const c = new AbortController()
  const t = setTimeout(() => c.abort(), ms)
  sig.addEventListener('abort', () => { clearTimeout(t); c.abort() })
  return c.signal
}

// Calls an OpenAI-compatible /chat/completions endpoint. Returns the same shape the
// Groq SDK gives: an async iterable of chunks when streaming, otherwise the JSON body.
export async function byokCreate(params, cfg) {
  const body = {}
  for (const [k, v] of Object.entries(params)) if (!SKIP.has(k) && v !== undefined) body[k] = v
  body.model = cfg.model
  if (body.max_tokens && body.max_tokens > 16000) body.max_tokens = 16000
  const res = await fetch(`${cfg.base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(cfg) },
    body: JSON.stringify(body),
    signal: cfg.abort ? linkSignals(cfg.abort, 300000) : AbortSignal.timeout(300000),
  })
  if (!res.ok) {
    let msg = ''
    try { const j = await res.json(); msg = j?.error?.message || j?.message || '' } catch {}
    const err = new Error(msg || `Your AI provider answered ${res.status}`)
    err.status = res.status
    err.byok = true
    throw err
  }
  if (!body.stream) return await res.json()
  return (async function* () {
    const dec = new TextDecoder()
    let buf = ''
    for await (const part of res.body) {
      buf += dec.decode(part, { stream: true })
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim()
        buf = buf.slice(i + 1)
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (data === '[DONE]') return
        try { yield JSON.parse(data) } catch {}
      }
    }
  })()
}

export function byokError(err) {
  const s = err?.status
  if (s === 401 || s === 403) return 'Your API key was rejected by the provider. Check the key in Settings → AI models.'
  if (s === 402) return 'Your provider says the account is out of credit.'
  if (s === 404) return 'The provider could not find that model name. Check it in Settings → AI models.'
  if (s === 429) return 'Your provider is rate limiting this key. Wait a moment and try again.'
  return `Your AI provider returned an error: ${String(err?.message || 'unknown').slice(0, 200)}`
}

const NOT_CHAT = /embed|whisper|tts|speech|moderation|dall-e|image|audio|realtime|transcribe|rerank|guard|vision-preview-old|babbage|davinci|ada\b/i

// Which models are free to use today with this kind of key (free tiers), so people are not shown models they cannot use.
const freeFor = (cfg, arr, ids) => {
  if (cfg.provider === 'openrouter' || /openrouter\.ai/.test(cfg.base)) {
    return arr.filter((m) => typeof m === 'object' && m && (/:free$/.test(m.id) || (m.pricing && Number(m.pricing.prompt) === 0 && Number(m.pricing.completion) === 0))).map((m) => m.id)
  }
  if (cfg.provider === 'gemini') return ids.filter((id) => /flash|gemma/i.test(id) && !/preview-image|image|live|tts/i.test(id))
  if (['groq', 'cerebras', 'nvidia'].includes(cfg.provider)) return ids
  return []
}

// Asks the provider which models this key may use.
export async function listModels(cfg) {
  const res = await fetch(`${cfg.base}/models${cfg.provider === 'gemini' ? '?pageSize=200' : ''}`, {
    headers: authHeaders(cfg),
    signal: AbortSignal.timeout(20000),
  })
  if (!res.ok) {
    let msg = ''
    try { const j = await res.json(); msg = j?.error?.message || j?.message || '' } catch {}
    const err = new Error(msg || `Provider answered ${res.status}`)
    err.status = res.status
    throw err
  }
  const j = await res.json()
  const arr = Array.isArray(j) ? j : j.data || j.models || []
  const strip = (id) => String(id).replace(/^models\//, '')
  const ids = [...new Set(arr.map((m) => (typeof m === 'string' ? m : m.id || m.name)).filter(Boolean).map(strip))].filter((id) => !NOT_CHAT.test(id)).sort((a, b) => a.localeCompare(b)).slice(0, 600)
  const set = new Set(ids)
  const free = freeFor(cfg, arr.map((m) => (typeof m === 'object' && m ? { ...m, id: strip(m.id || m.name || '') } : m)), ids).filter((id) => set.has(id))
  return { models: ids, free }
}
