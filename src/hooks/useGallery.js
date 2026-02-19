import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { THUMBNAIL_LOAD_SIZE } from '../constants/thumbnail'
import { formatImageCount, getDroppedPaths, hasTauriInvoke } from '../utils/gallery'

export function useGallery() {
  const [selectedFolder, setSelectedFolder] = useState('')
  const [items, setItems] = useState([])
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingText, setLoadingText] = useState('Loading images...')
  const [error, setError] = useState('')
  const [thumbnailDataByPath, setThumbnailDataByPath] = useState({})
  const hydrationRunIdRef = useRef(0)
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
            thumbnailSize: THUMBNAIL_LOAD_SIZE,
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

  const loadGallery = useCallback(
    async (folder) => {
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
          thumbnailSize: THUMBNAIL_LOAD_SIZE,
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
    },
    [hydrateThumbnails],
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
    error,
    clearError,
    loadGallery,
    stopGalleryScan,
    thumbnailDataByPath,
  }
}
