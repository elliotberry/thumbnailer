import {
  MAX_GENERATED_ICON_SIZE,
  MAX_THUMBNAIL_SIZE,
  MIN_GENERATED_ICON_SIZE,
  MIN_THUMBNAIL_SIZE,
} from '../constants/thumbnail'

export function clampThumbnailSize(value) {
  return Math.max(MIN_THUMBNAIL_SIZE, Math.min(MAX_THUMBNAIL_SIZE, value))
}

export function clampGeneratedIconSize(value) {
  return Math.max(MIN_GENERATED_ICON_SIZE, Math.min(MAX_GENERATED_ICON_SIZE, value))
}

export function hasTauriInvoke() {
  return Boolean(window.__TAURI_INTERNALS__?.invoke)
}

export function formatImageCount(count) {
  const safeCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0
  return `${safeCount} image${safeCount === 1 ? '' : 's'}`
}

export function formatByteSize(value) {
  const safeValue = Number.isFinite(value) ? Math.max(0, Number(value)) : 0
  if (safeValue < 1024) {
    return `${Math.round(safeValue)} B`
  }
  const units = ['KB', 'MB', 'GB', 'TB']
  let unitIndex = -1
  let current = safeValue
  while (current >= 1024 && unitIndex < units.length - 1) {
    current /= 1024
    unitIndex += 1
  }
  const rounded = current >= 10 ? current.toFixed(1) : current.toFixed(2)
  return `${rounded} ${units[unitIndex]}`
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
