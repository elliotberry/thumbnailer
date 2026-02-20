import { open } from '@tauri-apps/plugin-dialog'
import './App.css'
import { useMemo } from 'react'
import { hasTauriInvoke } from './utils/gallery'
import {
  MAX_THUMBNAIL_SIZE,
  MIN_THUMBNAIL_SIZE,
} from './constants/thumbnail'
import { useThumbnailSize } from './hooks/useThumbnailSize'
import { useGallery } from './hooks/useGallery'
import { usePreview } from './hooks/usePreview'
import { Toolbar } from './components/Toolbar'
import { StatusPanel } from './components/StatusPanel'
import { GalleryGrid } from './components/GalleryGrid'
import { PreviewModal } from './components/PreviewModal'

function App() {
  const { thumbnailSize, setThumbnailSize } = useThumbnailSize()
  const {
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
  } = useGallery()
  const {
    previewItem,
    previewImageSrc,
    previewLoading,
    previewError,
    hasPreviousPreview,
    hasNextPreview,
    setPreviewItem,
    closePreview,
    goToPreview,
  } = usePreview(items)

  const hasItems = items.length > 0
  const columnWidthPx = useMemo(() => thumbnailSize, [thumbnailSize])


  async function pickFolder() {
    clearError()
    if (!hasTauriInvoke()) {
      clearError('Folder picker requires Tauri runtime. Start with `npm run tauri dev`.')
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

  return (
    <main className="app">
      <Toolbar
        selectedFolder={selectedFolder}
        thumbnailSize={thumbnailSize}
        minThumbnailSize={MIN_THUMBNAIL_SIZE}
        maxThumbnailSize={MAX_THUMBNAIL_SIZE}
        onThumbnailSizeChange={setThumbnailSize}
        onPickFolder={pickFolder}
        onStop={stopGalleryScan}
        loading={loading}
      />

      <StatusPanel status={status} selectedFolder={selectedFolder} error={error} />

      <GalleryGrid
        loading={loading}
        loadingText={loadingText}
        hasItems={hasItems}
        columnWidthPx={columnWidthPx}
        items={items}
        thumbnailDataByPath={thumbnailDataByPath}
        onSelectItem={setPreviewItem}
      />

      <PreviewModal
        previewItem={previewItem}
        previewLoading={previewLoading}
        previewImageSrc={previewImageSrc}
        previewError={previewError}
        hasPreviousPreview={hasPreviousPreview}
        hasNextPreview={hasNextPreview}
        onClose={closePreview}
        onGoLeft={() => goToPreview(-1)}
        onGoRight={() => goToPreview(1)}
      />
    </main>
  )
}

export default App
