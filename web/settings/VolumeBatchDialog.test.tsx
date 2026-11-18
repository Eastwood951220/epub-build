import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import VolumeBatchDialog from './VolumeBatchDialog'
import type { Volume } from '../book/model'

const volumes: Volume[] = [
  { id: 'v1', title: '卷壹丨风起', style: {}, openingImage: null, closingImage: null },
  { id: 'v2', title: '第2卷 云涌', style: {}, openingImage: null, closingImage: null },
]

describe('volume batch dialog', () => {
  it('lists every volume with its chapter count and the numbering controls', () => {
    const html = renderToStaticMarkup(createElement(VolumeBatchDialog, {
      volumes,
      chapterCount: id => (id === 'v1' ? 12 : 3),
      onCancel: () => {},
      onSave: () => {},
    }))
    expect(html).toContain('卷批量编辑')
    expect(html).toContain('卷壹丨风起')
    expect(html).toContain('第2卷 云涌')
    expect(html).toContain('12 章')
    expect(html).toContain('保存 2 卷标题')
    expect(html).toContain('大写汉字')
    expect(html).toContain('全部替换')
  })

  it('explains the empty state when the book has no volumes', () => {
    const html = renderToStaticMarkup(createElement(VolumeBatchDialog, {
      volumes: [],
      chapterCount: () => 0,
      onCancel: () => {},
      onSave: () => {},
    }))
    expect(html).toContain('还没有卷')
  })
})
