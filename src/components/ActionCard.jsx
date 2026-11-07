import Icon from './Icon'

const INFO = {
  github_push: { icon: 'push', title: 'Push project to GitHub', note: 'Opens the push window. Nothing is sent until you confirm there.' },
  github_import: { icon: 'pull', title: 'Import from GitHub', note: 'Opens the import window. You pick the repo and confirm.' },
  run_preview: { icon: 'play', title: 'Run the live preview', note: 'Switches to the preview.' },
  run_tests: { icon: 'check', title: 'Check the project for errors', note: 'Runs the preview and reads its errors.' },
}

/** The AI can only PROPOSE these. Each one needs your click. */
export default function ActionCard({ actions, onApprove, onDismiss }) {
  return (
    <div className="action-card" role="dialog" aria-label="Qoders wants to do something">
      <div className="action-card-head"><Icon name="bolt" size={14} /> Qoders asks permission</div>
      {actions.map((a, i) => {
        const info = INFO[a.type]
        return (
          <div className="action-row" key={i}>
            <span className="action-ico"><Icon name={info.icon} size={16} /></span>
            <div className="action-text">
              <strong>{info.title}{a.repo ? `: ${a.repo}` : ''}</strong>
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
