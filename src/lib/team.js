// Team + character settings (kept in localStorage so every request can read them without prop-drilling)
import { supabase } from './supabase'

const KT = 'qoders-team'
const KP = 'qoders-persona'
const MAX_MEMBERS = 8

const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d } catch { return d } }
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} }

// ---- team members: [{ id, name, charId? }] ; lanes = members.length (2..8)
export function getTeamMembers() {
  const m = read(KT, null)
  if (Array.isArray(m) && m.length >= 2) return m.slice(0, MAX_MEMBERS)
  return [1, 2, 3].map((n) => ({ id: `w${n}`, name: `Worker ${n}` }))
}
export function setTeamMembers(list) { write(KT, (list || []).slice(0, MAX_MEMBERS)) }
export const MAX_TEAM = MAX_MEMBERS

// ---- single persona for normal chat / agent: { charId, name } | null
export function getPersonaChoice() { return read(KP, null) }
export function setPersonaChoice(c) { write(KP, c || null) }

// persona text cache (memory is refreshed at most every 2 minutes)
const cache = new Map()

// ---- characters from the ION app (same Supabase account) ----
export const canCode = (c) => (c?.skills || []).some((s) => /cod(e|ing)|program|develop|dev\b/i.test(s))

export async function listCharacters() {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('characters')
    .select('id,name,tagline,skills,avatar_url')
    .order('created_at', { ascending: false })
    .limit(60)
  if (error) { console.warn('[characters]', error.message); return [] }
  return (data || []).map((c) => ({ ...c, canCode: canCode(c) }))
}

const level = (n) => (n >= 8 ? 'very high' : n >= 5 ? 'medium' : 'low')

// Build a compact persona prompt (identity + voice + what they remember about this user)
export async function loadPersona(charId) {
  if (!supabase || !charId) return null
  const hit = cache.get(charId)
  if (hit && Date.now() - hit.at < 120000) return hit.value
  const { data: u } = await supabase.auth.getUser()
  const uid = u?.user?.id
  const [{ data: c }, bond, mem, chat] = await Promise.all([
    supabase.from('characters').select('*').eq('id', charId).maybeSingle(),
    uid ? supabase.from('character_bonds').select('notes,slang,learned').eq('user_id', uid).eq('character_id', charId).maybeSingle() : { data: null },
    uid ? supabase.from('user_memories').select('fact').eq('user_id', uid).or(`character_id.eq.${charId},character_id.is.null`).order('created_at', { ascending: false }).limit(12) : { data: [] },
    uid ? supabase.from('chats').select('id,summary,relationship').eq('user_id', uid).eq('character_id', charId).order('created_at', { ascending: false }).limit(1).maybeSingle() : { data: null },
  ])
  if (!c) return null
  let recent = []
  if (chat?.data?.id) {
    const { data: msgs } = await supabase.from('messages').select('role,content').eq('chat_id', chat.data.id).order('created_at', { ascending: false }).limit(6)
    recent = (msgs || []).reverse()
  }
  const p = c.personality || {}
  const st = c.style || {}
  const lines = [
    `You are ${c.name}${c.tagline ? `, ${c.tagline}` : ''}.`,
    c.bio ? `About you: ${String(c.bio).slice(0, 300)}` : '',
    `Personality: humor ${level(p.humor)}, sarcasm ${level(p.sarcasm)}, roast ${level(p.roast)}, friendliness ${level(p.friendliness)}, patience ${level(p.patience)}.`,
    `Style: emoji ${st.emoji || 'some'}, slang ${st.slang || 'medium'}, replies ${st.length || 'short'}.`,
    (c.quirks || []).length ? `Quirks: ${c.quirks.join(', ')}.` : '',
    c.custom_prompt ? `Your own instructions: ${String(c.custom_prompt).slice(0, 500)}` : '',
    bond?.data?.notes ? `What you know about this user: ${String(bond.data.notes).slice(0, 400)}` : '',
    (bond?.data?.slang || []).length ? `Words you and the user use: ${bond.data.slang.slice(0, 12).join(', ')}.` : '',
    (mem?.data || []).length ? `Things you remember about the user: ${mem.data.map((m) => m.fact).join('; ').slice(0, 600)}` : '',
    chat?.data?.summary ? `Summary of your past chats with the user: ${String(chat.data.summary).slice(0, 500)}` : '',
    recent.length ? `Your last messages together:\n${recent.map((m) => `${m.role === 'user' ? 'User' : c.name}: ${String(m.content).slice(0, 160)}`).join('\n')}` : '',
  ].filter(Boolean).join('\n')
  const value = { id: c.id, name: c.name, canCode: canCode(c), persona: lines }
  cache.set(charId, { at: Date.now(), value })
  return value
}

// Team members with their persona text loaded (default workers have no persona)
export async function loadTeam() {
  const members = getTeamMembers()
  return Promise.all(members.map(async (m) => {
    if (!m.charId) return { ...m, persona: '' }
    const p = await loadPersona(m.charId).catch(() => null)
    return { ...m, name: p?.name || m.name, persona: p?.persona || '' }
  }))
}

export async function loadActivePersona() {
  const ch = getPersonaChoice()
  if (!ch?.charId) return ''
  const p = await loadPersona(ch.charId).catch(() => null)
  return p?.persona || ''
}
