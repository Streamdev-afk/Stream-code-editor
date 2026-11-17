import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from './Icon'
import { listCharacters, getTeamMembers, setTeamMembers, getPersonaChoice, setPersonaChoice, MAX_TEAM } from '../lib/team'

/** Team members (2 to 8 AIs) + the character that answers in normal chat. Characters come from the ION app. */
export default function TeamPanel({ onClose }) {
  const [members, setMembers] = useState(getTeamMembers)
  const [persona, setPersona] = useState(getPersonaChoice)
  const [chars, setChars] = useState(null)

  useEffect(() => { listCharacters().then(setChars) }, [])
  useEffect(() => { setTeamMembers(members) }, [members])

  const addDefault = () => members.length < MAX_TEAM && setMembers((m) => [...m, { id: `w${Date.now()}`, name: `Worker ${m.length + 1}` }])
  const addChar = (c) => members.length < MAX_TEAM && setMembers((m) => [...m, { id: `c${c.id}${Date.now()}`, name: c.name, charId: c.id }])
  const remove = (id) => members.length > 2 && setMembers((m) => m.filter((x) => x.id !== id))
  const pick = (c) => { const v = c ? { charId: c.id, name: c.name } : null; setPersona(v); setPersonaChoice(v) }

  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal team-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-group"><span className="modal-icon"><Icon name="bot" size={14} /></span><h3>Team and characters</h3></div>
          <button className="modal-close" onClick={onClose} aria-label="Close"><Icon name="close" size={16} /></button>
        </div>
        <div className="team-body">
          <section>
            <h4>Team ({members.length} AIs)</h4>
            <p className="team-hint">Each AI builds its own part at the same time. Add up to {MAX_TEAM}. Characters remember your chats from the ION app.</p>
            <div className="team-list">
              {members.map((m, i) => (
                <div className="team-member" key={m.id}>
                  <span className="team-num">{i + 1}</span>
                  <span className="team-name">{m.name}{m.charId ? ' · character' : ''}</span>
                  <button className="team-x" disabled={members.length <= 2} onClick={() => remove(m.id)} title="Remove">×</button>
                </div>
              ))}
            </div>
            <button className="team-add" onClick={addDefault} disabled={members.length >= MAX_TEAM}>+ Add AI worker</button>
          </section>

          <section>
            <h4>Your ION characters</h4>
            {chars === null && <p className="team-hint">Loading…</p>}
            {chars && chars.length === 0 && <p className="team-hint">No characters found. Sign in with the same account you use in the ION app.</p>}
            <div className="team-chars">
              {(chars || []).map((c) => (
                <div className={`team-char ${c.canCode ? '' : 'off'}`} key={c.id}>
                  <div className="team-char-info">
                    <strong>{c.name}</strong>
                    <span>{c.canCode ? (c.tagline || 'Can code') : "Doesn't have the coding skill"}</span>
                  </div>
                  {c.canCode && (
                    <>
                      <button className="team-mini" onClick={() => addChar(c)} disabled={members.length >= MAX_TEAM}>Add to team</button>
                      <button className={`team-mini ${persona?.charId === c.id ? 'on' : ''}`} onClick={() => pick(persona?.charId === c.id ? null : c)}>
                        {persona?.charId === c.id ? 'Chatting as' : 'Use in chat'}
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
            {persona && <p className="team-hint">Chat and Agent replies now use {persona.name}'s voice and memories. <button className="team-link" onClick={() => pick(null)}>Back to normal</button></p>}
          </section>
        </div>
      </div>
    </div>,
    document.body
  )
}
