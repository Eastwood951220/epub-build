import { describe, expect, it } from 'vitest'
import { parseHexColor } from './HexColorInput'

describe('hex color entry', () => {
  it('accepts six hex digits without a hash and normalizes the saved color', () => {
    expect(parseHexColor('8B3F32')).toBe('#8b3f32')
  })

  it('accepts a hash and surrounding whitespace', () => {
    expect(parseHexColor(' #8B3F32 ')).toBe('#8b3f32')
  })

  it('rejects incomplete and invalid colors', () => {
    expect(parseHexColor('8B3F3')).toBeNull()
    expect(parseHexColor('8B3F3Z')).toBeNull()
  })
})
