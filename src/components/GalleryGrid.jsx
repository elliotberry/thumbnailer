import { memo } from 'react'
import { Grid } from 'react-window'
import { AutoSizer } from 'react-virtualized-auto-sizer'

const GRID_GAP_PX = 12
const CARD_INFO_HEIGHT_PX = 64

const GalleryCell = memo(function GalleryCell({
  ariaAttributes,
  columnIndex,
  rowIndex,
  style,
  items,
  columnCount,
  columnWidthPx,
  thumbnailDataByPath,
  onSelectItem,
  horizontalOffsetPx,
}) {
  const index = rowIndex * columnCount + columnIndex
  if (index >= items.length) {
    return null
  }

  const item = items[index]
  const width =
    typeof style.width === 'number'
      ? Math.max(1, style.width - GRID_GAP_PX)
      : `calc(${style.width} - ${GRID_GAP_PX}px)`
  const height =
    typeof style.height === 'number'
      ? Math.max(1, style.height - GRID_GAP_PX)
      : `calc(${style.height} - ${GRID_GAP_PX}px)`

  const cellStyle = {
    ...style,
    left: typeof style.left === 'number' ? style.left + horizontalOffsetPx : style.left,
    top: typeof style.top === 'number' ? style.top + GRID_GAP_PX / 2 : style.top,
    width,
    height,
  }

  return (
    <div style={cellStyle} {...ariaAttributes}>
      <article className="card" style={{ width: `${columnWidthPx}px`, height: '100%' }}>
        <button
          type="button"
          className="thumbButton"
          onClick={() => onSelectItem(item)}
          title={`Open ${item.name}`}
        >
          {thumbnailDataByPath[item.path] ? (
            <img src={thumbnailDataByPath[item.path]} alt={item.name} loading="lazy" />
          ) : (
            <div className="thumbPlaceholder" />
          )}
        </button>
        <div className="cardInfo">
          <p className="name">{item.name}</p>
        </div>
      </article>
    </div>
  )
})

export function GalleryGrid({
  loading,
  loadingText,
  hasItems,
  selectedFolder,
  emptyMessage,
  columnWidthPx,
  items,
  thumbnailDataByPath,
  onSelectItem,
}) {
  const rowHeightPx = columnWidthPx + CARD_INFO_HEIGHT_PX + GRID_GAP_PX
  const cellWidthPx = columnWidthPx + GRID_GAP_PX

  return (
    <section className="gallery" style={{ '--thumb-column-width': `${columnWidthPx}px` }}>
      {loading && (
        <div className="loadingOverlay" aria-live="polite" aria-busy="true">
          <div className="spinner" />
          <p>{loadingText}</p>
        </div>
      )}
      {!hasItems && selectedFolder && <div className="empty">{emptyMessage}</div>}
      {hasItems && (
        <div className="galleryViewport">
          <AutoSizer
            renderProp={({ width, height }) => {
              const safeWidth = Number(width ?? 0)
              const safeHeight = Number(height ?? 0)
              if (safeWidth <= 0 || safeHeight <= 0) {
                return null
              }

              const columnCount = Math.max(1, Math.floor(safeWidth / cellWidthPx))
              const rowCount = Math.ceil(items.length / columnCount)
              const usedWidth = columnCount * cellWidthPx
              const horizontalOffsetPx = Math.max(0, Math.floor((safeWidth - usedWidth) / 2))

              return (
                <Grid
                  className="galleryGrid"
                  cellComponent={GalleryCell}
                  cellProps={{
                    items,
                    columnCount,
                    columnWidthPx,
                    thumbnailDataByPath,
                    onSelectItem,
                    horizontalOffsetPx,
                  }}
                  columnCount={columnCount}
                  columnWidth={cellWidthPx}
                  rowCount={rowCount}
                  rowHeight={rowHeightPx}
                  overscanCount={2}
                  style={{ width: safeWidth, height: safeHeight }}
                />
              )
            }}
          />
        </div>
      )}
    </section>
  )
}
