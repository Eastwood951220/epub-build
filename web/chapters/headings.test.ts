import { describe, expect, it } from 'vitest'
import { splitHeading } from './headings'
import { createEmptyProject, previewStyles, resolveStyle } from '../book/model'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import HeadingTitle from './HeadingTitle'

describe('two-line headings', () => {
  it('splits Chinese chapter and volume numbers from names', () => {
    expect(splitHeading('第87章 论·中式恐怖与西式恐怖', 'chapter')).toEqual({ number: '第87章', name: '论·中式恐怖与西式恐怖' })
    expect(splitHeading('第一卷：少年', 'volume')).toEqual({ number: '第一卷', name: '少年' })
    expect(splitHeading('前言', 'chapter')).toEqual({ number: '', name: '前言' })
    expect(splitHeading('第壹卷：少年', 'volume')).toEqual({ number: '第壹卷', name: '少年' })
    expect(splitHeading('第贰拾叁章 归途', 'chapter')).toEqual({ number: '第贰拾叁章', name: '归途' })
    expect(splitHeading('卷丨叁丨', 'volume')).toEqual({ number: '卷丨叁丨', name: '' })
    expect(splitHeading('卷丨玖丨 天下', 'volume')).toEqual({ number: '卷丨玖丨', name: '天下' })
  })

  it('resolves four line styles while preserving legacy title settings', () => {
    const book = createEmptyProject()
    book.style.titleFontFamily = 'PingFang SC'
    book.style.titleFontSize = 24
    book.style.chapterNumberStyle = { fontSize: 18, color: '#aa3344' }
    const css = previewStyles(resolveStyle(book.style, {}))
    expect(css['--chapter-number-size']).toBe('18px')
    expect(css['--chapter-number-color']).toBe('#aa3344')
    expect(css['--chapter-name-font']).toContain('PingFang SC')
    expect(css['--chapter-name-size']).toBe('24px')
  })

  it('applies a volume title override to both heading lines', () => {
    const book = createEmptyProject()
    book.style.chapterNumberStyle = { fontSize: 18 }
    book.style.chapterNameStyle = { fontSize: 30 }
    const css = previewStyles(resolveStyle(book.style, { titleFontSize: 25 }))
    expect(css['--chapter-number-size']).toBe('25px')
    expect(css['--chapter-name-size']).toBe('25px')
  })

  it('renders the same title inline or stacked per item', () => {
    const inline = renderToStaticMarkup(createElement(HeadingTitle, { title: '第一章 开始', kind: 'chapter', layout: 'inline' }))
    const stacked = renderToStaticMarkup(createElement(HeadingTitle, { title: '第一卷 少年', kind: 'volume', layout: 'stacked' }))
    expect(inline).toContain('title-inline')
    expect(stacked).toContain('title-stacked')
    expect(inline).toContain('heading-number')
    expect(inline).toContain('heading-name')
  })
})
