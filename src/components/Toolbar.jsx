export function Toolbar({
  selectedFolder,
  thumbnailSize,
  minThumbnailSize,
  maxThumbnailSize,
  onThumbnailSizeChange,
  onPickFolder,
  onStop,
  loading,
}) {
  return (
    <header className="toolbar">
      <div className="actions">
        {selectedFolder && (
          <label className="sizeControl">
            <span>Size {thumbnailSize}px</span>
            <input
              type="range"
              min={minThumbnailSize}
              max={maxThumbnailSize}
              step="1"
              value={thumbnailSize}
              onChange={(event) => onThumbnailSizeChange(event.target.value)}
            />
          </label>
        )}
        <button type="button" onClick={onPickFolder} disabled={loading}>
          Pick Folder
        </button>
        {loading && (
          <button type="button" onClick={onStop}>
            Stop
          </button>
        )}
      </div>
    </header>
  )
}
