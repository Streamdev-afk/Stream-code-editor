/** Small looping animations for what the AI is doing: thinking, writing, running, done.
 *  Pure SVG + CSS (no extra packages), styled in modern.css under .ai-anim. */
export default function AiAnim({ name = 'thinking', size = 40 }) {
  let art
  if (name === 'writing') {
    art = (
      <>
        <rect className="aa-line aa-l1" x="8" y="12" width="32" height="4" rx="2" />
        <rect className="aa-line aa-l2" x="8" y="22" width="24" height="4" rx="2" />
        <rect className="aa-line aa-l3" x="8" y="32" width="28" height="4" rx="2" />
        <rect className="aa-caret" x="8" y="10" width="3" height="8" rx="1" />
      </>
    )
  } else if (name === 'running') {
    art = (
      <>
        <circle className="aa-ring" cx="24" cy="24" r="16" fill="none" strokeWidth="4" strokeLinecap="round" />
        <path className="aa-chev" d="M19 18l8 6-8 6" fill="none" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
      </>
    )
  } else if (name === 'done') {
    art = (
      <>
        <circle className="aa-done-ring" cx="24" cy="24" r="17" fill="none" strokeWidth="4" />
        <path className="aa-check" d="M15 25l7 7 12-14" fill="none" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      </>
    )
  } else {
    art = (
      <>
        <circle className="aa-dot aa-d1" cx="12" cy="24" r="4.5" />
        <circle className="aa-dot aa-d2" cx="24" cy="24" r="4.5" />
        <circle className="aa-dot aa-d3" cx="36" cy="24" r="4.5" />
      </>
    )
  }
  return (
    <span className="ai-anim" style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 48 48" width="100%" height="100%" className={`aa aa-${name}`}>{art}</svg>
    </span>
  )
}
