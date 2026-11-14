import Icon from './Icon'

const INFO = {
  github_push: { icon: 'push', title: 'Push project to GitHub', note: 'Opens the push window. Nothing is sent until you confirm there.' },
  github_import: { icon: 'pull', title: 'Import from GitHub', note: 'Opens the import window. You pick the repo and confirm.' },
  run_preview: { icon: 'play', title: 'Run the live preview', note: 'Switches to the preview.' },
  write_file: { icon: 'filePlus', title: 'Write file', note: 'You will see the exact changes before anything is saved.' },
  edit_file: { icon: 'edit', title: 'Edit file', note: 'You will see the exact changes before anything is saved.' },
  delete_file: { icon: 'trash', title: 'Delete file', note: 'You will see what is removed before it happens.' },
  run_tests: { icon: 'check', title: 'Check the project for errors', note: 'Runs the preview and reads its errors.' },
}

/** The AI can only PROPOSE these. Each one needs your click. */
export default function ActionCard({ actions, onApprove, onDismiss }) {
  return (
    <div className="action-card" role="dialog" aria-label="Qoders wants to do something">
      <div className="action-card-head"><Icon name="bolt" size={14} /> {actions.some((x) => x.fromIon) ? 'An ION AI asks permission' : 'Qoders asks permission'}</div>
      {actions.map((a, i) => {
        const info = INFO[a.type] || { icon: 'bolt', title: a.type, note: '' }
        return (
          <div className={`action-row ${a.fromIon ? 'from-ion' : ''}`} key={a.id || i}>
            <span className="action-ico"><Icon name={info.icon} size={16} /></span>
            <div className="action-text">
              <strong>{info.title}{a.path ? `: ${a.path}` : ''}{a.repo ? `: ${a.repo}` : ''}</strong>
              <span>{a.message || info.note}</span>
            </div>
            <button className="action-btn ghost" onClick={() => onDismiss(a)}>No</button>
            <button className="action-btn" onClick={() => onApprove(a)}>Allow</button>
          </div>
        )
      })}
    </div>
  )
}
