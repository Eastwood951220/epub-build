export function visibleRows(scrollTop: number, viewportHeight: number, rowCount: number, rowHeight: number, overscan = 4) {
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
  const end = Math.min(rowCount, Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan)
  return { start, end }
}

export const LEFT_PANEL_MIN_WIDTH = 240
export const RIGHT_PANEL_MIN_WIDTH = 300
export const LEFT_PANEL_DEFAULT_WIDTH = 280
export const RIGHT_PANEL_DEFAULT_WIDTH = 350

export function initialPanelWidth(stored: string | null, oldDefault: number, defaultWidth: number, minimumWidth: number) {
  const width = stored === null ? NaN : Number(stored)
  if (!Number.isFinite(width) || width <= 0 || width === oldDefault) return defaultWidth
  return Math.max(minimumWidth, Math.min(480, width))
}

export function clampPanelWidth(requested: number, containerWidth: number, oppositeWidth: number, minimumWidth: number) {
  // Reserve both 6px dividers and at least 500px for the editor.
  const maximum = Math.max(minimumWidth, Math.min(480, containerWidth - oppositeWidth - 512))
  return Math.max(minimumWidth, Math.min(maximum, requested))
}
