import { describe, expect, it } from 'vitest'
import { clampPanelWidth, visibleRows } from './editorLayout'

describe('editor layout', () => {
  it('renders only a small window from a long chapter list', () => {
    expect(visibleRows(4600, 460, 1000, 46, 4)).toEqual({ start: 96, end: 114 })
  })

  it('keeps the final row visible near the end', () => {
    expect(visibleRows(46000, 460, 1000, 46, 4)).toEqual({ start: 996, end: 1000 })
  })

  it('bounds each side panel to leave room for the editor', () => {
    expect(clampPanelWidth(900, 1200, 300)).toBe(480)
    expect(clampPanelWidth(100, 1200, 300)).toBe(200)
  })
})
