import { describe, expect, it } from 'vitest'
import {
  clampPanelWidth, initialPanelWidth, LEFT_PANEL_DEFAULT_WIDTH, LEFT_PANEL_MIN_WIDTH,
  RIGHT_PANEL_DEFAULT_WIDTH, RIGHT_PANEL_MIN_WIDTH, visibleRows,
} from './editorLayout'

describe('editor layout', () => {
  it('renders only a small window from a long chapter list', () => {
    expect(visibleRows(4600, 460, 1000, 46, 4)).toEqual({ start: 96, end: 114 })
  })

  it('keeps the final row visible near the end', () => {
    expect(visibleRows(46000, 460, 1000, 46, 4)).toEqual({ start: 996, end: 1000 })
  })

  it('bounds each side panel to leave room for the editor', () => {
    expect(clampPanelWidth(900, 1600, 350, LEFT_PANEL_MIN_WIDTH)).toBe(480)
    expect(clampPanelWidth(100, 1200, 350, LEFT_PANEL_MIN_WIDTH)).toBe(240)
    expect(clampPanelWidth(900, 1200, 280, RIGHT_PANEL_MIN_WIDTH)).toBe(408)
  })

  it('upgrades old defaults while preserving custom panel sizes', () => {
    expect(initialPanelWidth('240', 240, LEFT_PANEL_DEFAULT_WIDTH, LEFT_PANEL_MIN_WIDTH)).toBe(280)
    expect(initialPanelWidth('294', 294, RIGHT_PANEL_DEFAULT_WIDTH, RIGHT_PANEL_MIN_WIDTH)).toBe(350)
    expect(initialPanelWidth('410', 294, RIGHT_PANEL_DEFAULT_WIDTH, RIGHT_PANEL_MIN_WIDTH)).toBe(410)
    expect(initialPanelWidth('260', 294, RIGHT_PANEL_DEFAULT_WIDTH, RIGHT_PANEL_MIN_WIDTH)).toBe(300)
  })
})
