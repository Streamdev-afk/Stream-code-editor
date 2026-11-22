import { useState, useEffect } from 'react'
import Icon from './Icon'
import { getFileIcon } from '../lib/fileIcons'

export default function Tabs({ openTabs, activeFile, dirty, onTabClick, onTabClose, onSplit, splitOn, rightSlot }) {
  const [menu, setMenu] = useState(null)
  const [pinned, setPinned] = useState(() => { try { return JSON.parse(localStorage.getItem('qoders-pinned') || '[]') } catch { return [] } })
  useEffect(() => { try { localStorage.setItem('qoders-pinned', JSON.stringify(pinned)) } catch {} }, [pinned])
  useEffect(() => {
    if (!menu) return
    const c = () => setMenu(null)
    window.addEventListener('click', c); window.addEventListener('blur', c)
    return () => { window.removeEventListener('click', c); window.removeEventListener('blur', c) }
  }, [menu])
  if (openTabs.length === 0) return null

  const ordered = [...openTabs.filter((p) => pinned.includes(p)), ...openTabs.filter((p) => !pinned.includes(p))]
  const copy = (t) => { try { navigator.clipboard.writeText(t) } catch {} }
  const closeMany = (list) => list.filter((p) => !pinned.includes(p)).forEach(onTabClose)

  return (
    <div className="tabs-bar">
      <div className="tabs-scroll">
      {ordered.map((path) => {
        const name = path.split('/').pop()
        const isActive = path === activeFile
        const isDirty = dirty.has(path)
        const isPinned = pinned.includes(path)

        return (
          <div
            key={path}
            className={`tab ${isActive ? 'active' : ''} ${isDirty ? 'dirty' : ''} ${isPinned ? 'pinned' : ''}`}
            onClick={() => onTabClick(path)}
            onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, path }) }}
            onAuxClick={(e) => { if (e.button === 1 && !isPinned) { e.preventDefault(); onTabClose(path) } }}
            title={path}
          >
            <span className="tab-icon">{getFileIcon(name)}</span>
            <span className="tab-name">{name}</span>
            {isPinned ? (
              <span className="tab-close" onClick={(e) => { e.stopPropagation(); setPinned((p) => p.filter((x) => x !== path)) }} title="Unpin">📌</span>
            ) : (
              <span
                className="tab-close"
                onClick={(e) => {
                  e.stopPropagation()
                  onTabClose(path)
                }}
                title="Close tab"
              >
                {isDirty ? <Icon name="dot" size={10} /> : <Icon name="close" size={12} strokeWidth={2.4} />}
              </span>
            )}
          </div>
        )
      })}
      <div className="tabs-fill" />
      </div>
      {(rightSlot || onSplit) && <div className="tabs-right">{onSplit && <button className={`tab-split-btn ${splitOn ? 'on' : ''}`} onClick={() => onSplit(activeFile)} title={splitOn ? 'Close the side editor' : 'Split the editor: show this file again on the right'}>⫿⫿</button>}{rightSlot}</div>}
      {menu && (
        <div className="tab-menu" style={{ left: Math.min(menu.x, window.innerWidth - 200), top: Math.min(menu.y, window.innerHeight - 220) }} onClick={(e) => e.stopPropagation()}>
          <button onClick={() => { setPinned((p) => p.includes(menu.path) ? p.filter((x) => x !== menu.path) : [...p, menu.path]); setMenu(null) }}>{pinned.includes(menu.path) ? 'Unpin tab' : 'Pin tab'}</button>
          {onSplit && <button onClick={() => { onSplit(menu.path); setMenu(null) }}>Open to the side</button>}
          <button onClick={() => { onTabClose(menu.path); setMenu(null) }}>Close</button>
          <button onClick={() => { closeMany(openTabs.filter((p) => p !== menu.path)); setMenu(null) }}>Close others</button>
          <button onClick={() => { const i = openTabs.indexOf(menu.path); closeMany(openTabs.slice(i + 1)); setMenu(null) }}>Close to the right</button>
          <button onClick={() => { closeMany(openTabs); setMenu(null) }}>Close all</button>
          <div className="tab-menu-sep" />
          <button onClick={() => { copy(menu.path); setMenu(null) }}>Copy path</button>
          <button onClick={() => { copy(menu.path.split('/').pop()); setMenu(null) }}>Copy file name</button>
        </div>
      )}
    </div>
  )
}
