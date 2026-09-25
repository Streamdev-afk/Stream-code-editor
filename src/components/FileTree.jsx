import { useState, useRef, useEffect } from 'react'
import { buildTree } from '../lib/fs'
import { getFileIcon, getFolderIcon } from '../lib/fileIcons'

function TreeNode({
  node, depth, activeFile, onFileClick,
  onRename, onDelete, onNewFile, onNewFolder,
  renaming, setRenaming,
}) {
  const [open, setOpen] = useState(depth < 1)
  const [menu, setMenu] = useState(null)
  const [renameValue, setRenameValue] = useState(node.name)
  const [hover, setHover] = useState(false)
  const inputRef = useRef(null)

  const isFolder = node.type === 'folder'
  const isActive = activeFile === node.path
  const isRenaming = renaming === node.path

  useEffect(() => {
    if (isRenaming) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [isRenaming])

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('scroll', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('scroll', close)
    }
  }, [menu])

  const handleClick = (e) => {
    if (isRenaming) return
    if (isFolder) setOpen(!open)
    else onFileClick?.(node.path)
  }

  const handleContext = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY })
  }

  const commitRename = () => {
    const trimmed = renameValue.trim()
    if (trimmed && trimmed !== node.name) {
      onRename?.(node.path, trimmed)
    }
    setRenaming(null)
  }

  return (
    <>
      <div
        className={`tree-row ${isActive ? 'active' : ''} ${hover ? 'hover' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={handleClick}
        onContextMenu={handleContext}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        title={node.path}
      >
        {depth > 0 && (
          <span className="tree-indent-guide" aria-hidden="true" />
        )}
        <span className="tree-caret">
          {isFolder ? (open ? '▾' : '▸') : ''}
        </span>
        <span className="tree-icon">
          {isFolder ? getFolderIcon(open) : getFileIcon(node.name)}
        </span>
        {isRenaming ? (
          <input
            ref={inputRef}
            className="tree-rename-input"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename()
              if (e.key === 'Escape') { setRenaming(null); setRenameValue(node.name) }
            }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="tree-name">{node.name}</span>
        )}
        {hover && !isRenaming && (
          <span className="tree-hover-actions">
            {isFolder && (
              <button
                className="tree-hover-btn"
                onClick={(e) => { e.stopPropagation(); onNewFile?.(node.path) }}
                title="New file"
              >＋</button>
            )}
            <button
              className="tree-hover-btn"
              onClick={(e) => { e.stopPropagation(); setRenaming(node.path) }}
              title="Rename"
            >✎</button>
            <button
              className="tree-hover-btn danger"
              onClick={(e) => { e.stopPropagation(); onDelete?.(node.path) }}
              title="Delete"
            >🗑</button>
          </span>
        )}
      </div>

      {menu && (
        <div
          className="tree-context-menu"
          style={{ top: menu.y, left: menu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          {isFolder && (
            <>
              <div className="menu-item" onClick={() => { onNewFile?.(node.path); setMenu(null) }}>
                <span className="menu-icon">📄</span> New File
              </div>
              <div className="menu-item" onClick={() => { onNewFolder?.(node.path); setMenu(null) }}>
                <span className="menu-icon">📁</span> New Folder
              </div>
              <div className="menu-sep" />
            </>
          )}
          <div className="menu-item" onClick={() => { setRenaming(node.path); setMenu(null) }}>
            <span className="menu-icon">✎</span> Rename
          </div>
          <div className="menu-item danger" onClick={() => { onDelete?.(node.path); setMenu(null) }}>
            <span className="menu-icon">🗑</span> Delete
          </div>
        </div>
      )}

      {isFolder && open && node.children.map((child) => (
        <TreeNode
          key={child.path}
          node={child}
          depth={depth + 1}
          activeFile={activeFile}
          onFileClick={onFileClick}
          onRename={onRename}
          onDelete={onDelete}
          onNewFile={onNewFile}
          onNewFolder={onNewFolder}
          renaming={renaming}
          setRenaming={setRenaming}
        />
      ))}
    </>
  )
}

export default function FileTree({
  files, activeFile, onFileClick, onDelete, onReset,
  onRename, onNewFile, onNewFolder,
}) {
  const tree = buildTree(files)
  const [rootMenu, setRootMenu] = useState(null)
  const [renaming, setRenaming] = useState(null)

  useEffect(() => {
    if (!rootMenu) return
    const close = () => setRootMenu(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [rootMenu])

  return (
    <div className="filetree">
      <div className="panel-header">
        <span>Explorer</span>
        <div className="panel-header-actions">
          <button
            className="panel-header-btn"
            title="New File"
            onClick={() => onNewFile?.('')}
          >＋</button>
          <button
            className="panel-header-btn"
            title="New Folder"
            onClick={() => onNewFolder?.('')}
          >📁＋</button>
          <button
            className="panel-header-btn"
            title="Reset files"
            onClick={() => {
              if (confirm('Reset all files to defaults? This wipes your edits.')) onReset?.()
            }}
          >↺</button>
        </div>
      </div>

      <div
        className="tree-body"
        onContextMenu={(e) => {
          if (e.target.classList.contains('tree-body')) {
            e.preventDefault()
            setRootMenu({ x: e.clientX, y: e.clientY })
          }
        }}
      >
        {tree.map((node) => (
          <TreeNode
            key={node.path}
            node={node}
            depth={0}
            activeFile={activeFile}
            onFileClick={onFileClick}
            onRename={onRename}
            onDelete={onDelete}
            onNewFile={onNewFile}
            onNewFolder={onNewFolder}
            renaming={renaming}
            setRenaming={setRenaming}
          />
        ))}

        {rootMenu && (
          <div
            className="tree-context-menu"
            style={{ top: rootMenu.y, left: rootMenu.x }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="menu-item" onClick={() => { onNewFile?.(''); setRootMenu(null) }}>
              <span className="menu-icon">📄</span> New File
            </div>
            <div className="menu-item" onClick={() => { onNewFolder?.(''); setRootMenu(null) }}>
              <span className="menu-icon">📁</span> New Folder
            </div>
          </div>
        )}
      </div>
    </div>
  )
}