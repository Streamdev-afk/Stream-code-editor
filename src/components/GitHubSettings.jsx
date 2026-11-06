import { useState, useEffect } from 'react'
import { useAuth } from '../lib/auth'
import { validateAndSaveToken, getGitHubStatus, disconnectGitHub } from '../lib/github'

export default function GitHubSettings() {
  const { user } = useAuth()
  const [status, setStatus] = useState(null) // null=loading, {connected}
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!user) { setStatus({ connected: false }); return }
    let cancelled = false
    ;(async () => {
      try {
        const s = await getGitHubStatus()
        if (!cancelled) setStatus(s)
      } catch (err) {
        if (!cancelled) setStatus({ connected: false, error: err.message })
      }
    })()
    return () => { cancelled = true }
  }, [user])

  const handleConnect = async () => {
    if (!token.trim()) return
    setBusy(true); setError(null)
    try {
      const result = await validateAndSaveToken(token.trim())
      setStatus({ connected: true, login: result.login, avatar: result.avatar })
      setToken('')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const handleDisconnect = async () => {
    if (!confirm('Disconnect GitHub? You can reconnect anytime.')) return
    setBusy(true)
    try {
      await disconnectGitHub()
      setStatus({ connected: false })
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (!user) {
    return <div className="gh-settings-empty">Sign in to connect GitHub.</div>
  }

  if (status === null) {
    return <div className="gh-settings-empty">Loading…</div>
  }

  if (status.connected) {
    return (
      <div className="gh-settings-connected">
        <div className="gh-connected-user">
          {status.avatar && <img src={status.avatar} alt="" className="gh-avatar" />}
          <div>
            <div className="gh-connected-name">{status.name || status.login}</div>
            <div className="gh-connected-login">@{status.login}</div>
          </div>
        </div>
        <button className="gh-btn gh-btn-ghost" onClick={handleDisconnect} disabled={busy}>
          Disconnect
        </button>
      </div>
    )
  }

  return (
    <div className="gh-settings-connect">
      <div className="gh-help">
        Paste a GitHub Personal Access Token to enable pushing your projects to GitHub.
        <br />
        <a
          href="https://github.com/settings/tokens/new?scopes=repo&description=ION%20Qoders"
          target="_blank"
          rel="noreferrer"
          className="gh-link"
        >
          Create a token on GitHub →
        </a>
        <div className="gh-hint">
          Scope needed: <code>repo</code> (full control of private repositories)
        </div>
      </div>

      <div className="gh-input-row">
        <input
          className="gh-input"
          type="password"
          placeholder="ghp_... or github_pat_..."
          value={token}
          onChange={(e) => setToken(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
        />
        <button className="gh-btn gh-btn-primary" onClick={handleConnect} disabled={busy || !token.trim()}>
          {busy ? 'Connecting…' : 'Connect'}
        </button>
      </div>

      {error && <div className="gh-error">⚠️ {error}</div>}
    </div>
  )
}