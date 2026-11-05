import { API_BASE } from './api'
import { apiFetch } from './supabase'

export async function validateAndSaveToken(token) {
  const res = await apiFetch(`${API_BASE}/api/github/connect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

export async function getGitHubStatus() {
  const res = await apiFetch(`${API_BASE}/api/github/status`)
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

export async function disconnectGitHub() {
  const res = await apiFetch(`${API_BASE}/api/github/disconnect`, { method: 'POST' })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

export async function pushToGitHub({ repoName, isPrivate, files, sessionTitle }) {
  const res = await apiFetch(`${API_BASE}/api/github/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repoName, isPrivate, files, sessionTitle }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

export async function listUserRepos() {
  const res = await apiFetch(`${API_BASE}/api/github/repos`)
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data.repos
}

export async function pullFromGitHub({ owner, repo, branch }) {
  const res = await apiFetch(`${API_BASE}/api/github/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ owner, repo, branch }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}