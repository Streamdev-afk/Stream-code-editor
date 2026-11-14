import { useEffect, useState } from 'react'
import Icon from './Icon'
import { createLink, listLinks, revokeLink } from '../lib/links'

/** Create a link that lets a coding AI character from the ION app work on this session. */
export default function LinkPanel({ sessionId, sessionTitle, onClose, onChanged }) {
  const [links, setLinks] = useState([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [copied, setCopied] = useState('')

  const load = async () => { try { setLinks(await listLinks(sessionId)) } catch { /* ignore */ } }
  useEffect(() => { load() }, [sessionId])

  const make = async () => {
    setBusy(true); setErr('')
    try { await createLink(sessionId, sessionTitle); await load(); onChanged?.() }
    catch (e) { setErr(e.message) }
    setBusy(false)
  }
  const copy = async (token) => {
    try { await navigator.clipboard.writeText(token); setCopied(token); setTimeout(() => setCopied(''), 1800) } catch { setErr('Copy failed. Select the code and copy it by hand.') }
  }
  const revoke = async (token) => { await revokeLink(token); await load(); onChanged?.() }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal team-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-group"><span className="modal-icon"><Icon name="globe" size={14} /></span><h3>Connect an AI</h3></div>
          <button className="modal-close" onClick={onClose} aria-label="Close"><Icon name="close" size={16} /></button>
        </div>
        <div className="team-body">
          <p className="team-hint">
            Make a link, then paste it into a chat with any character from the ION app that has the coding skill.
            It reads a short summary of this project, runs read-only terminal commands, and sends every change here for you to approve.
            Links last 30 days and only work for your account.
          </p>
          <button className="team-add" onClick={make} disabled={busy}>{busy ? 'Creating…' : '+ Create a link for this project'}</button>
          {err && <p className="team-hint" style={{ color: '#ff7a7a' }}>{err}</p>}
          <div className="team-list">
            {links.length === 0 && <p className="team-hint">No active links yet.</p>}
            {links.map((l) => (
              <div className="team-member" key={l.token}>
                <code className="link-code">{l.token}</code>
                <button className="team-mini" onClick={() => copy(l.token)}>{copied === l.token ? 'Copied' : 'Copy'}</button>
                <button className="team-mini" onClick={() => revoke(l.token)}>Revoke</button>
              </div>
            ))}
          </div>
          <p className="team-hint">Tip: the AI only sees files that are already saved to the cloud, so give it a few seconds after you edit.</p>
        </div>
      </div>
    </div>
  )
}
