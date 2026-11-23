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
  if (s.auth) h.Authorization = /^(bearer|basic)\s/i.test(s.auth) ? s.auth : `Bearer ${s.auth}`
  for (const r of s.headers || []) if (r && r.k && r.v) h[String(r.k).trim()] = String(r.v)
  return h
}

export async function addServer({ name, url, auth, headers, storeId }) {
  const rows = (Array.isArray(headers) ? headers : []).filter((r) => r && String(r.k || '').trim() && String(r.v || '').trim()).slice(0, 4).map((r) => ({ k: String(r.k).trim(), v: String(r.v).trim() }))
  const clean = { name: String(name || '').trim().replace(/[^\w .-]/g, '').slice(0, 40), url: String(url || '').trim(), auth: String(auth || '').trim(), headers: rows, storeId: storeId || '', enabled: true, tools: [] }
  if (!clean.name || !clean.url) throw new Error('Give it a name and a URL')
  const { tools } = await post('/api/mcp/tools', { url: clean.url, headers: headersOf(clean) })
  clean.tools = tools
  save([...getServers().filter((s) => s.name !== clean.name), clean])
  return clean
}

export async function refreshServer(name) {
  const s = getServers().find((x) => x.name === name)
  if (!s) return
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
    for (const t of s.tools || []) out.push({ server: s.name, name: t.name, description: t.description, schema: t.schema, required: t.required })
  }
  return out.slice(0, 40)
}

export async function callTool({ server, tool, args }) {
  const s = getServers().find((x) => x.name === server && x.enabled !== false)
  if (!s) throw new Error(`The extension "${server}" is not connected or is turned off`)
  if (!(s.tools || []).some((t) => t.name === tool)) throw new Error(`"${server}" has no tool named ${tool}`)
  return post('/api/mcp/call', { url: s.url, headers: headersOf(s), tool, args: args && typeof args === 'object' ? args : {} })
}
