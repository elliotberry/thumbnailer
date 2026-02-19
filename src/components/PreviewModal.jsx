export function PreviewModal({
  previewItem,
  previewLoading,
  previewImageSrc,
  previewError,
  hasPreviousPreview,
  hasNextPreview,
  onClose,
  onGoLeft,
  onGoRight,
}) {
  if (!previewItem) {
    return null
  }

  return (
    <div className="previewModalBackdrop" onClick={onClose} role="presentation">
      <div className="previewModal" onClick={(event) => event.stopPropagation()}>
        <div className="previewHeader">
          <div className="previewNav">
            <button type="button" onClick={onGoLeft} disabled={!hasPreviousPreview}>
              Left
            </button>
            <button type="button" onClick={onGoRight} disabled={!hasNextPreview}>
              Right
            </button>
          </div>
          <p className="previewTitle">{previewItem.name}</p>
          <div className="previewNav">
            <button type="button" className="previewClose" onClick={onClose}>
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
  )
}
