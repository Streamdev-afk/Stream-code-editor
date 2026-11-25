import { API_BASE } from './api'
import { apiFetch } from './supabase'

export async function searchImages(q) {
  const res = await apiFetch(`${API_BASE}/api/images?q=${encodeURIComponent(q)}`)
  const j = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`)
  return j.images || []
}

export async function fetchImageData(url) {
  const res = await apiFetch(`${API_BASE}/api/images/fetch?url=${encodeURIComponent(url)}`)
  const j = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`)
  return j.dataUrl
}
