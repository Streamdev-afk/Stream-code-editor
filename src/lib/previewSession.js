import { API_BASE } from './api'

// Manages the preview session — creates once, updates as files change
let sessionId = null
let lastPayloadHash = null
let pending = null

async function hashFiles(files) {
  const json = JSON.stringify(
    Object.fromEntries(
      Object.entries(files).map(([p, f]) => [p, f.content])
    )
  )
  // Tiny hash — not crypto, just dedupe
  let h = 0
  for (let i = 0; i < json.length; i++) {
    h = ((h << 5) - h + json.charCodeAt(i)) | 0
  }
  return h.toString(36)
}

export async function syncPreview(files, activeFile) {
  const json = JSON.stringify({
    files: Object.fromEntries(
      Object.entries(files).map(([p, f]) => [p, f.content])
    ),
    activeFile,
  })
  let h = 0
  for (let i = 0; i < json.length; i++) {
    h = ((h << 5) - h + json.charCodeAt(i)) | 0
  }
  const hash = h.toString(36)
  if (hash === lastPayloadHash) return sessionId
  lastPayloadHash = hash

  if (pending) return pending

  pending = (async () => {
    try {
      const res = await fetch(`${API_BASE}/api/preview/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, files, activeFile }),
      })
      const data = await res.json()
      sessionId = data.sessionId
      return sessionId
    } catch (e) {
      console.warn('Preview sync failed:', e)
      return sessionId
    } finally {
      pending = null
    }
  })()

  return pending
}

export function getSessionId() {
  return sessionId
}

export function getPreviewUrl() {
  if (!sessionId) return null
  return `${API_BASE}/preview/${sessionId}/`
}