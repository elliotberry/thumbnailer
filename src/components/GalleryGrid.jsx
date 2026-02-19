export function GalleryGrid({
  loading,
  loadingText,
  hasItems,
  selectedFolder,
  emptyMessage,
  columnWidthPx,
  items,
  thumbnailDataByPath,
  onSelectItem,
}) {
  return (
    <section className="gallery" style={{ '--thumb-column-width': `${columnWidthPx}px` }}>
      {loading && (
        <div className="loadingOverlay" aria-live="polite" aria-busy="true">
          <div className="spinner" />
          <p>{loadingText}</p>
        </div>
      )}
      {!hasItems && selectedFolder && <div className="empty">{emptyMessage}</div>}
      {hasItems && (
        <div className="galleryViewport galleryGrid">
          {items.map((item) => (
            <article className="card" key={item.path} style={{ width: `${columnWidthPx}px` }}>
              <button
                type="button"
                className="thumbButton"
                onClick={() => onSelectItem(item)}
                title={`Open ${item.name}`}
              >
                {thumbnailDataByPath[item.path] ? (
                  <img src={thumbnailDataByPath[item.path]} alt={item.name} loading="lazy" />
                ) : (
                  <div className="thumbPlaceholder" />
                )}
              </button>
              <div className="cardInfo">
                <p className="name">{item.name}</p>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
