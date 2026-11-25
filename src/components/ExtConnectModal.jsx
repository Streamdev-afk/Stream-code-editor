import ExtensionsSection from './ExtensionsSection'

// A small window with ONE extension the AI pointed to, so the user can connect it right away.
export default function ExtConnectModal({ id, onClose }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal ext-connect" role="dialog" aria-label="Connect an extension" onClick={(e) => e.stopPropagation()}>
        <div className="action-card-head">Connect an extension<button className="modal-min" onClick={onClose} title="Close">×</button></div>
        <ExtensionsSection only={id} onDone={onClose} />
      </div>
    </div>
  )
}
