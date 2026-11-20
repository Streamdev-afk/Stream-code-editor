import { useState } from 'react'
import Icon from './Icon'
import MinPill from './MinPill'

const INFO = {
  github_push: { icon: 'push', title: 'Push project to GitHub', note: 'Opens the push window. Nothing is sent until you confirm there.' },
  github_import: { icon: 'pull', title: 'Import from GitHub', note: 'Opens the import window. You pick the repo and confirm.' },
  run_preview: { icon: 'play', title: 'Run the live preview', note: 'Switches to the preview.' },
  write_file: { icon: 'filePlus', title: 'Write file', note: 'You will see the exact changes before anything is saved.' },
  edit_file: { icon: 'edit', title: 'Edit file', note: 'You will see the exact changes before anything is saved.' },
  delete_file: { icon: 'trash', title: 'Delete file', note: 'You will see what is removed before it happens.' },
  run_command: { icon: 'play', title: 'Run a command', note: '' },
  run_tests: { icon: 'check', title: 'Check the project for errors', note: 'Runs the preview and reads its errors.' },
}

/** The AI can only PROPOSE these. Each one needs your click. */
export default function ActionCard({ actions, onApprove, onDismiss, canRun = false }) {
  const cmds = actions.filter((x) => x.type === 'run_command')
  const [min, setMin] = useState(false)
  if (!actions.length) return null
  if (min) return <MinPill anim="thinking" title="Waiting for you" sub={`${actions.length} request${actions.length === 1 ? '' : 's'} need your answer`} onClick={() => setMin(false)} stack={1} />
  return (
    <div className="modal-backdrop action-backdrop">
    <div className="modal action-card" role="dialog" aria-label="Qoders wants to do something" onClick={(e) => e.stopPropagation()}>
      <div className="action-card-head">
        <Icon name="bolt" size={14} /> {actions.some((x) => x.fromIon) ? 'An ION AI asks permission' : 'Qoders asks permission'}
        <button className="modal-min" onClick={() => setMin(true)} title="Minimize">–</button>
      </div>
      {canRun && cmds.length > 1 && (
        <div className="action-all">
          <span>{cmds.length} commands, run one after another on your computer</span>
          <button className="action-btn ghost" onClick={() => cmds.forEach((c) => onApprove({ ...c, test: false }))}>Run all</button>
          <button className="action-btn" onClick={() => cmds.forEach((c) => onApprove({ ...c, test: true }))}>Run all &amp; test</button>
        </div>
      )}
      {actions.map((a, i) => {
        const info = INFO[a.type] || { icon: 'bolt', title: a.type, note: '' }
        return (
          <div className={`action-row ${a.fromIon ? 'from-ion' : ''}`} key={a.id || i}>
            <span className="action-ico"><Icon name={info.icon} size={16} /></span>
            <div className="action-text">
              <strong>{info.title}{a.path ? `: ${a.path}` : ''}{a.repo ? `: ${a.repo}` : ''}</strong>
              <span>{a.message || info.note}</span>
            </div>
            {a.type === 'run_command' ? (
              <>
                <code className="action-cmd">{a.command}</code>
                <button className="action-btn ghost" onClick={() => onDismiss(a)} title="Cancel. You can run it yourself.">No</button>
                {canRun ? (
                  <>
                    <button className="action-btn ghost" onClick={() => onApprove({ ...a, test: false })} title="Run it in the editor terminal">Run</button>
                    <button className="action-btn" onClick={() => onApprove({ ...a, test: true })} title="Run it and let the AI read the result and fix problems">Run &amp; test</button>
                  </>
                ) : (
                  <button className="action-btn" onClick={() => { try { navigator.clipboard.writeText(a.command) } catch {} onDismiss(a) }} title="Copy it, then run it on your computer">Copy</button>
                )}
              </>
            ) : (
              <>
                <button className="action-btn ghost" onClick={() => onDismiss(a)}>No</button>
                <button className="action-btn" onClick={() => onApprove(a)}>Allow</button>
              </>
            )}
          </div>
        )
      })}
    </div>
    </div>
  )
}
