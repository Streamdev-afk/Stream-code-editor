/**
 * Supabase sync layer for sessions.
 * Uses the anon client — RLS policies enforce user ownership.
 */

import { supabase } from './supabase'

export function isSyncAvailable() {
  return !!supabase
}

/**
 * Load all sessions for the current user, with messages and files.
 * Returns an array shaped exactly like the local sessionStore.sessions shape.
 */
export async function loadRemoteSessions() {
  if (!supabase) return []

  // 1. Load all sessions
  const { data: sessions, error: sErr } = await supabase
    .from('sessions')
    .select('*')
    .order('updated_at', { ascending: false })

  if (sErr) throw sErr
  if (!sessions || sessions.length === 0) return []

  const sessionIds = sessions.map((s) => s.id)

  // 2. Load all messages + files for those sessions
  const [{ data: messages, error: mErr }, { data: files, error: fErr }] = await Promise.all([
    supabase.from('session_messages').select('*').in('session_id', sessionIds).order('id', { ascending: true }),
    supabase.from('session_files').select('*').in('session_id', sessionIds),
  ])

  if (mErr) throw mErr
  if (fErr) throw fErr

  // 3. Group by session
  const messagesBySession = {}
  for (const m of messages || []) {
    if (!messagesBySession[m.session_id]) messagesBySession[m.session_id] = []
    messagesBySession[m.session_id].push({
      role: m.role,
      text: m.text,
      time: m.time,
    })
  }

  const filesBySession = {}
  for (const f of files || []) {
    if (!filesBySession[f.session_id]) filesBySession[f.session_id] = {}
    filesBySession[f.session_id][f.path] = {
      content: f.content,
      language: f.language,
    }
  }

  // 4. Build the sessions array
  return sessions.map((s) => {
    const files = filesBySession[s.id] || {}
    const fileList = Object.keys(files)
    return {
      id: s.id,
      title: s.title,
      createdAt: new Date(s.created_at).getTime(),
      updatedAt: new Date(s.updated_at).getTime(),
      messages: messagesBySession[s.id] || [],
      files,
      openTabs: fileList.slice(0, 3),  // sensible default
      activeFile: fileList[0] || '',
      history: [],  // history isn't synced (too heavy, per-machine)
    }
  })
}

/**
 * Upsert a full session (metadata + messages + files).
 * This is the "save everything" operation.
 */
export async function saveRemoteSession(session, userId) {
  if (!supabase) return
  if (!userId) return

  // 1. Upsert session row
  const { error: sErr } = await supabase
    .from('sessions')
    .upsert({
      id: session.id,
      user_id: userId,
      title: session.title,
      created_at: new Date(session.createdAt).toISOString(),
      updated_at: new Date(session.updatedAt || Date.now()).toISOString(),
    }, { onConflict: 'id' })

  if (sErr) throw sErr

  // 2. Replace messages (delete + insert for simplicity)
  const { error: mDelErr } = await supabase
    .from('session_messages')
    .delete()
    .eq('session_id', session.id)

  if (mDelErr) throw mDelErr

  if (Array.isArray(session.messages) && session.messages.length > 0) {
    const rows = session.messages.map((m) => ({
      session_id: session.id,
      role: m.role,
      text: m.text || '',
      time: m.time || Date.now(),
    }))
    const { error: mInsErr } = await supabase.from('session_messages').insert(rows)
    if (mInsErr) throw mInsErr
  }

  // 3. Replace files (delete + insert for simplicity)
  const { error: fDelErr } = await supabase
    .from('session_files')
    .delete()
    .eq('session_id', session.id)

  if (fDelErr) throw fDelErr

  const fileEntries = Object.entries(session.files || {})
  if (fileEntries.length > 0) {
    const rows = fileEntries.map(([path, f]) => ({
      session_id: session.id,
      path,
      content: f.content || '',
      language: f.language || 'plaintext',
    }))
    const { error: fInsErr } = await supabase.from('session_files').insert(rows)
    if (fInsErr) throw fInsErr
  }
}

/**
 * Delete a session (cascades to messages and files via FK).
 */
export async function deleteRemoteSession(sessionId) {
  if (!supabase) return
  const { error } = await supabase.from('sessions').delete().eq('id', sessionId)
  if (error) throw error
}

/**
 * Upload a batch of sessions (used during merge after sign-in).
 */
export async function uploadSessionBatch(sessions, userId) {
  if (!supabase) return
  for (const session of sessions) {
    try {
      await saveRemoteSession(session, userId)
    } catch (err) {
      console.warn('Failed to sync session', session.id, err.message)
    }
  }
}