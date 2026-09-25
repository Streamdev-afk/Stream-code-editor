import { THEMES } from '../lib/settings'

function Row({ label, hint, children }) {
  return (
    <div className="settings-row">
      <div className="settings-row-info">
        <div className="settings-row-label">{label}</div>
        {hint && <div className="settings-row-hint">{hint}</div>}
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  )
}

function Toggle({ value, onChange }) {
  return (
    <button
      className={`toggle ${value ? 'on' : 'off'}`}
      onClick={() => onChange(!value)}
      type="button"
    >
      <span className="toggle-knob" />
    </button>
  )
}

export default function SettingsModal({ settings, onChange, onClose }) {
  const set = (key, value) => onChange({ ...settings, [key]: value })

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-group">
            <span className="modal-icon">⚙</span>
            <div>
              <div className="modal-title">Settings</div>
              <div className="modal-subtitle">Preferences save automatically</div>
            </div>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="settings-body">

          <div className="settings-section">
            <div className="settings-section-title">Editor</div>

            <Row label="Font size" hint="Applies to the code editor">
              <div className="settings-number">
                <button
                  className="settings-step"
                  onClick={() => set('fontSize', Math.max(10, settings.fontSize - 1))}
                >−</button>
                <span className="settings-value">{settings.fontSize}px</span>
                <button
                  className="settings-step"
                  onClick={() => set('fontSize', Math.min(24, settings.fontSize + 1))}
                >＋</button>
              </div>
            </Row>

            <Row label="Tab size" hint="Spaces per tab in the editor">
              <div className="settings-segment">
                {[2, 4, 8].map((n) => (
                  <button
                    key={n}
                    className={`seg-btn ${settings.tabSize === n ? 'active' : ''}`}
                    onClick={() => set('tabSize', n)}
                  >{n}</button>
                ))}
              </div>
            </Row>

            <Row label="Word wrap">
              <Toggle value={settings.wordWrap} onChange={(v) => set('wordWrap', v)} />
            </Row>

            <Row label="Line numbers">
              <Toggle value={settings.lineNumbers} onChange={(v) => set('lineNumbers', v)} />
            </Row>

            <Row label="Minimap" hint="Show code minimap on the right">
              <Toggle value={settings.minimap} onChange={(v) => set('minimap', v)} />
            </Row>

            <Row label="Font ligatures" hint="Merge symbols like =&gt; and !==">
              <Toggle value={settings.fontLigatures} onChange={(v) => set('fontLigatures', v)} />
            </Row>

            <Row label="Smooth scrolling">
              <Toggle value={settings.smoothScrolling} onChange={(v) => set('smoothScrolling', v)} />
            </Row>
          </div>

          <div className="settings-section">
            <div className="settings-section-title">Appearance</div>

            <Row label="Accent theme" hint="Colors the whole app">
              <div className="theme-picker">
                {Object.entries(THEMES).map(([key, theme]) => (
                  <button
                    key={key}
                    className={`theme-swatch ${settings.theme === key ? 'active' : ''}`}
                    onClick={() => set('theme', key)}
                    title={theme.label}
                  >
                    <span
                      className="theme-swatch-color"
                      style={{ background: theme.accent }}
                    />
                    <span className="theme-swatch-label">{theme.label}</span>
                  </button>
                ))}
              </div>
            </Row>

            <Row label="Reduce motion" hint="Disable animations">
              <Toggle value={settings.reduceMotion} onChange={(v) => set('reduceMotion', v)} />
            </Row>
          </div>

          <div className="settings-section">
            <div className="settings-section-title">Saving</div>

            <Row label="Auto-save" hint="Persist files to browser storage automatically">
              <Toggle value={settings.autoSave} onChange={(v) => set('autoSave', v)} />
            </Row>
          </div>

          <div className="settings-section">
            <div className="settings-section-title">About</div>
            <div className="settings-about">
              <div className="settings-about-name">Stream</div>
              <div className="settings-about-desc">
                An AI code editor. Built from scratch.
              </div>
            </div>
          </div>

        </div>

        <div className="modal-footer">
          <span className="modal-hint">Changes apply immediately</span>
          <button className="btn-accept" onClick={onClose}>
            <span className="btn-check">✓</span> Done
          </button>
        </div>
      </div>
    </div>
  )
}