import { describe, expect, it } from 'vitest'
import { scanImageBatch } from './chapterImageScan'

describe('chapter image scanning', () => {
  it('scans a bounded batch and reuses unchanged chapter results', () => {
    const chapters = Array.from({ length: 25 }, (_, index) => ({ id: String(index), html: `body-${index}` }))
    const cache = new Map<string, { html: string; count: number }>()
    let calls = 0
    const count = () => { calls += 1; return 1 }
    expect(scanImageBatch(chapters, cache, 0, 10, count)).toEqual({ next: 10, count: 10 })
    expect(calls).toBe(10)
    expect(scanImageBatch(chapters, cache, 0, 10, count)).toEqual({ next: 10, count: 10 })
    expect(calls).toBe(10)
    chapters[0] = { ...chapters[0], html: 'changed' }
    scanImageBatch(chapters, cache, 0, 10, count)
    expect(calls).toBe(11)
  })
})
