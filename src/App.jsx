import { useEffect, useMemo, useState } from 'react'
import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import './App.css'

const THUMBNAIL_SIZE = 256
const THUMBNAIL_SIZE_STORAGE_KEY = 'thumbnailer.thumbnailSize'
const MIN_THUMBNAIL_SIZE = 100
const MAX_THUMBNAIL_SIZE = 320

function clampThumbnailSize(value) {
  return Math.max(MIN_THUMBNAIL_SIZE, Math.min(MAX_THUMBNAIL_SIZE, value))
}

function App() {
  const [selectedFolder, setSelectedFolder] = useState('')
  const [items, setItems] = useState([])
  const [status, setStatus] = useState('Pick a folder to start.')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [thumbnailSize, setThumbnailSize] = useState(() => {
    if (typeof window === 'undefined') {
      return 200
    }
    const storedValue = Number(window.localStorage.getItem(THUMBNAIL_SIZE_STORAGE_KEY))
    if (!Number.isFinite(storedValue)) {
      return 200
    }
    return clampThumbnailSize(Math.round(storedValue))
  })
  const [previewItem, setPreviewItem] = useState(null)

  const hasItems = items.length > 0
  const columnWidthPx = useMemo(() => thumbnailSize, [thumbnailSize])
  const previewImageSrc = useMemo(() => {
    if (!previewItem) {
      return ''
    }
    return convertFileSrc(previewItem.path)
  }, [previewItem])
  const emptyMessage = useMemo(() => {
    if (loading) {
      return 'Building thumbnails...'
    }
    if (!selectedFolder) {
      return 'No folder selected.'
    }
    return 'No supported images found in this folder.'
  }, [loading, selectedFolder])

  useEffect(() => {
    let disposed = false
    async function loadInitialFolder() {
      try {
        const initialFolder = await invoke('get_initial_folder')
        if (!disposed && initialFolder) {
          setSelectedFolder(initialFolder)
          await loadGallery(initialFolder)
        }
      } catch (invokeError) {
        if (!disposed) {
          setError(String(invokeError))
        }
      }
    }
    loadInitialFolder()
    return () => {
      disposed = true
    }
  }, [])

  useEffect(() => {
    window.localStorage.setItem(THUMBNAIL_SIZE_STORAGE_KEY, String(thumbnailSize))
  }, [thumbnailSize])

  useEffect(() => {
    if (!previewItem) {
      return undefined
    }
    function onKeydown(event) {
      if (event.key === 'Escape') {
        setPreviewItem(null)
      }
    }
    window.addEventListener('keydown', onKeydown)
    return () => {
      window.removeEventListener('keydown', onKeydown)
    }
  }, [previewItem])

  async function loadGallery(folder) {
    setLoading(true)
    setError('')
    setStatus(`Scanning ${folder}...`)
    try {
      const galleryItems = await invoke('load_gallery', {
        folderPath: folder,
        thumbnailSize: THUMBNAIL_SIZE,
      })
      setItems(galleryItems)
      setStatus(`Loaded ${galleryItems.length} image(s).`)
    } catch (invokeError) {
      setItems([])
      setStatus('Failed to load folder.')
      setError(String(invokeError))
    } finally {
      setLoading(false)
    }
  }

  async function pickFolder() {
    setError('')
    const selected = await open({
      directory: true,
      multiple: false,
      title: 'Pick an image folder',
    })
    if (typeof selected !== 'string') {
      return
    }
    setSelectedFolder(selected)
    await loadGallery(selected)
  }

  async function refreshCurrentFolder() {
    if (!selectedFolder) {
      return
    }
    await loadGallery(selectedFolder)
  }

  return (
    <main className="app">
      <header className="toolbar">
        <div className="actions">
          <label className="sizeControl">
            <span>Size {thumbnailSize}px</span>
            <input
              type="range"
              min={MIN_THUMBNAIL_SIZE}
              max={MAX_THUMBNAIL_SIZE}
              step="1"
              value={thumbnailSize}
              onChange={(event) =>
                setThumbnailSize(clampThumbnailSize(Number(event.target.value)))
              }
            />
          </label>
          <button type="button" onClick={pickFolder} disabled={loading}>
            Pick Folder
          </button>
          <button
            type="button"
            onClick={refreshCurrentFolder}
            disabled={loading || !selectedFolder}
          >
            Refresh
          </button>
        </div>
      </header>

      <section className="meta">
        <p className="status">{status}</p>
        {selectedFolder && <p className="folder">{selectedFolder}</p>}
        {error && <p className="error">{error}</p>}
      </section>

      <section
        className="gallery"
        style={{ '--thumb-column-width': `${columnWidthPx}px` }}
      >
        {loading && (
          <div className="loadingOverlay" aria-live="polite" aria-busy="true">
            <div className="spinner" />
            <p>Loading images...</p>
          </div>
        )}
        {!hasItems && <div className="empty">{emptyMessage}</div>}
        {items.map((item) => (
          <article className="card" key={item.path}>
            <button
              type="button"
              className="thumbButton"
              onClick={() => setPreviewItem(item)}
              title={`Open ${item.name}`}
            >
              <img src={item.thumbnailDataUrl} alt={item.name} loading="lazy" />
            </button>
            <div className="cardInfo">
              <p className="name">{item.name}</p>
              <p className="path">{item.path}</p>
            </div>
          </article>
        ))}
      </section>

      {previewItem && (
        <div
          className="previewModalBackdrop"
          onClick={() => setPreviewItem(null)}
          role="presentation"
        >
          <div className="previewModal" onClick={(event) => event.stopPropagation()}>
            <div className="previewHeader">
              <p className="previewTitle">{previewItem.name}</p>
              <button
                type="button"
                className="previewClose"
                onClick={() => setPreviewItem(null)}
              >
                Close
              </button>
            </div>
            <div className="previewImageWrap">
              <img src={previewImageSrc} alt={previewItem.name} className="previewImage" />
            </div>
            <p className="previewPath">{previewItem.path}</p>
          </div>
        </div>
      )}
    </main>
  )
}

export default App
