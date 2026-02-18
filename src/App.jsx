import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { open } from '@tauri-apps/plugin-dialog'
import './App.css'

const THUMBNAIL_SIZE = 256
const THUMBNAIL_SIZE_STORAGE_KEY = 'thumbnailer.thumbnailSize'
const MIN_THUMBNAIL_SIZE = 100
const MAX_THUMBNAIL_SIZE = 320

function clampThumbnailSize(value) {
  return Math.max(MIN_THUMBNAIL_SIZE, Math.min(MAX_THUMBNAIL_SIZE, value))
}

function hasTauriInvoke() {
  return Boolean(window.__TAURI_INTERNALS__?.invoke)
}

function formatImageCount(count) {
  const safeCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0
  return `${safeCount} image${safeCount === 1 ? '' : 's'}`
}

function getDroppedPaths(payload) {
  if (Array.isArray(payload)) {
    return payload.map((entry) => String(entry))
  }
  if (!payload || typeof payload !== 'object') {
    return []
  }
  if (Array.isArray(payload.paths)) {
    return payload.paths.map((entry) => String(entry))
  }
  return []
}

function App() {
  const [selectedFolder, setSelectedFolder] = useState('')
  const [items, setItems] = useState([])
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingText, setLoadingText] = useState('Loading images...')
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
  const [previewImageSrc, setPreviewImageSrc] = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState('')
  const [thumbnailDataByPath, setThumbnailDataByPath] = useState({})
  const hydrationRunIdRef = useRef(0)
  const loadGalleryRef = useRef(null)
  const lastDroppedFolderRef = useRef({ path: '', timestamp: 0 })

  const hasItems = items.length > 0
  const columnWidthPx = useMemo(() => thumbnailSize, [thumbnailSize])
  const currentPreviewIndex = useMemo(() => {
    if (!previewItem) {
      return -1
    }
    return items.findIndex((item) => item.path === previewItem.path)
  }, [items, previewItem])
  const hasPreviousPreview = currentPreviewIndex > 0
  const hasNextPreview = currentPreviewIndex >= 0 && currentPreviewIndex < items.length - 1
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
    if (!hasTauriInvoke()) {
      return undefined
    }
    let unlisten
    listen('thumbnail-progress', (event) => {
      const payload = event.payload
      if (!payload || typeof payload !== 'object') {
        return
      }
      const current = Number(payload.current ?? 0)
      const total = Number(payload.total ?? 0)
      const name = String(payload.name ?? 'image')
      if (current > 0 && total > 0) {
        setLoadingText(`Generating ${current}/${total}: ${name}`)
      } else {
        setLoadingText(`Generating: ${name}`)
      }
    })
      .then((unlistenFn) => {
        unlisten = unlistenFn
      })
      .catch((eventError) => {
        setError(String(eventError))
      })
    return () => {
      if (unlisten) {
        unlisten()
      }
    }
  }, [])

  useEffect(() => {
    let disposed = false
    async function loadInitialFolder() {
      try {
        if (!hasTauriInvoke()) {
          if (!disposed) {
            setStatus('Run this app with Tauri (`npm run tauri dev`) to enable folder scan.')
          }
          return
        }
        const initialFolder = await invoke('get_initial_folder')
        if (!disposed && initialFolder) {
          setSelectedFolder(initialFolder)
          if (loadGalleryRef.current) {
            await loadGalleryRef.current(initialFolder)
          }
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
    function navigatePreview(direction) {
      if (currentPreviewIndex < 0) {
        return
      }
      const nextIndex = currentPreviewIndex + direction
      if (nextIndex < 0 || nextIndex >= items.length) {
        return
      }
      setPreviewItem(items[nextIndex])
    }
    function onKeydown(event) {
      if (event.key === 'Escape') {
        setPreviewItem(null)
        return
      }
      if (event.key === 'ArrowLeft') {
        navigatePreview(-1)
        return
      }
      if (event.key === 'ArrowRight') {
        navigatePreview(1)
      }
    }
    window.addEventListener('keydown', onKeydown)
    return () => {
      window.removeEventListener('keydown', onKeydown)
    }
  }, [currentPreviewIndex, items, previewItem])

  useEffect(() => {
    if (!previewItem) {
      setPreviewImageSrc('')
      setPreviewLoading(false)
      setPreviewError('')
      return
    }

    let cancelled = false
    async function loadPreview() {
      if (!hasTauriInvoke()) {
        setPreviewError('Preview unavailable outside Tauri runtime.')
        return
      }
      setPreviewLoading(true)
      setPreviewError('')
      setPreviewImageSrc('')
      try {
        const dataUrl = await invoke('load_full_image', { path: previewItem.path })
        if (!cancelled) {
          setPreviewImageSrc(String(dataUrl))
        }
      } catch (previewLoadError) {
        if (!cancelled) {
          setPreviewError(String(previewLoadError))
        }
      } finally {
        if (!cancelled) {
          setPreviewLoading(false)
        }
      }
    }
    loadPreview()
    return () => {
      cancelled = true
    }
  }, [previewItem])

  const hydrateThumbnails = useCallback(async (galleryItems, runId) => {
    const maxConcurrent = 6
    let cursor = 0

    async function worker() {
      while (cursor < galleryItems.length && runId === hydrationRunIdRef.current) {
        const currentIndex = cursor
        cursor += 1
        const item = galleryItems[currentIndex]
        try {
          const dataUrl = await invoke('load_thumbnail', {
            path: item.path,
            thumbnailSize: THUMBNAIL_SIZE,
          })
          if (runId !== hydrationRunIdRef.current) {
            return
          }
          setThumbnailDataByPath((prev) => {
            if (prev[item.path]) {
              return prev
            }
            return { ...prev, [item.path]: String(dataUrl) }
          })
        } catch {
          // Keep going if one thumbnail fails.
        }
      }
    }

    const workerCount = Math.min(maxConcurrent, galleryItems.length)
    await Promise.all(Array.from({ length: workerCount }, () => worker()))
  }, [])

  const loadGallery = useCallback(async (folder) => {
    if (!hasTauriInvoke()) {
      setError('Tauri API unavailable. Start with `npm run tauri dev`.')
      return
    }
    setLoading(true)
    setLoadingText('Preparing thumbnails...')
    setError('')
    hydrationRunIdRef.current += 1
    setThumbnailDataByPath({})
    setStatus(`Scanning ${folder}...`)
    try {
      const response = await invoke('load_gallery', {
        folderPath: folder,
        thumbnailSize: THUMBNAIL_SIZE,
      })
      const galleryItems = Array.isArray(response?.items) ? response.items : []
      setItems(galleryItems)
      if (response?.cancelled) {
        setStatus(`Stopped. Loaded ${formatImageCount(galleryItems.length)} before cancel.`)
      } else {
        setStatus(`Loaded ${formatImageCount(galleryItems.length)}.`)
      }
      hydrateThumbnails(galleryItems, hydrationRunIdRef.current)
    } catch (invokeError) {
      setItems([])
      setStatus('Failed to load folder.')
      setError(String(invokeError))
    } finally {
      setLoading(false)
      setLoadingText('Loading images...')
    }
  }, [hydrateThumbnails])

  useEffect(() => {
    loadGalleryRef.current = loadGallery
  }, [loadGallery])

  useEffect(() => {
    if (!hasTauriInvoke()) {
      return undefined
    }

    let disposed = false
    let unlistenFileDrop
    let unlistenDragDrop

    async function handleFolderDrop(event) {
      const droppedPaths = getDroppedPaths(event.payload)
      if (droppedPaths.length === 0) {
        return
      }

      const nextFolder = droppedPaths[0]
      const now = Date.now()
      const lastDrop = lastDroppedFolderRef.current
      if (lastDrop.path === nextFolder && now - lastDrop.timestamp < 500) {
        return
      }
      lastDroppedFolderRef.current = { path: nextFolder, timestamp: now }

      setSelectedFolder(nextFolder)
      await loadGallery(nextFolder)
    }

    async function registerDropListeners() {
      try {
        unlistenFileDrop = await listen('tauri://file-drop', handleFolderDrop)
        unlistenDragDrop = await listen('tauri://drag-drop', handleFolderDrop)
      } catch (eventError) {
        if (!disposed) {
          setError(String(eventError))
        }
      }
    }

    registerDropListeners()

    return () => {
      disposed = true
      if (unlistenFileDrop) {
        unlistenFileDrop()
      }
      if (unlistenDragDrop) {
        unlistenDragDrop()
      }
    }
  }, [loadGallery])

  async function pickFolder() {
    setError('')
    if (!hasTauriInvoke()) {
      setError('Folder picker requires Tauri runtime. Start with `npm run tauri dev`.')
      return
    }
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

  async function stopGalleryScan() {
    if (!loading) {
      return
    }
    try {
      await invoke('cancel_gallery_scan')
      setStatus('Stopping thumbnail generation...')
    } catch (cancelError) {
      setError(String(cancelError))
    }
  }

  function goToPreview(direction) {
    if (currentPreviewIndex < 0) {
      return
    }
    const nextIndex = currentPreviewIndex + direction
    if (nextIndex < 0 || nextIndex >= items.length) {
      return
    }
    setPreviewItem(items[nextIndex])
  }

  return (
    <main className="app">
      <header className="toolbar">
        <div className="actions">
          {selectedFolder && (
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
          )}
          <button type="button" onClick={pickFolder} disabled={loading}>
            Pick Folder
          </button>
          {loading && (
            <button type="button" onClick={stopGalleryScan}>
              Stop
            </button>
          )}
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
                  onClick={() => setPreviewItem(item)}
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
                  <p className="path">{item.path}</p>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {previewItem && (
        <div
          className="previewModalBackdrop"
          onClick={() => setPreviewItem(null)}
          role="presentation"
        >
          <div className="previewModal" onClick={(event) => event.stopPropagation()}>
            <div className="previewHeader">
              <div className="previewNav">
                <button
                  type="button"
                  onClick={() => goToPreview(-1)}
                  disabled={!hasPreviousPreview}
                >
                  Left
                </button>
                <button
                  type="button"
                  onClick={() => goToPreview(1)}
                  disabled={!hasNextPreview}
                >
                  Right
                </button>
              </div>
              <p className="previewTitle">{previewItem.name}</p>
              <div className="previewNav">
                <button
                  type="button"
                  className="previewClose"
                  onClick={() => setPreviewItem(null)}
                >
                  Close
                </button>
              </div>
            </div>
            <div className="previewImageWrap">
              {previewLoading && <p className="previewUnavailable">Loading preview...</p>}
              {!previewLoading && previewImageSrc ? (
                <img src={previewImageSrc} alt={previewItem.name} className="previewImage" />
              ) : null}
              {!previewLoading && !previewImageSrc ? (
                <p className="previewUnavailable">
                  {previewError || 'Preview unavailable for this image.'}
                </p>
              ) : null}
            </div>
            <p className="previewPath">{previewItem.path}</p>
          </div>
        </div>
      )}
    </main>
  )
}

export default App
