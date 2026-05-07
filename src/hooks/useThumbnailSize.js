import { useEffect, useState } from 'react'
import {
  DEFAULT_GENERATED_ICON_SIZE,
  DEFAULT_THUMBNAIL_SIZE,
  GENERATED_ICON_SIZE_STORAGE_KEY,
  THUMBNAIL_SIZE_STORAGE_KEY,
} from '../constants/thumbnail'
import { clampGeneratedIconSize, clampThumbnailSize } from '../utils/gallery'

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
  const [generatedIconSize, setGeneratedIconSize] = useState(() => {
    if (typeof window === 'undefined') {
      return DEFAULT_GENERATED_ICON_SIZE
    }
    const storedValue = Number(window.localStorage.getItem(GENERATED_ICON_SIZE_STORAGE_KEY))
    if (!Number.isFinite(storedValue)) {
      return DEFAULT_GENERATED_ICON_SIZE
    }
    return clampGeneratedIconSize(Math.round(storedValue))
  })

  useEffect(() => {
    window.localStorage.setItem(THUMBNAIL_SIZE_STORAGE_KEY, String(thumbnailSize))
  }, [thumbnailSize])

  useEffect(() => {
    window.localStorage.setItem(GENERATED_ICON_SIZE_STORAGE_KEY, String(generatedIconSize))
  }, [generatedIconSize])

  return {
    thumbnailSize,
    setThumbnailSize: (value) => setThumbnailSize(clampThumbnailSize(Number(value))),
    generatedIconSize,
    setGeneratedIconSize: (value) => setGeneratedIconSize(clampGeneratedIconSize(Number(value))),
  }
}
