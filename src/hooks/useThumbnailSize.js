import { useEffect, useState } from 'react'
import {
  DEFAULT_THUMBNAIL_SIZE,
  THUMBNAIL_SIZE_STORAGE_KEY,
} from '../constants/thumbnail'
import { clampThumbnailSize } from '../utils/gallery'

export function useThumbnailSize() {
  const [thumbnailSize, setThumbnailSize] = useState(() => {
    if (typeof window === 'undefined') {
      return DEFAULT_THUMBNAIL_SIZE
    }
    const storedValue = Number(window.localStorage.getItem(THUMBNAIL_SIZE_STORAGE_KEY))
    if (!Number.isFinite(storedValue)) {
      return DEFAULT_THUMBNAIL_SIZE
    }
    return clampThumbnailSize(Math.round(storedValue))
  })

  useEffect(() => {
    window.localStorage.setItem(THUMBNAIL_SIZE_STORAGE_KEY, String(thumbnailSize))
  }, [thumbnailSize])

  return {
    thumbnailSize,
    setThumbnailSize: (value) => setThumbnailSize(clampThumbnailSize(Number(value))),
  }
}
