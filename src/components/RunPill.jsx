import { useEffect, useState } from 'react'
import MinPill from './MinPill'

/** Shows on screen while a command runs in the terminal, and says when it is finished. */
export default function RunPill() {
  const [st, setSt] = useState(null) // { cmd, state: 'running' | 'done' | 'failed' | 'server' }
  useEffect(() => {
    let timer
    const start = (e) => {
      clearTimeout(timer)
      setSt({ cmd: e.detail?.cmd || 'command', state: 'running' })
    }
    const finish = (e) => {
      const d = e.detail || {}
      const state = d.running ? 'server' : d.code === 0 ? 'done' : 'failed'
      setSt({ cmd: d.cmd || 'command', state })
      clearTimeout(timer)
      timer = setTimeout(() => setSt((s) => (s && s.state !== 'running' ? null : s)), state === 'failed' ? 7000 : 4500)
    }
    window.addEventListener('qoders-run', start)
    window.addEventListener('qoders-run-done', finish)
    return () => { window.removeEventListener('qoders-run', start); window.removeEventListener('qoders-run-done', finish); clearTimeout(timer) }
  }, [])
  if (!st) return null
  const short = st.cmd.length > 46 ? `${st.cmd.slice(0, 46)}…` : st.cmd
  const title = st.state === 'running' ? 'Running…' : st.state === 'done' ? 'Finished' : st.state === 'server' ? 'Running in the terminal' : 'Failed'
  return (
    <MinPill
      anim={st.state === 'running' ? 'running' : st.state === 'failed' ? 'thinking' : 'done'}
      title={title}
      sub={short}
      onClick={() => { window.dispatchEvent(new CustomEvent('qoders-open-terminal')); setSt(null) }}
    />
  )
}
