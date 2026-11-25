import { STORE } from './extStore'
// MCP extensions: tool servers the AI may use. The list lives in this browser only.
import { API_BASE } from './api'
import { apiFetch } from './supabase'

const KEY = 'qoders-mcp-servers'

export function getServers() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]')
    return Array.isArray(v) ? v : []
  } catch { return [] }
}

function save(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)) } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent('qoders-mcp-changed'))
}

const post = async (path, body) => {
  const res = await apiFetch(`${API_BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`)
  return j
}

const headersOf = (s) => {
  const h = {}
  if (s.oauth?.access) h.Authorization = `Bearer ${s.oauth.access}`
  else if (s.auth) h.Authorization = /^(bearer|basic)\s/i.test(s.auth) ? s.auth : `Bearer ${s.auth}`
  for (const r of s.headers || []) if (r && r.k && r.v) h[String(r.k).trim()] = String(r.v)
  return h
}

export async function addServer({ name, url, auth, headers, storeId, oauth }) {
  const rows = (Array.isArray(headers) ? headers : []).filter((r) => r && String(r.k || '').trim() && String(r.v || '').trim()).slice(0, 4).map((r) => ({ k: String(r.k).trim(), v: String(r.v).trim() }))
  const clean = { name: String(name || '').trim().replace(/[^\w .-]/g, '').slice(0, 40), url: String(url || '').trim(), auth: String(auth || '').trim(), headers: rows, storeId: storeId || '', oauth: oauth || null, enabled: true, tools: [] }
  if (!clean.name || !clean.url) throw new Error('Give it a name and a URL')
  const { tools } = await post('/api/mcp/tools', { url: clean.url, headers: headersOf(clean) })
  clean.tools = tools
  save([...getServers().filter((s) => s.name !== clean.name), clean])
  return clean
}

// Signs in with OAuth in a popup. Call it straight from a click (before any await) so the popup is not blocked.
export function oauthSignIn({ url, clientId, clientSecret }) {
  const popup = window.open('about:blank', 'qoders-mcp-oauth', 'width=520,height=720')
  if (!popup) return Promise.reject(new Error('Allow pop-ups for this site, then try again'))
  const redirectUri = `${location.origin}/mcp-callback.html`
  return (async () => {
    try { localStorage.removeItem('qoders-mcp-oauth-result') } catch { /* ignore */ }
    let start
    try { start = await post('/api/mcp/oauth/start', { url, redirectUri, clientId: clientId || '', clientSecret: clientSecret || '' }) } catch (e) { popup.close(); throw e }
    popup.location.href = start.authUrl
    const result = await new Promise((resolve, reject) => {
      const done = (fn, v) => { clearInterval(timer); clearTimeout(limit); window.removeEventListener('message', onMsg); fn(v) }
      const onMsg = (e) => { if (e.origin === location.origin && e.data?.type === 'qoders-mcp-oauth') done(resolve, e.data) }
      window.addEventListener('message', onMsg)
      const timer = setInterval(() => {
        try {
          const r = JSON.parse(localStorage.getItem('qoders-mcp-oauth-result') || 'null')
          if (r && r.state === start.state) return done(resolve, r)
        } catch { /* ignore */ }
        if (popup.closed) done(reject, new Error('Sign-in window was closed'))
      }, 700)
      const limit = setTimeout(() => done(reject, new Error('Sign-in took too long')), 5 * 60 * 1000)
    })
    try { localStorage.removeItem('qoders-mcp-oauth-result') } catch { /* ignore */ }
    if (result.error) throw new Error(result.error)
    if (result.state !== start.state) throw new Error('Sign-in did not match, try again')
    const t = await post('/api/mcp/oauth/token', { code: result.code, verifier: start.verifier, clientId: start.clientId, clientSecret: start.clientSecret, redirectUri: start.redirectUri, tokenEndpoint: start.tokenEndpoint, resource: start.resource })
    return { access: t.access, refresh: t.refresh, exp: t.exp, clientId: start.clientId, clientSecret: start.clientSecret, tokenEndpoint: start.tokenEndpoint, resource: start.resource }
  })()
}

// Gets a fresh access token when the saved one is about to expire.
async function fresh(s) {
  if (!s.oauth || !s.oauth.refresh || s.oauth.exp - 60000 > Date.now()) return s
  try {
    const t = await post('/api/mcp/oauth/refresh', { refresh: s.oauth.refresh, clientId: s.oauth.clientId, clientSecret: s.oauth.clientSecret, tokenEndpoint: s.oauth.tokenEndpoint, resource: s.oauth.resource })
    const next = { ...s, oauth: { ...s.oauth, access: t.access, refresh: t.refresh, exp: t.exp } }
    save(getServers().map((x) => (x.name === s.name ? next : x)))
    return next
  } catch { throw new Error(`Sign in to "${s.name}" again (Settings → Extensions → Installed)`) }
}

export async function reconnect(name, opts = {}) {
  const s = getServers().find((x) => x.name === name)
  if (!s) return
  const oauth = await oauthSignIn({ url: s.url, ...opts })
  save(getServers().map((x) => (x.name === name ? { ...x, oauth } : x)))
}

export async function refreshServer(name) {
  let s = getServers().find((x) => x.name === name)
  if (!s) return
  s = await fresh(s)
  const { tools } = await post('/api/mcp/tools', { url: s.url, headers: headersOf(s) })
  save(getServers().map((x) => (x.name === name ? { ...x, tools } : x)))
}

export const removeServer = (name) => save(getServers().filter((s) => s.name !== name))
export const setEnabled = (name, enabled) => save(getServers().map((s) => (s.name === name ? { ...s, enabled } : s)))

/** Enabled tools, sent along with AI requests so the AI knows what it may propose. */
export function activeTools() {
  const out = []
  for (const s of getServers()) {
    if (s.enabled === false) continue
    const use = ((STORE.find((x) => x.id === s.storeId) || {}).use) || ''
    for (const t of s.tools || []) out.push({ server: s.name, name: t.name, description: t.description, schema: t.schema, required: t.required, use })
  }
  return out.slice(0, 40)
}

export async function callTool({ server, tool, args }) {
  let s = getServers().find((x) => x.name === server && x.enabled !== false)
  if (s) s = await fresh(s)
  if (!s) throw new Error(`The extension "${server}" is not connected or is turned off`)
  if (!(s.tools || []).some((t) => t.name === tool)) throw new Error(`"${server}" has no tool named ${tool}`)
  return post('/api/mcp/call', { url: s.url, headers: headersOf(s), tool, args: args && typeof args === 'object' ? args : {} })
}

export const extCatalog = () => {
  const have = new Set(getServers().map((x) => x.storeId).filter(Boolean))
  return STORE.map((x) => ({ id: x.id, name: x.name, desc: String(x.desc || '').slice(0, 80), on: have.has(x.id) }))
}
