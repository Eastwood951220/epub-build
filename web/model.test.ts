import { describe, expect, it } from 'vitest'
import { chapterGroups, chapterStyle, createEmptyProject, previewStyles, reindexChapterLinks, resolveStyle } from './model'

describe('project model', () => {
  it('starts with an editable chapter', () => {
    const book = createEmptyProject()
    expect(book.chapters).toHaveLength(1)
    expect(book.chapters[0].html).toContain('<p>')
  })

  it('applies global title and body styles to preview', () => {
    const book = createEmptyProject()
    book.style.bodyFontSize = 22
    book.style.titleAlign = 'right'
    const css = previewStyles(book.style)
    expect(css['--body-size']).toBe('22px')
    expect(css['--title-align']).toBe('right')
    book.style.bodyFontFamily = 'Songti SC'
    expect(previewStyles(book.style)['--body-font']).toBe("'Songti SC', serif")
  })

  it('keeps links pointing to the same chapter after reordering', () => {
    const before = [
      { id: 'a', title: 'One', html: '<p><a href="chapter-2.xhtml#end">next</a></p>' },
      { id: 'b', title: 'Two', html: '<p id="end">Finish</p>' },
    ]
    const after = reindexChapterLinks(before, [before[1], before[0]])
    expect(after[1].html).toContain('href="chapter-1.xhtml#end"')
  })
})

describe('volumes', () => {
  const volume = (id: string, title: string, style = {}) => ({ id, title, style, openingImage: null, closingImage: null })
  const chapter = (id: string, volumeId?: string | null) => ({ id, title: id, volumeId, html: '<p>正文</p>' })

  it('inherits the book style until a volume overrides a value', () => {
    const book = createEmptyProject()
    const resolved = resolveStyle(book.style, { bodyFontSize: 24, bodyFontFamily: undefined })
    expect(resolved.bodyFontSize).toBe(24)
    expect(resolved.bodyFontFamily).toBe(book.style.bodyFontFamily)
    expect(resolved.titleAlign).toBe(book.style.titleAlign)
  })

  it('applies the volume style to its chapters only', () => {
    const book = createEmptyProject()
    book.volumes = [{ ...volume('v1', '第一卷', { bodyFontSize: 22 }), style: { bodyFontSize: 22 } }]
    book.chapters = [{ id: 'a', title: '一', volumeId: 'v1', html: '<p>甲</p>' }, { id: 'b', title: '二', html: '<p>乙</p>' }]
    expect(chapterStyle(book, book.chapters[0]).bodyFontSize).toBe(22)
    expect(chapterStyle(book, book.chapters[1]).bodyFontSize).toBe(book.style.bodyFontSize)
  })

  it('groups consecutive chapters by volume and keeps empty volumes visible', () => {
    const groups = chapterGroups(
      [chapter('a', 'v1'), chapter('b', 'v1'), chapter('c'), chapter('d', 'v2')],
      [volume('v1', '第一卷'), volume('v2', '第二卷'), volume('v3', '空卷')],
    )
    expect(groups.map(group => group.volume?.id ?? null)).toEqual(['v1', null, 'v2', 'v3'])
    expect(groups[0].chapters).toHaveLength(2)
    expect(groups[3].chapters).toHaveLength(0)
  })
})
