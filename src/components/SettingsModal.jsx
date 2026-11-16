import { useState } from 'react'
import Icon from './Icon'
import { getWeb, setWeb } from '../lib/web'
import { THEMES } from '../lib/settings'
import BillingPanel from './BillingPanel'
import GitHubSettings from './GitHubSettings'
import { PROVIDERS, getByok, setByok } from '../lib/byok'
import UsageDropdown from './UsageDropdown'

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

function ByokSection() {
  const saved = getByok() || {}
  const [v, setV] = useState({ provider: 'openrouter', model: PROVIDERS[0].model, key: '', base: '', enabled: false, ...saved })
  const [show, setShow] = useState(false)
  const [done, setDone] = useState(false)
  const prov = PROVIDERS.find((p) => p.id === v.provider) || PROVIDERS[0]
  const upd = (patch) => { setDone(false); setV((x) => ({ ...x, ...patch })) }
  const ready = v.key && v.model && (v.provider !== 'custom' || v.base)
  const save = () => { setByok({ ...v, key: v.key.trim(), model: v.model.trim(), base: (v.base || '').trim() }); setDone(true) }
  const clear = () => { setByok(null); setV({ provider: 'openrouter', model: PROVIDERS[0].model, key: '', base: '', enabled: false }); setDone(false) }
  return (
    <div className="byok">
      <div className="byok-note">Use your own account with any provider. Your key stays in this browser and is sent only to run your request. Messages with your own key do not use up your plan.</div>
      <label className="byok-field">
        <span>Provider</span>
        <select value={v.provider} onChange={(e) => { const p = PROVIDERS.find((x) => x.id === e.target.value); upd({ provider: p.id, model: p.model }) }}>
          {PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        <small>{prov.hint}</small>
      </label>
      {v.provider === 'custom' && (
        <label className="byok-field"><span>Base URL</span>
          <input value={v.base || ''} onChange={(e) => upd({ base: e.target.value })} placeholder="https://api.example.com/v1" autoCapitalize="off" spellCheck="false" />
        </label>
      )}
      <label className="byok-field"><span>Model name</span>
        <input value={v.model} onChange={(e) => upd({ model: e.target.value })} placeholder="exact model id" autoCapitalize="off" spellCheck="false" />
      </label>
      <label className="byok-field"><span>API key</span>
        <div className="byok-keyrow">
          <input type={show ? 'text' : 'password'} value={v.key} onChange={(e) => upd({ key: e.target.value })} placeholder="paste your key" autoComplete="off" spellCheck="false" />
          <button type="button" className="byok-eye" onClick={() => setShow((x) => !x)}>{show ? 'Hide' : 'Show'}</button>
        </div>
      </label>
      <div className="byok-actions">
        <button type="button" className="byok-save" disabled={!ready} onClick={() => { setV((x) => ({ ...x, enabled: true })); setByok({ ...v, enabled: true, key: v.key.trim(), model: v.model.trim(), base: (v.base || '').trim() }); setDone(true) }}>
          {v.enabled ? 'Save changes' : 'Save and use my key'}
        </button>
        {v.enabled && <button type="button" className="byok-off" onClick={() => { setV((x) => ({ ...x, enabled: false })); setByok({ ...v, enabled: false }); setDone(false) }}>Turn off</button>}
        {(saved.key || v.key) && <button type="button" className="byok-clear" onClick={clear}>Remove key</button>}
      </div>
      {v.enabled && <div className="byok-on">Using your {prov.label} key with {v.model}</div>}
      {done && <div className="byok-ok">Saved. Your next message uses it.</div>}
    </div>
  )
}

export default function SettingsModal({ settings, onChange, onClose, onUpgrade, onManage, isMobile, onPush, onPull, onLink, testAfterApply, onTestToggle }) {
  const set = (key, value) => onChange({ ...settings, [key]: value })
  const [web, setWebState] = useState(getWeb())
  const seg = (key, opts) => (
    <div className="settings-segment">
      {opts.map(([v, label]) => (
        <button key={v} className={`seg-btn ${(settings[key] ?? opts[0][0]) === v ? 'active' : ''}`} onClick={() => set(key, v)}>{label}</button>
      ))}
    </div>
  )

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-group">
            <span className="modal-icon"><Icon name="settings" size={18} /></span>
            <div>
              <div className="modal-title">Settings</div>
              <div className="modal-subtitle">Preferences save automatically</div>
            </div>
          </div>
          <button className="modal-close" onClick={onClose}><Icon name="close" size={16} strokeWidth={2.2} /></button>
        </div>

        <div className="settings-body">

          {isMobile && (
            <div className="settings-section">
              <div className="settings-section-title">Usage</div>
              <div className="settings-usage">
                <UsageDropdown onUpgrade={onUpgrade} onManage={onManage} />
              </div>
              <div className="settings-section-title" style={{ marginTop: 14 }}>Project sync</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="topbar-btn" onClick={onPush}><Icon name="push" size={14} /> Push to GitHub</button>
                <button className="topbar-btn" onClick={onPull}><Icon name="pull" size={14} /> Import from GitHub</button>
              </div>
            </div>
          )}

          <div className="settings-section">
            <div className="settings-section-title">ION characters</div>
            <p className="settings-row-hint" style={{ margin: '0 0 10px' }}>Let a coding character from the ION app work on this project. Changes always wait for your approval.</p>
            <button className="topbar-btn" onClick={onLink}><Icon name="globe" size={14} /> Connect an AI</button>
          </div>

          <div className="settings-section">
            <div className="settings-section-title">Billing</div>
            <div className="settings-billing-wrap">
              <BillingPanel onUpgrade={onUpgrade} />
            </div>
          </div>

          <div className="settings-section">
            <div className="settings-section-title">AI models (your own key)</div>
            <ByokSection />
          </div>

          <div className="settings-section">
            <div className="settings-section-title">GitHub</div>
            <div className="settings-billing-wrap">
              <GitHubSettings />
            </div>
          </div>

          <div className="settings-section">
            <div className="settings-section-title">AI assistant</div>

            <Row label="Web search" hint="Let the AI look things up when a question needs it">
              <Toggle value={web} onChange={(v) => { setWeb(v); setWebState(v) }} />
            </Row>
            <Row label="Test after applying" hint="Agent opens the preview after changes and fixes errors">
              <Toggle value={!!testAfterApply} onChange={(v) => onTestToggle?.(v)} />
            </Row>
            <Row label="Team mode" hint="Several AIs build different parts at the same time">
              <Toggle value={!!settings.team} onChange={(v) => set('team', v)} />
            </Row>
            <Row label="Reply typing speed" hint="How fast the AI text appears in chat">
              {seg('typingSpeed', [['slow', 'Slow'], ['normal', 'Normal'], ['fast', 'Fast']])}
            </Row>
            <Row label="Tidy cramped code" hint="Auto-format code the AI wrote on one long line">
              <Toggle value={settings.autoFormat !== false} onChange={(v) => set('autoFormat', v)} />
            </Row>
          </div>

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

            <Row label="Auto-close brackets" hint="Type ( and get ( )">
              <Toggle value={settings.autoClose !== false} onChange={(v) => set('autoClose', v)} />
            </Row>
            <Row label="Colored brackets">
              <Toggle value={settings.bracketColors !== false} onChange={(v) => set('bracketColors', v)} />
            </Row>
            <Row label="Indent guides">
              <Toggle value={settings.indentGuides !== false} onChange={(v) => set('indentGuides', v)} />
            </Row>
            <Row label="Format on paste">
              <Toggle value={!!settings.formatOnPaste} onChange={(v) => set('formatOnPaste', v)} />
            </Row>
            <Row label="Cursor style">
              {seg('cursorStyle', [['line', 'Line'], ['block', 'Block'], ['underline', 'Underline']])}
            </Row>
            <Row label="Show whitespace">
              {seg('whitespace', [['none', 'Off'], ['boundary', 'Edges'], ['all', 'All']])}
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

            <Row label="Liquid glass motion" hint="Springy morphs, bounce and glass shine">
              <Toggle value={settings.liquid !== false} onChange={(v) => set('liquid', v)} />
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
              <div className="settings-about-name">ION Qoders</div>
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