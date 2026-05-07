import { open } from '@tauri-apps/plugin-dialog'
import './App.css'
import { useMemo } from 'react'
import { formatByteSize, hasTauriInvoke } from './utils/gallery'
import {
  MAX_GENERATED_ICON_SIZE,
  MAX_THUMBNAIL_SIZE,
  MIN_GENERATED_ICON_SIZE,
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
  const { thumbnailSize, setThumbnailSize, generatedIconSize, setGeneratedIconSize } =
    useThumbnailSize()
  const {
    selectedFolder,
    setSelectedFolder,
    items,
    status,
    loading,
    loadingText,
    error,
    clearError,
    stopGalleryScan,
    clearThumbnailCache,
    thumbnailDataByPath,
    cacheDbSizeBytes,
    cacheBusy,
  } = useGallery(generatedIconSize)
  const {
    previewItem,
    previewImageSrc,
    previewLoading,
    previewError,
    previewPosition,
    previewTotal,
    setPreviewItem,
    closePreview,
  } = usePreview(items)

  const hasItems = items.length > 0
  const columnWidthPx = useMemo(() => thumbnailSize, [thumbnailSize])
  const cacheDbSizeLabel = useMemo(() => formatByteSize(cacheDbSizeBytes), [cacheDbSizeBytes])


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
  }

  return (
    <main className="app">
      <Toolbar
        selectedFolder={selectedFolder}
        thumbnailSize={thumbnailSize}
        minThumbnailSize={MIN_THUMBNAIL_SIZE}
        maxThumbnailSize={MAX_THUMBNAIL_SIZE}
        onThumbnailSizeChange={setThumbnailSize}
        generatedIconSize={generatedIconSize}
        minGeneratedIconSize={MIN_GENERATED_ICON_SIZE}
        maxGeneratedIconSize={MAX_GENERATED_ICON_SIZE}
        onGeneratedIconSizeChange={setGeneratedIconSize}
        onPickFolder={pickFolder}
        onStop={stopGalleryScan}
        onClearCache={clearThumbnailCache}
        cacheDbSizeLabel={cacheDbSizeLabel}
        cacheBusy={cacheBusy}
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
        previewPosition={previewPosition}
        previewTotal={previewTotal}
        onClose={closePreview}
      />
    </main>
  )
}

export default App
