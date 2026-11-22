import Icon from './Icon'
import { useState, useEffect } from 'react'
import { pushToGitHub, pullFromGitHub, listUserRepos } from '../lib/github'

export default function GitHubModal({ mode = 'push', files, sessionTitle, onClose, onPulled, hint }) {
  const [repoName, setRepoName] = useState('')
  const [commitMsg, setCommitMsg] = useState(hint?.message || '')
  const [isPrivate, setIsPrivate] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)

  // Push target: a repo that already exists, or a brand new one
  const linkKey = `ion-gh-links:${sessionTitle || 'project'}`
  const readLinks = () => { try { return JSON.parse(localStorage.getItem(linkKey) || '[]') } catch { return [] } }
  const [links, setLinks] = useState(readLinks)
  const [target, setTarget] = useState(null) // { owner, repo } of an existing repo
  const [tab, setTab] = useState(hint?.newRepo ? 'new' : 'existing') // 'existing' | 'new'
  const [pushRepos, setPushRepos] = useState(null)
  const [pushSearch, setPushSearch] = useState('')

  // Pull mode state
  const [repos, setRepos] = useState(null)
  const [pullTarget, setPullTarget] = useState(null)
  const [pullSearch, setPullSearch] = useState('')

  useEffect(() => {
    if (mode === 'push') {
      const slug = (sessionTitle || 'stream-project')
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 50)
      const aiName = String(hint?.repo || '').replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 60)
      setRepoName(aiName || slug || 'stream-project')
      ;(async () => {
        try {
          const list = await listUserRepos()
          setPushRepos(list)
          // already connected repo(s): exactly one is used straight away, with more than one you pick
          const linked = readLinks().filter((l) => list.find((r) => r.fullName === l))
          if (!hint?.newRepo && linked.length === 1) {
            const [o, n] = linked[0].split('/')
            setTarget({ owner: o, repo: n })
          }
          if (!hint?.newRepo && linked.length === 0 && list.length === 0) setTab('new')
        } catch { setPushRepos([]) }
      })()
    } else {
      // load user's repos
      ;(async () => {
        try {
          const list = await listUserRepos()
          setRepos(list)
          // the AI suggested a repo: pre-select it (you still press Import)
          const want = String(hint?.repo || '').toLowerCase()
          if (want) {
            const hit = list.find((r) => r.fullName.toLowerCase() === want || r.name.toLowerCase() === want.split('/').pop())
            if (hit) setPullTarget({ owner: hit.fullName.split('/')[0], repo: hit.name })
            setPullSearch(want.split('/').pop())
          }
        } catch (err) {
          setError(err.message)
          setRepos([])
        }
      })()
    }
  }, [mode, sessionTitle])

  const handlePush = async () => {
    if (!target && !repoName.trim()) return
    setBusy(true); setError(null)
    try {
      const result = await pushToGitHub({
        repoName: (target ? target.repo : repoName).trim(),
        owner: target ? target.owner : undefined,
        isPrivate,
        files,
        sessionTitle,
        commitMessage: commitMsg.trim(),
      })
      setSuccess(result)
      try { localStorage.setItem('qoders-lastrepo', `${result.owner}/${result.repo}`) } catch { /* ignore */ }
      window.dispatchEvent(new CustomEvent('qoders-pushed', { detail: result }))
      try {
        const full = `${result.owner}/${result.repo}`
        const next = [full, ...readLinks().filter((x) => x !== full)].slice(0, 6)
        localStorage.setItem(linkKey, JSON.stringify(next))
        setLinks(next)
      } catch {}
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const handlePull = async () => {
    if (!pullTarget) return
    setBusy(true); setError(null)
    try {
      const result = await pullFromGitHub({
        owner: pullTarget.owner,
        repo: pullTarget.repo,
        branch: pullTarget.branch,
      })
      onPulled?.(result)
      onClose?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const filteredRepos = repos
    ? repos.filter((r) => !pullSearch || r.fullName.toLowerCase().includes(pullSearch.toLowerCase()))
    : []

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal gh-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-group">
            <span className="modal-icon"><Icon name="diamond" size={14} /></span>
            <div>
              <div className="modal-title">
                {mode === 'push' ? 'Push to GitHub' : 'Import from GitHub'}
              </div>
              <div className="modal-subtitle">
                {mode === 'push'
                  ? 'Pick any of your repos, or create a new one'
                  : 'Load a repo as a new session'}
              </div>
            </div>
          </div>
          <button className="modal-close" onClick={onClose}><Icon name="close" size={16} strokeWidth={2.2} /></button>
        </div>

        <div className="gh-modal-body">
          {success ? (
            <div className="gh-success">
              <div className="gh-success-icon">✓</div>
              <div className="gh-success-title">Pushed {success.fileCount} file{success.fileCount === 1 ? '' : 's'}</div>
              <a
                href={success.url}
                target="_blank"
                rel="noreferrer"
                className="gh-success-link"
              >
                {success.owner}/{success.repo} on GitHub →
              </a>
            </div>
          ) : mode === 'push' ? (
            <>
              <div className="gh-field">
                <span className="gh-field-label">Where to push</span>
                <div className="gh-seg">
                  <button type="button" className={tab === 'existing' ? 'active' : ''} onClick={() => setTab('existing')}>Existing repo</button>
                  <button type="button" className={tab === 'new' ? 'active' : ''} onClick={() => { setTab('new'); setTarget(null) }}>New repo</button>
                </div>
              </div>

              {tab === 'existing' ? (
                <>
                  {links.length > 1 && !target && <div className="gh-empty" style={{ textAlign: 'left' }}>You have more than one repo connected. Pick the one to use.</div>}
                  {links.length > 0 && (
                    <div className="gh-chips">
                      {links.map((l) => (
                        <button type="button" key={l} className={`gh-chip ${target && `${target.owner}/${target.repo}` === l ? 'active' : ''}`} onClick={() => { const [o, n] = l.split('/'); setTarget({ owner: o, repo: n }) }}>{l}</button>
                      ))}
                    </div>
                  )}
                  <input className="gh-input" placeholder="Search your repos…" value={pushSearch} onChange={(e) => setPushSearch(e.target.value)} />
                  <div className="gh-repo-list">
                    {pushRepos === null ? (
                      <div className="gh-empty">Loading your repos…</div>
                    ) : (
                      pushRepos.filter((r) => !pushSearch || r.fullName.toLowerCase().includes(pushSearch.toLowerCase())).map((r) => (
                        <div key={r.fullName} className={`gh-repo-item ${target && `${target.owner}/${target.repo}` === r.fullName ? 'active' : ''}`} onClick={() => setTarget({ owner: r.fullName.split('/')[0], repo: r.name })}>
                          <div className="gh-repo-name">{r.fullName}</div>
                          <div className="gh-repo-meta">{r.private ? '🔒 Private' : '🌐 Public'}</div>
                        </div>
                      ))
                    )}
                  </div>
                </>
              ) : (
                <>
                  <label className="gh-field">
                    <span className="gh-field-label">New repository name</span>
                    <input className="gh-input" value={repoName} onChange={(e) => setRepoName(e.target.value)} placeholder="my-project" />
                  </label>
                  <label className="gh-field-row">
                    <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
                    <span>Make this repo private</span>
                  </label>
                </>
              )}

              <label className="gh-field">
                <span className="gh-field-label">Commit message {hint?.message ? '(suggested by Qoders, edit if you like)' : '(optional)'}</span>
                <input
                  className="gh-input"
                  value={commitMsg}
                  maxLength={100}
                  onChange={(e) => setCommitMsg(e.target.value)}
                  placeholder="What changed?"
                />
              </label>

              <div className="gh-file-count">
                {Object.keys(files || {}).length} file{Object.keys(files || {}).length === 1 ? '' : 's'} will be pushed
              </div>
            </>
          ) : (
            <>
              <input
                className="gh-input"
                placeholder="Search your repos…"
                value={pullSearch}
                onChange={(e) => setPullSearch(e.target.value)}
              />
              <div className="gh-repo-list">
                {repos === null ? (
                  <div className="gh-empty">Loading your repos…</div>
                ) : filteredRepos.length === 0 ? (
                  <div className="gh-empty">No repos found</div>
                ) : (
                  filteredRepos.map((r) => (
                    <div
                      key={r.fullName}
                      className={`gh-repo-item ${pullTarget?.repo === r.name ? 'active' : ''}`}
                      onClick={() => setPullTarget({ owner: r.fullName.split('/')[0], repo: r.name })}
                    >
                      <div className="gh-repo-name">{r.name}</div>
                      <div className="gh-repo-meta">
                        {r.private ? '🔒 Private' : '🌐 Public'}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          )}

          {error && <div className="gh-error">⚠️ {error}</div>}
        </div>

        <div className="modal-footer">
          <span className="modal-hint">
            {mode === 'push' ? 'Files commit in one go' : 'Creates a new session'}
          </span>
          <button className="btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          {!success && (
            <button
              className="btn-accept"
              onClick={mode === 'push' ? handlePush : handlePull}
              disabled={busy || (mode === 'push' ? (tab === 'existing' ? !target : !repoName.trim()) : !pullTarget)}
            >
              {busy ? 'Working…' : mode === 'push' ? 'Push' : 'Import'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}