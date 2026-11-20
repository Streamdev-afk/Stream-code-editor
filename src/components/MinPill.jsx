import AiAnim from './AiAnim'

/** What a minimized window turns into: a small pill that shows what is happening. Click it to open the window again. */
export default function MinPill({ anim = 'running', title, sub, onClick, stack = 0 }) {
  return (
    <button className={`min-pill ${anim === 'done' ? 'is-done' : ''}`} style={{ bottom: 20 + stack * 62 }} onClick={onClick} title="Open">
      <AiAnim name={anim} size={34} />
      <span className="min-pill-text">
        <strong>{title}</strong>
        {sub && <span>{sub}</span>}
      </span>
    </button>
  )
}
