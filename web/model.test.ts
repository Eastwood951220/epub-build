import { describe, expect, it } from 'vitest'
import { createEmptyProject, previewStyles, reindexChapterLinks } from './model'

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
