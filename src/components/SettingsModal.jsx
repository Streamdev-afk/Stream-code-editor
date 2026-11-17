import { useState, useEffect } from 'react'
import { apiFetch } from '../lib/supabase'
import { API_BASE } from '../lib/api'
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
  const [models, setModels] = useState([])
  const [loading, setLoading] = useState(false)
  const [loadErr, setLoadErr] = useState('')
  const prov = PROVIDERS.find((p) => p.id === v.provider) || PROVIDERS[0]
  const upd = (patch) => { setDone(false); setV((x) => ({ ...x, ...patch })) }
  const ready = v.key && v.model && (v.provider !== 'custom' || v.base)

  // Ask the server which models this key may use
  const loadModels = async (silent = false) => {
    if (!v.key.trim() || (v.provider === 'custom' && !v.base)) return
    setLoading(true); setLoadErr('')
    try {
      const h = { 'x-ai-provider': v.provider, 'x-ai-key': v.key.trim() }
      if (v.provider === 'custom') h['x-ai-base'] = v.base.trim()
      const res = await apiFetch(`${API_BASE}/api/byok/models`, { method: 'POST', headers: h })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Could not load models')
      setModels(d.models || [])
      if (!(d.models || []).length) setLoadErr('This key did not return any chat models. You can still type a model name.')
      else if (!d.models.includes(v.model)) upd({ model: d.models[0] })
    } catch (e) { if (!silent) setLoadErr(e.message); setModels([]) }
    finally { setLoading(false) }
  }
  // load automatically shortly after a key is pasted
  useEffect(() => {
    if (v.key.trim().length < 16) return
    const t = setTimeout(() => loadModels(true), 700)
    return () => clearTimeout(t)
  }, [v.key, v.provider, v.base])

  const commit = (enabled) => { const next = { ...v, enabled, key: v.key.trim(), model: v.model.trim(), base: (v.base || '').trim() }; setV(next); setByok(next); setDone(true) }
  const clear = () => { setByok(null); setModels([]); setV({ provider: 'openrouter', model: PROVIDERS[0].model, key: '', base: '', enabled: false }); setDone(false) }
  return (
    <div className="byok">
      <div className="byok-note">Use your own account with any provider. Your key stays in this browser and is sent only to run your request. Messages with your own key do not use up your plan.</div>
      <label className="byok-field">
        <span>Provider</span>
        <select value={v.provider} onChange={(e) => { const p = PROVIDERS.find((x) => x.id === e.target.value); setModels([]); upd({ provider: p.id, model: p.model }) }}>
          {PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        <small>{prov.hint}</small>
      </label>
      {v.provider === 'custom' && (
        <label className="byok-field"><span>Base URL</span>
          <input value={v.base || ''} onChange={(e) => upd({ base: e.target.value })} placeholder="https://api.example.com/v1" autoCapitalize="off" spellCheck="false" />
        </label>
      )}
      <label className="byok-field"><span>API key</span>
        <div className="byok-keyrow">
          <input type={show ? 'text' : 'password'} value={v.key} onChange={(e) => upd({ key: e.target.value })} placeholder="paste your key" autoComplete="off" spellCheck="false" />
          <button type="button" className="byok-eye" onClick={() => setShow((x) => !x)}>{show ? 'Hide' : 'Show'}</button>
        </div>
        <small>{loading ? 'Checking which models your key can use…' : models.length ? `${models.length} models available on your key` : 'Models load automatically once you paste your key.'}</small>
      </label>
      <label className="byok-field"><span>Model</span>
        <div className="byok-keyrow">
          <input list="byok-models" value={v.model} onChange={(e) => upd({ model: e.target.value })} placeholder={models.length ? 'Search or pick a model' : 'model name'} autoCapitalize="off" spellCheck="false" />
          <button type="button" className="byok-eye" onClick={() => loadModels(false)} disabled={loading || !v.key}>{loading ? '…' : 'Reload'}</button>
        </div>
        <datalist id="byok-models">{models.map((m) => <option key={m} value={m} />)}</datalist>
        {loadErr && <small className="byok-err">{loadErr}</small>}
      </label>
      <div className="byok-actions">
        <button type="button" className="byok-save" disabled={!ready} onClick={() => commit(true)}>{v.enabled ? 'Save changes' : 'Save and use my key'}</button>
        {v.enabled && <button type="button" className="byok-off" onClick={() => commit(false)}>Turn off</button>}
        {(saved.key || v.key) && <button type="button" className="byok-clear" onClick={clear}>Remove key</button>}
      </div>
      {v.enabled && <div className="byok-on">Using your {prov.label} key with {v.model}</div>}
      {done && <div className="byok-ok">Saved. Your next message uses it.</div>}
    </div>
  )
}

const PAGES = [
  { id: 'plan', label: 'Plan & usage', desc: 'Your plan, usage and billing', icon: 'gem' },
  { id: 'ai', label: 'AI assistant', desc: 'Web search, team mode, typing speed', icon: 'bot' },
  { id: 'models', label: 'AI models', desc: 'Use your own API key', icon: 'bolt' },
  { id: 'github', label: 'GitHub & connections', desc: 'Repos, push, pull and ION characters', icon: 'github' },
  { id: 'editor', label: 'Editor', desc: 'Font, tabs, wrapping and more', icon: 'edit' },
  { id: 'appearance', label: 'Appearance', desc: 'Theme colours and motion', icon: 'star' },
  { id: 'saving', label: 'Saving & files', desc: 'Auto-save and your computer folder', icon: 'save' },
  { id: 'about', label: 'About & updates', desc: 'Version and desktop updates', icon: 'compass' },
]

export default function SettingsModal({ settings, onChange, onClose, onUpgrade, onManage, isMobile, onPush, onPull, onLink, testAfterApply, onTestToggle, disk, onOpenRules, hasRules }) {
  const set = (key, value) => onChange({ ...settings, [key]: value })
  const [web, setWebState] = useState(getWeb())
  const [page, setPage] = useState(isMobile ? null : 'plan') // null = the list (phones)
  const [appVersion, setAppVersion] = useState('')
  const [updMsg, setUpdMsg] = useState('')
  const seg = (key, opts) => (
    <div className="settings-segment">
      {opts.map(([v, label]) => (
        <button key={v} className={`seg-btn ${(settings[key] ?? opts[0][0]) === v ? 'active' : ''}`} onClick={() => set(key, v)}>{label}</button>
      ))}
    </div>
  )

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      if (isMobile && page) setPage(null)
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isMobile, page, onClose])

  useEffect(() => { window.desktop?.version?.().then(setAppVersion).catch(() => {}) }, [])
  useEffect(() => {
    if (!window.desktop?.onUpdate) return
    return window.desktop.onUpdate((d) => {
      setUpdMsg(d.state === 'none' ? 'You have the latest version.' : d.state === 'available' ? `Version ${d.version} is available.` : d.state === 'downloading' ? `Downloading… ${d.percent || 0}%` : d.state === 'ready' ? 'Update ready. Restart to install.' : d.state === 'error' ? (d.message || 'Could not check.') : '')
    })
  }, [])

  const current = PAGES.find((p) => p.id === page)

  const body = {
    plan: (
      <>
        {isMobile && (
          <div className="sp-card"><div className="sp-card-title">Usage today</div><UsageDropdown onUpgrade={onUpgrade} onManage={onManage} /></div>
        )}
        <div className="sp-card"><div className="sp-card-title">Billing</div><BillingPanel onUpgrade={onUpgrade} /></div>
      </>
    ),
    ai: <div className="sp-card">
            <Row label="Web search" hint="Let the AI look things up when a question needs it">
              <Toggle value={web} onChange={(v) => { setWeb(v); setWebState(v) }} />
            </Row>
            <Row label="Test after applying" hint="Agent opens the preview after changes and fixes errors">
              <Toggle value={!!testAfterApply} onChange={(v) => onTestToggle?.(v)} />
            </Row>
            <Row label="AI can ask me questions" hint="When it needs a decision, it pops up a question with options. Turn off and it decides by itself.">
              <Toggle value={settings.askQuestions !== false} onChange={(v) => set('askQuestions', v)} />
            </Row>
            <Row label="Project rules" hint="A file called ION.md that the AI reads before every answer. Write things it must always follow.">
              <button className="topbar-btn small" onClick={() => onOpenRules?.()}>{hasRules ? 'Open rules' : 'Create rules'}</button>
            </Row>
            <Row label="Team mode" hint="Several AIs build different parts at the same time">
              <Toggle value={!!settings.team} onChange={(v) => set('team', v)} />
            </Row>
            <Row label="Reply typing speed" hint="How fast the AI text appears in chat">
              {seg('typingSpeed', [['slow', 'Slow'], ['normal', 'Normal'], ['fast', 'Fast']])}
            </Row>
            <Row label="Tidy cramped code" hint="Auto-format code the AI wrote on one long line">
              <Toggle value={settings.autoFormat !== false} onChange={(v) => set('autoFormat', v)} />
            </Row></div>,
    models: <div className="sp-card"><ByokSection /></div>,
    github: (
      <>
        <div className="sp-card"><div className="sp-card-title">GitHub</div><GitHubSettings /></div>
        {isMobile && (
          <div className="sp-card">
            <div className="sp-card-title">Project sync</div>
            <div className="sp-btnrow">
              <button className="topbar-btn" onClick={onPush}><Icon name="push" size={14} /> Push to GitHub</button>
              <button className="topbar-btn" onClick={onPull}><Icon name="pull" size={14} /> Import from GitHub</button>
            </div>
          </div>
        )}
        <div className="sp-card">
          <div className="sp-card-title">ION characters</div>
          <p className="settings-row-hint" style={{ margin: '0 0 12px' }}>Let a coding character from the ION app work on this project. Changes always wait for your approval.</p>
          <button className="topbar-btn" onClick={onLink}><Icon name="globe" size={14} /> Connect an AI</button>
        </div>
      </>
    ),
    editor: <div className="sp-card">
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
            </Row></div>,
    appearance: <div className="sp-card">
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
            </Row></div>,
    saving: (
      <>
        <div className="sp-card">
            <Row label="Auto-save" hint="Persist files to browser storage automatically">
              <Toggle value={settings.autoSave} onChange={(v) => set('autoSave', v)} />
            </Row></div>
        <div className="sp-card">
          <div className="sp-card-title">Save to your computer</div>
          <p className="settings-row-hint" style={{ margin: '0 0 12px' }}>
            {disk?.canPick
              ? 'Pick a folder and press Ctrl+S to write the open file straight into it. Ctrl+Shift+S saves every file.'
              : 'Your browser cannot save into folders, so Ctrl+S downloads the file instead. Use Chrome, Edge or the desktop app to save into a folder.'}
          </p>
          {disk?.canPick && (
            <>
              <div className="sp-folder">{disk.folder ? <><Icon name="folder" size={15} /> {disk.folder.name}</> : 'No folder chosen yet'}</div>
              <div className="sp-btnrow">
                <button className="topbar-btn" onClick={disk.choose}><Icon name="folder" size={14} /> {disk.folder ? 'Change folder' : 'Choose folder'}</button>
                <button className="topbar-btn" onClick={disk.saveAll}><Icon name="save" size={14} /> Save all files now</button>
              </div>
            </>
          )}
        </div>
      </>
    ),
    about: (
      <>
        <div className="sp-card">
          <div className="settings-about-name">ION Qoders</div>
          <div className="settings-about-desc">An AI code editor. Built from scratch.</div>
          {appVersion && <div className="sp-version">Desktop app version {appVersion}</div>}
        </div>
        {window.desktop?.checkUpdate && (
          <div className="sp-card">
            <div className="sp-card-title">Desktop updates</div>
            <p className="settings-row-hint" style={{ margin: '0 0 12px' }}>{updMsg || 'The app checks for updates on its own. You can also check now.'}</p>
            <button className="topbar-btn" onClick={() => { setUpdMsg('Checking…'); window.desktop.checkUpdate() }}><Icon name="refresh" size={14} /> Check for updates</button>
          </div>
        )}
      </>
    ),
  }

  const showList = !isMobile || page === null
  const showDetail = !isMobile || page !== null

  return (
    <div className={`sp ${isMobile ? 'sp-mobile' : ''}`} role="dialog" aria-label="Settings">
      {showList && (
        <aside className="sp-nav">
          <div className="sp-nav-head">
            <button className="sp-back" onClick={onClose} aria-label="Close settings"><Icon name="back" size={18} /></button>
            <div>
              <div className="sp-title">Settings</div>
              <div className="sp-sub">Changes save automatically</div>
            </div>
          </div>
          <nav className="sp-list">
            {PAGES.map((p, i) => (
              <button key={p.id} className={`sp-tile ${page === p.id ? 'active' : ''}`} style={{ animationDelay: `${i * 35}ms` }} onClick={() => setPage(p.id)}>
                <span className="sp-ico"><Icon name={p.icon} size={17} /></span>
                <span className="sp-tile-text"><b>{p.label}</b><small>{p.desc}</small></span>
                <Icon name="chevronRight" size={15} className="sp-chev" />
              </button>
            ))}
          </nav>
        </aside>
      )}
      {showDetail && current && (
        <section className="sp-main">
          <header className="sp-main-head">
            {isMobile && <button className="sp-back" onClick={() => setPage(null)} aria-label="Back"><Icon name="back" size={18} /></button>}
            <div className="sp-main-titles">
              <h2>{current.label}</h2>
              <p>{current.desc}</p>
            </div>
            {!isMobile && <button className="btn-accept" onClick={onClose}><span className="btn-check">✓</span> Done</button>}
          </header>
          <div className="sp-content" key={page}>{body[page]}</div>
        </section>
      )}
    </div>
  )
}
