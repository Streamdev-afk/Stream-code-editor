// ION Qoders session links: let any coding AI character from the ION app work on this editor session.
// Everything goes through Supabase (row level security keeps it private to the signed-in user).
import { supabase } from './supabase'

export async function createLink(sessionId, label = '') {
  const { data: u } = await supabase.auth.getUser()
  const uid = u?.user?.id
  if (!uid) throw new Error('Sign in first.')
  const { data, error } = await supabase
    .from('session_links')
    .insert({ user_id: uid, session_id: sessionId, label: String(label).slice(0, 60) })
    .select('token,expires_at,created_at')
    .single()
  if (error) throw new Error(/foreign key|violates/i.test(error.message) ? 'Your project is still saving to the cloud. Wait a few seconds and try again.' : error.message)
  return data
}

export async function listLinks(sessionId) {
  const { data } = await supabase
    .from('session_links')
    .select('token,created_at,expires_at,revoked,label')
    .eq('session_id', sessionId)
    .eq('revoked', false)
    .order('created_at', { ascending: false })
  return data || []
}

export async function revokeLink(token) {
  await supabase.from('session_links').update({ revoked: true }).eq('token', token)
}

export async function countLinks() {
  const { count } = await supabase.from('session_links').select('token', { count: 'exact', head: true }).eq('revoked', false)
  return count || 0
}

export async function pendingActions(sessionId) {
  const { data } = await supabase
    .from('link_actions')
    .select('id,type,payload,note,created_at')
    .eq('session_id', sessionId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(6)
  return data || []
}

export async function markAction(id, status) {
  await supabase.from('link_actions').update({ status, decided_at: new Date().toISOString() }).eq('id', id)
}
