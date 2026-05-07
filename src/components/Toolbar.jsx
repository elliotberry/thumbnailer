import { useEffect, useRef, useState } from 'react'

export function Toolbar({
  selectedFolder,
  thumbnailSize,
  minThumbnailSize,
  maxThumbnailSize,
  onThumbnailSizeChange,
  generatedIconSize,
  minGeneratedIconSize,
  maxGeneratedIconSize,
  onGeneratedIconSizeChange,
  onPickFolder,
  onStop,
  onClearCache,
  cacheDbSizeLabel,
  cacheBusy,
  loading,
}) {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsPanelRef = useRef(null)

  useEffect(() => {
    function handleOutsideClick(event) {
      if (!settingsPanelRef.current?.contains(event.target)) {
        setSettingsOpen(false)
      }
    }
    if (settingsOpen) {
      window.addEventListener('pointerdown', handleOutsideClick)
    }
    return () => {
      window.removeEventListener('pointerdown', handleOutsideClick)
    }
  }, [settingsOpen])

  return (
    <header className="toolbar">
      <div className="actions">
        <button type="button" onClick={onPickFolder} disabled={loading}>
          Pick Folder
        </button>
        {loading && (
          <button type="button" onClick={onStop}>
            Stop
          </button>
        )}
      </div>
      <div className="toolbarRight">
        <div className="settingsWrap" ref={settingsPanelRef}>
          <button
            type="button"
            className="settingsToggle"
            aria-label="Open settings"
            aria-expanded={settingsOpen}
            onClick={() => setSettingsOpen((value) => !value)}
          >
            ⚙
          </button>
          {settingsOpen && (
            <section className="settingsPanel" aria-label="Settings">
              <label className="sizeControl">
                <span>Icon size {thumbnailSize}px</span>
                <input
                  type="range"
                  min={minThumbnailSize}
                  max={maxThumbnailSize}
                  step="1"
                  value={thumbnailSize}
                  onChange={(event) => onThumbnailSizeChange(event.target.value)}
                />
              </label>
              <label className="sizeControl">
                <span>Generated size {generatedIconSize}px</span>
                <input
                  type="range"
                  min={minGeneratedIconSize}
                  max={maxGeneratedIconSize}
                  step="16"
                  value={generatedIconSize}
                  disabled={!selectedFolder || loading}
                  onChange={(event) => onGeneratedIconSizeChange(event.target.value)}
                />
              </label>
              {!selectedFolder ? (
                <p className="settingsHint">Pick a folder to apply generated icon size.</p>
              ) : null}
              <p className="settingsInfo">Cache DB size: {cacheDbSizeLabel}</p>
              <button
                type="button"
                className="clearCacheButton"
                disabled={loading || cacheBusy}
                onClick={onClearCache}
              >
                {cacheBusy ? 'Clearing cache...' : 'Clear cache'}
              </button>
            </section>
          )}
        </div>
      </div>
    </header>
  )
}
