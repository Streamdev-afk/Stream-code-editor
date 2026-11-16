import { useEffect, useState } from 'react'
import Icon from './Icon'

// Shows a small card when a new version of the desktop app is ready. Does nothing on the web.
export default function DesktopUpdater() {
  const [u, setU] = useState(null)
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    if (!window.desktop?.onUpdate) return
    return window.desktop.onUpdate((d) => { setU(d); if (d.state === 'available' || d.state === 'ready') setHidden(false) })
  }, [])

  if (!u || hidden || !['available', 'downloading', 'ready', 'error'].includes(u.state)) return null

  return (
    <div className="upd-card" role="status">
      <div className="upd-top">
        <span className="upd-icon"><Icon name={u.state === 'error' ? 'warn' : 'download'} size={16} /></span>
        <div className="upd-text">
          {u.state === 'available' && (<><b>Update available</b><span>Version {u.version} is ready to download.</span></>)}
          {u.state === 'downloading' && (<><b>Downloading update…</b><span>{u.percent || 0}%</span></>)}
          {u.state === 'ready' && (<><b>Update ready</b><span>Restart to finish installing version {u.version}.</span></>)}
          {u.state === 'error' && (<><b>Update problem</b><span>{u.message || 'Could not check for updates.'}</span></>)}
        </div>
        <button className="upd-x" onClick={() => setHidden(true)} aria-label="Dismiss"><Icon name="close" size={14} /></button>
      </div>
      {u.state === 'downloading' && <div className="upd-bar"><i style={{ width: `${u.percent || 0}%` }} /></div>}
      <div className="upd-actions">
        {u.state === 'available' && <button className="upd-go" onClick={() => window.desktop.downloadUpdate()}>Download update</button>}
        {u.state === 'ready' && <button className="upd-go" onClick={() => window.desktop.installUpdate()}>Restart and install</button>}
        {u.state !== 'downloading' && <button className="upd-later" onClick={() => setHidden(true)}>Later</button>}
      </div>
    </div>
  )
}
