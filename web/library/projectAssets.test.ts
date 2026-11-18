import { describe, expect, it } from 'vitest'
import type { ProjectAssetRef } from '../platform/backend'
import { assetMeta, kindLabel, markShared, pendingAssets } from './projectAssets'

const entry = (key: string, inLibrary = false): ProjectAssetRef =>
  ({ key, name: `${key}.png`, mime: 'image/png', size: 2048, inLibrary })

describe('project asset actions', () => {
  it('only copies entries the shared library is still missing', () => {
    expect(pendingAssets([entry('a'), entry('b', true), entry('c')]).map(item => item.key)).toEqual(['a', 'c'])
    expect(pendingAssets([])).toEqual([])
  })

  it('marks the extracted entries as shared without touching the other kind', () => {
    const group = { fonts: [entry('f1')], images: [entry('i1'), entry('i2')] }
    const next = markShared(group, 'image', ['i1'])

    expect(next.images.map(item => item.inLibrary)).toEqual([true, false])
    expect(next.fonts[0].inLibrary).toBe(false)
    // The source group is left alone so React state stays predictable.
    expect(group.images[0].inLibrary).toBe(false)
  })

  it('labels both kinds for headings and buttons', () => {
    expect(kindLabel('font')).toBe('字体')
    expect(kindLabel('image')).toBe('图片')
  })

  it('formats size and format for the card caption', () => {
    expect(assetMeta({ mime: 'image/png', size: 2048 })).toBe('PNG · 2 KB')
    expect(assetMeta({ mime: 'font/woff2', size: 1536 * 1024 })).toBe('WOFF2 · 1.5 MB')
    expect(assetMeta({ mime: 'image/svg+xml', size: 40 })).toBe('SVG · 1 KB')
  })
})
