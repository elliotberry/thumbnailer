import { MAX_THUMBNAIL_SIZE, MIN_THUMBNAIL_SIZE } from '../constants/thumbnail'

export function clampThumbnailSize(value) {
  return Math.max(MIN_THUMBNAIL_SIZE, Math.min(MAX_THUMBNAIL_SIZE, value))
}

export function hasTauriInvoke() {
  return Boolean(window.__TAURI_INTERNALS__?.invoke)
}

export function formatImageCount(count) {
  const safeCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0
  return `${safeCount} image${safeCount === 1 ? '' : 's'}`
}

export function getDroppedPaths(payload) {
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
