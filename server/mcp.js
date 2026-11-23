// MCP (Model Context Protocol) bridge: lets the editor AI use tools from remote MCP servers
// (streamable HTTP). The browser keeps the server list; this only forwards calls, with safety checks.
import dns from 'node:dns/promises'
import net from 'node:net'

const TIMEOUT = 20000
const MAX_BYTES = 400000
const hits = new Map()

function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number)
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)
  }
  const v = ip.toLowerCase()
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('::ffff:')
}

async function safeUrl(raw) {
  let u
  try { u = new URL(String(raw)) } catch { throw new Error('That is not a valid URL') }
  if (u.protocol !== 'https:') throw new Error('MCP servers must use https://')
  if (u.username || u.password) throw new Error('Do not put a password in the URL')
  const host = u.hostname.replace(/^\[|\]$/g, '')
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(host)) throw new Error('Local addresses are not allowed')
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true })
  if (!addrs.length || addrs.some((a) => privateIp(a.address))) throw new Error('Private network addresses are not allowed')
  return u.toString()
}

function cleanHeaders(h) {
  const out = {}
  if (h && typeof h === 'object') {
    for (const [k, v] of Object.entries(h).slice(0, 5)) {
      if (/^[A-Za-z0-9-]{1,40}$/.test(k) && typeof v === 'string' && v.length < 600 && !/^(host|content-length|connection)$/i.test(k)) out[k] = v
    }
  }
  return out
}

async function rpc(url, headers, sessionId, method, params, id) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT)
  try {
    const res = await fetch(url, {
      method: 'POST',
      redirect: 'error',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
        ...headers,
      },
      body: JSON.stringify({ jsonrpc: '2.0', ...(id != null ? { id } : {}), method, ...(params ? { params } : {}) }),
    })
    const sid = res.headers.get('mcp-session-id') || sessionId
    if (id == null) return { sid }
    if (!res.ok) throw new Error(`Server answered HTTP ${res.status}`)
    let text = ''
    const reader = res.body.getReader()
    let bytes = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.length
      if (bytes > MAX_BYTES) { ctrl.abort(); throw new Error('The answer was too big') }
      text += Buffer.from(value).toString('utf8')
    }
    let msg = null
    if ((res.headers.get('content-type') || '').includes('text/event-stream')) {
      for (const block of text.split(/\n\n/)) {
        const data = block.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('')
        if (!data) continue
        try { const j = JSON.parse(data); if (j.id === id) msg = j } catch { /* skip */ }
      }
    } else {
      try { msg = JSON.parse(text) } catch { /* handled below */ }
    }
    if (!msg) throw new Error('The server sent no readable answer')
    if (msg.error) throw new Error(String(msg.error.message || 'The tool failed').slice(0, 300))
    return { result: msg.result, sid }
  } finally { clearTimeout(timer) }
}

async function session(url, headers) {
  const init = await rpc(url, headers, null, 'initialize', {
    protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'ion-qoders', version: '1.0.0' },
  }, 1)
  await rpc(url, headers, init.sid, 'notifications/initialized').catch(() => {})
  return init.sid
}

function limited(req) {
  const k = req.user?.id || req.ip
  const now = Date.now()
  const arr = (hits.get(k) || []).filter((t) => now - t < 60000)
  if (arr.length >= 30) return true
  arr.push(now); hits.set(k, arr)
  return false
}

export default function registerMcp(app) {
  const guard = (req, res) => {
    if (!req.isAuth || !req.user?.id) { res.status(401).json({ error: 'Sign in to use extensions' }); return true }
    if (limited(req)) { res.status(429).json({ error: 'Slow down a little' }); return true }
    return false
  }

  app.post('/api/mcp/tools', async (req, res) => {
    if (guard(req, res)) return
    try {
      const url = await safeUrl(req.body?.url)
      const headers = cleanHeaders(req.body?.headers)
      const sid = await session(url, headers)
      const { result } = await rpc(url, headers, sid, 'tools/list', {}, 2)
      const tools = (result?.tools || []).slice(0, 40).map((t) => ({
        name: String(t.name).slice(0, 80),
        description: String(t.description || '').slice(0, 300),
        schema: JSON.stringify(t.inputSchema?.properties ? Object.fromEntries(Object.entries(t.inputSchema.properties).slice(0, 12).map(([k, v]) => [k, v?.type || 'any'])) : {}),
        required: Array.isArray(t.inputSchema?.required) ? t.inputSchema.required.slice(0, 12) : [],
      }))
      res.json({ tools })
    } catch (e) { res.status(400).json({ error: String(e.message || e).slice(0, 300) }) }
  })

  app.post('/api/mcp/call', async (req, res) => {
    if (guard(req, res)) return
    try {
      const url = await safeUrl(req.body?.url)
      const headers = cleanHeaders(req.body?.headers)
      const name = String(req.body?.tool || '').slice(0, 80)
      if (!name) return res.status(400).json({ error: 'No tool named' })
      const args = req.body?.args && typeof req.body.args === 'object' && !Array.isArray(req.body.args) ? req.body.args : {}
      if (JSON.stringify(args).length > 20000) return res.status(400).json({ error: 'The input is too long' })
      const sid = await session(url, headers)
      const { result } = await rpc(url, headers, sid, 'tools/call', { name, arguments: args }, 3)
      const text = (result?.content || []).map((c) => (c.type === 'text' ? c.text : `[${c.type}]`)).join('\n').slice(0, 12000)
      res.json({ text: text || '(no output)', isError: !!result?.isError })
    } catch (e) { res.status(400).json({ error: String(e.message || e).slice(0, 300) }) }
  })
}
