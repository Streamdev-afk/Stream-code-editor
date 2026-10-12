import { useState, useEffect } from 'react'

const STATUS = {
  pending: 'pending',
  running: 'running',
  done: 'done',
  error: 'error',
}

export default function PlanningModal({
  plan,
  onApprove,
  onReject,
  stepStatuses = {},
  stepLogs = {},
  running = false,
  currentStepIndex = -1,
  errorMessage = null,
}) {
  const [editedSteps, setEditedSteps] = useState(() =>
    (plan?.steps || []).map((s) => ({ ...s, enabled: true }))
  )

  useEffect(() => {
    if (plan?.steps) {
      setEditedSteps(plan.steps.map((s) => ({ ...s, enabled: true })))
    }
  }, [plan])

  if (!plan) return null

  const toggleStep = (id) => {
    if (running) return
    setEditedSteps((steps) => steps.map((s) => s.id === id ? { ...s, enabled: !s.enabled } : s))
  }

  const enabledCount = editedSteps.filter((s) => s.enabled).length

  const icon = (status) => {
    if (status === STATUS.done) return '✅'
    if (status === STATUS.running) return '⏳'
    if (status === STATUS.error) return '❌'
    return '○'
  }

  return (
    <div className="modal-backdrop">
      <div className="modal wide planning-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-group">
            <span className="modal-icon">🧭</span>
            <div>
              <div className="modal-title">{plan.title || 'Plan'}</div>
              <div className="modal-subtitle">
                {plan.summary || 'Review each step before executing'}
              </div>
            </div>
          </div>
          <button className="modal-close" onClick={onReject} disabled={running}>✕</button>
        </div>

        <div className="planning-body">
          <div className="planning-steps">
            {editedSteps.map((step, idx) => {
              const status = stepStatuses[step.id] || STATUS.pending
              const isCurrent = running && idx === currentStepIndex

              return (
                <div
                  key={step.id}
                  className={`planning-step status-${status} ${!step.enabled ? 'disabled' : ''} ${isCurrent ? 'current' : ''}`}
                >
                  <div className="planning-step-head">
                    <button
                      className="planning-step-check"
                      onClick={() => toggleStep(step.id)}
                      disabled={running}
                      title={step.enabled ? 'Skip this step' : 'Include this step'}
                    >
                      {running ? (
                        <span className="planning-step-icon">{icon(status)}</span>
                      ) : (
                        <span className={`planning-step-checkbox ${step.enabled ? 'checked' : ''}`}>
                          {step.enabled ? '✓' : ''}
                        </span>
                      )}
                    </button>
                    <div className="planning-step-info">
                      <div className="planning-step-title">
                        <span className="planning-step-num">{step.id}</span>
                        {step.title}
                      </div>
                      <div className="planning-step-desc">{step.description}</div>
                      {step.files && step.files.length > 0 && (
                        <div className="planning-step-files">
                          {step.files.map((f) => (
                            <span key={f} className="planning-file-chip">{f}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {stepLogs[step.id] && (
                    <div className="planning-step-log">{stepLogs[step.id]}</div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {errorMessage && (
          <div className="planning-error">⚠️ {errorMessage}</div>
        )}

        <div className="modal-footer">
          <span className="modal-hint">
            {running
              ? `Executing step ${currentStepIndex + 1} of ${enabledCount}…`
              : `${enabledCount} of ${editedSteps.length} steps will run`}
          </span>
          <button className="btn-ghost" onClick={onReject} disabled={running}>
            Cancel
          </button>
          <button
            className="btn-accept"
            onClick={() => onApprove(editedSteps.filter((s) => s.enabled))}
            disabled={running || enabledCount === 0}
          >
            <span className="btn-check">▶</span>
            {running ? 'Running…' : `Execute ${enabledCount} step${enabledCount === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  )
}