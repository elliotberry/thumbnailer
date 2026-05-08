import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { formatImageCount, getDroppedPaths, hasTauriInvoke } from '../utils/gallery'

export function useGallery(generatedIconSize) {
  const [selectedFolder, setSelectedFolder] = useState('')
  const [items, setItems] = useState([])
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingText, setLoadingText] = useState('Loading images...')
  const [loadingPhaseText, setLoadingPhaseText] = useState('')
  const [error, setError] = useState('')
  const [thumbnailDataByPath, setThumbnailDataByPath] = useState({})
  const [cacheDbSizeBytes, setCacheDbSizeBytes] = useState(0)
  const [cacheBusy, setCacheBusy] = useState(false)
  const loadRunIdRef = useRef(0)
  const lastDroppedFolderRef = useRef({ path: '', timestamp: 0 })

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
      setLoadingPhaseText('Generating thumbnails...')
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

  const refreshCacheInfo = useCallback(async () => {
    if (!hasTauriInvoke()) {
      setCacheDbSizeBytes(0)
      return
    }
    try {
      const response = await invoke('get_cache_info')
      const dbSizeBytes = Number(response?.dbSizeBytes ?? 0)
      if (Number.isFinite(dbSizeBytes)) {
        setCacheDbSizeBytes(Math.max(0, Math.round(dbSizeBytes)))
      }
    } catch (invokeError) {
      setError(String(invokeError))
    }
  }, [])

  const loadGallery = useCallback(
    async (folder, generatedIconSize) => {
      if (!hasTauriInvoke()) {
        setError('Tauri API unavailable. Start with `npm run tauri dev`.')
        return
      }
      const runId = loadRunIdRef.current + 1
      loadRunIdRef.current = runId
      setLoading(true)
      setLoadingText('Preparing thumbnails...')
      setLoadingPhaseText('Scanning folder and checking cache...')
      setError('')
      setThumbnailDataByPath({})
      setStatus(`Scanning ${folder}...`)
      try {
        const response = await invoke('load_gallery', {
          folderPath: folder,
          thumbnailSize: generatedIconSize,
        })
        if (runId !== loadRunIdRef.current) {
          return
        }
        const galleryItems = Array.isArray(response?.items) ? response.items : []
        const thumbnails =
          response?.thumbnails && typeof response.thumbnails === 'object'
            ? response.thumbnails
            : {}
        setItems(galleryItems)
        setThumbnailDataByPath(thumbnails)
        if (response?.cancelled) {
          setStatus(`Stopped. Loaded ${formatImageCount(galleryItems.length)} before cancel.`)
        } else {
          setStatus(`Loaded ${formatImageCount(galleryItems.length)}.`)
        }
      } catch (invokeError) {
        if (runId !== loadRunIdRef.current) {
          return
        }
        setItems([])
        setThumbnailDataByPath({})
        setStatus('Failed to load folder.')
        setError(String(invokeError))
      } finally {
        if (runId === loadRunIdRef.current) {
          setLoading(false)
          setLoadingText('Loading images...')
          setLoadingPhaseText('')
          await refreshCacheInfo()
        }
      }
    },
    [refreshCacheInfo],
  )

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
    refreshCacheInfo()
  }, [refreshCacheInfo])

  useEffect(() => {
    if (!selectedFolder) {
      return
    }
    loadGallery(selectedFolder, generatedIconSize)
  }, [generatedIconSize, loadGallery, selectedFolder])

  useEffect(() => {
    if (!hasTauriInvoke()) {
      return undefined
    }

    let disposed = false
    let unlistenFileDrop
    let unlistenDragDrop
    let unlistenOpenFolder

    function handleFolderDrop(event) {
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
    }

    function handleOpenFolder(event) {
      const nextFolder = typeof event.payload === 'string' ? event.payload : ''
      if (!nextFolder) {
        return
      }
      setSelectedFolder(nextFolder)
    }

    async function registerDropListeners() {
      try {
        unlistenFileDrop = await listen('tauri://file-drop', handleFolderDrop)
        unlistenDragDrop = await listen('tauri://drag-drop', handleFolderDrop)
        unlistenOpenFolder = await listen('open-folder', handleOpenFolder)
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
      if (unlistenOpenFolder) {
        unlistenOpenFolder()
      }
    }
  }, [loadGallery])

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

  async function clearThumbnailCache() {
    if (!hasTauriInvoke() || cacheBusy || loading) {
      return
    }
    setCacheBusy(true)
    clearError()
    try {
      const response = await invoke('clear_thumbnail_cache')
      const dbSizeBytes = Number(response?.dbSizeBytes ?? 0)
      if (Number.isFinite(dbSizeBytes)) {
        setCacheDbSizeBytes(Math.max(0, Math.round(dbSizeBytes)))
      }
      setStatus('Thumbnail cache cleared.')
    } catch (invokeError) {
      setError(String(invokeError))
    } finally {
      setCacheBusy(false)
    }
  }

  function clearError(nextValue = '') {
    setError(nextValue)
  }

  return {
    selectedFolder,
    setSelectedFolder,
    items,
    status,
    loading,
    loadingText,
    loadingPhaseText,
    error,
    clearError,
    loadGallery,
    stopGalleryScan,
    clearThumbnailCache,
    thumbnailDataByPath,
    cacheDbSizeBytes,
    cacheBusy,
  }
}
