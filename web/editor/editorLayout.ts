export function visibleRows(scrollTop: number, viewportHeight: number, rowCount: number, rowHeight: number, overscan = 4) {
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
  const end = Math.min(rowCount, Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan)
  return { start, end }
}

export function clampPanelWidth(requested: number, containerWidth: number, oppositeWidth: number) {
  const maximum = Math.max(200, Math.min(480, containerWidth - oppositeWidth - 412))
  return Math.max(200, Math.min(maximum, requested))
}
