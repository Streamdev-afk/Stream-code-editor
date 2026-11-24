import { useEffect, useState } from 'react'
import { API_BASE } from './api'

export const GROUPS = [
  { id: 'auto', title: 'Auto', sub: 'Default. Switches between the free models for you.' },
  { id: 'lighter', title: 'Lighter models', sub: 'Quick and cheap. Everyday chat, small edits, simple questions.' },
  { id: 'medium', title: 'Medium models', sub: 'Simple to complex tasks. A good balance of speed and strength.' },
  { id: 'higher', title: 'Higher-tier models', sub: 'Big coding tasks: full projects, refactors, hard bugs.' },
]
export const FRONTIER_NOTE = 'These are not the highest models yet. We are working on adding the newest frontier models here.'
export const groupOf = (m) => (m.id === 'auto' ? 'auto' : (m.power || 3) <= 2 ? 'lighter' : (m.power || 3) === 3 ? 'medium' : 'higher')

let cache = null
export function useCatalog() {
  const [cat, setCat] = useState(cache || [])
  useEffect(() => {
    if (cache) return
    fetch(`${API_BASE}/api/models/catalog`).then((r) => r.json()).then((j) => { cache = j.models || []; setCat(cache) }).catch(() => {})
  }, [])
  return cat.map((m) => ({ ...m, hint: `${m.provider} · ${m.cost} credit${m.cost > 1 ? 's' : ''} per use` }))
}
export const dots = (n) => '●'.repeat(n) + '○'.repeat(5 - n)
