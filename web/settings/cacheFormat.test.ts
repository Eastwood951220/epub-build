import { describe, expect, it } from 'vitest'
import { formatBytes } from './cacheFormat'

describe('cache size formatting', () => {
  it('keeps small sizes in bytes and zero empty', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
  })

  it('steps through KB, MB and GB with one decimal', () => {
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(1536 * 1024)).toBe('1.5 MB')
    expect(formatBytes(3.25 * 1024 ** 3)).toBe('3.3 GB')
  })

  it('treats invalid input as empty', () => {
    expect(formatBytes(Number.NaN)).toBe('0 B')
    expect(formatBytes(-5)).toBe('0 B')
  })
})
