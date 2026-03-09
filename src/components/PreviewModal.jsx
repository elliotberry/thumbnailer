export function PreviewModal({
  previewItem,
  previewLoading,
  previewImageSrc,
  previewError,
  previewPosition,
  previewTotal,
  onClose,
}) {
  if (!previewItem) {
    return null
  }

  return (
    <div className="previewModalBackdrop" onClick={onClose} role="presentation">
      <div className="previewModal" onClick={(event) => event.stopPropagation()}>
        <div className="previewHeader">
          <p className="previewCounter">{`${previewPosition}/${previewTotal}`}</p>
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
