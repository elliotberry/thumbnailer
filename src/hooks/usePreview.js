import { useEffect, useMemo, useState } from 'react'
import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { hasTauriInvoke } from '../utils/gallery'

export function usePreview(items) {
  const [previewItem, setPreviewItem] = useState(null)
  const [previewImageSrc, setPreviewImageSrc] = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState('')

  const currentPreviewIndex = useMemo(() => {
    if (!previewItem) {
      return -1
    }
    return items.findIndex((item) => item.path === previewItem.path)
  }, [items, previewItem])

  const hasPreviousPreview = currentPreviewIndex > 0
  const hasNextPreview = currentPreviewIndex >= 0 && currentPreviewIndex < items.length - 1

  function closePreview() {
    setPreviewItem(null)
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
        closePreview()
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
        const assetUrl = convertFileSrc(previewItem.path)
        const assetLoaded = await new Promise((resolve) => {
          const probe = new Image()
          probe.onload = () => resolve(true)
          probe.onerror = () => resolve(false)
          probe.src = assetUrl
        })
        if (assetLoaded) {
          if (!cancelled) {
            setPreviewImageSrc(String(assetUrl))
          }
          return
        }

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

  return {
    previewItem,
    previewImageSrc,
    previewLoading,
    previewError,
    hasPreviousPreview,
    hasNextPreview,
    setPreviewItem,
    closePreview,
    goToPreview,
  }
}
