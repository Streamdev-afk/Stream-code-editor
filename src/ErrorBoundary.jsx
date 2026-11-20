import { Component } from 'react'

// If something breaks while drawing the editor, show this instead of a blank screen. Nothing is deleted.
export default class ErrorBoundary extends Component {
  state = { error: null }
  static getDerivedStateFromError(error) { return { error } }
  componentDidCatch(error) { try { console.error('Editor crashed:', error) } catch {} }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0b0f0d', color: '#e5e7eb', padding: 24, textAlign: 'center', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ maxWidth: 420 }}>
          <h2 style={{ margin: '0 0 8px' }}>Something went wrong</h2>
          <p style={{ opacity: 0.7, lineHeight: 1.5 }}>Your files and sessions are safe. Reload to continue. If it keeps happening, tell us what you did just before.</p>
          <p style={{ opacity: 0.45, fontSize: 12, wordBreak: 'break-word' }}>{String(this.state.error?.message || this.state.error).slice(0, 200)}</p>
          <button onClick={() => window.location.reload()} style={{ marginTop: 12, padding: '10px 18px', borderRadius: 10, border: 0, background: '#10b981', color: '#04120c', fontWeight: 600, cursor: 'pointer' }}>Reload</button>
        </div>
      </div>
    )
  }
}
