import { getFileIcon } from '../lib/fileIcons'

export default function Tabs({ openTabs, activeFile, dirty, onTabClick, onTabClose }) {
  if (openTabs.length === 0) return null

  return (
    <div className="tabs-bar">
      {openTabs.map((path) => {
        const name = path.split('/').pop()
        const isActive = path === activeFile
        const isDirty = dirty.has(path)

        return (
          <div
            key={path}
            className={`tab ${isActive ? 'active' : ''} ${isDirty ? 'dirty' : ''}`}
            onClick={() => onTabClick(path)}
            title={path}
          >
            <span className="tab-icon">{getFileIcon(name)}</span>
            <span className="tab-name">{name}</span>
            <span
              className="tab-close"
              onClick={(e) => {
                e.stopPropagation()
                onTabClose(path)
              }}
              title="Close tab"
            >
              {isDirty ? '●' : '✕'}
            </span>
          </div>
        )
      })}
      <div className="tabs-fill" />
    </div>
  )
}