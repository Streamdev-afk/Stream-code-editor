// Pictures the AI found on the web. "Add" saves one into the project under assets/.
export default function ImageGallery({ items }) {
  return (
    <div className="chat-gallery">
      {items.map((it, i) => (
        <div className="cg-item" key={i}>
          <img src={it.thumb} alt={it.title} loading="lazy" referrerPolicy="no-referrer" />
          <div className="cg-row">
            <button className="add" onClick={() => window.dispatchEvent(new CustomEvent('qoders-add-image', { detail: { url: it.url, title: it.title } }))}>Add</button>
            <a href={it.link || it.url} target="_blank" rel="noreferrer">Open</a>
          </div>
          {it.by && <div className="cg-by" title={`${it.by} (${it.license})`}>{it.by}</div>}
        </div>
      ))}
    </div>
  )
}
