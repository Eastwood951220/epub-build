import { describe, expect, it } from 'vitest'
import { chapterBackgroundStyle, chapterGroups, chapterImagesAt, chapterImagesFor, chapterImageApplies, chapterStyle, createChapterImage, createEmptyProject, noteBoxStyle, previewStyles, reindexChapterLinks, resolveStyle } from './model'
import { orderedNotes, renderNoteMarkers } from '../chapters/notes'

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

  it('draws the tip box from its configurable style', () => {
    const book = createEmptyProject()
    expect(previewStyles(book.style)['--note-box-border']).toBe('1.5px solid #b38971')
    expect(previewStyles(book.style)['--note-box-radius']).toBe('0 22px 0 22px')
    book.style.noteBox = { borderWidth: 0 }
    expect(previewStyles(book.style)['--note-box-border']).toBe('none')
    book.style.noteBox = { borderWidth: 3, borderStyle: 'dashed', borderColor: '#123456', cornerRadius: 6, backgroundColor: '#fff8f0', backgroundImage: 'data:image/png;base64,AAA', backgroundSize: 'contain', titleBackground: '#222222', titleColor: '#eeeeee', textColor: '#333333' }
    const css = previewStyles(book.style)
    expect(css['--note-box-border']).toBe('3px dashed #123456')
    expect(css['--note-box-radius']).toBe('0 6px 0 6px')
    expect(css['--note-box-bg-color']).toBe('#fff8f0')
    expect(css['--note-box-bg-image']).toBe('url("data:image/png;base64,AAA")')
    expect(css['--note-box-bg-size']).toBe('contain')
    expect(css['--note-box-title-bg']).toBe('#222222')
    expect(css['--note-box-title-color']).toBe('#eeeeee')
    expect(css['--note-box-text-color']).toBe('#333333')
    expect(noteBoxStyle({ borderWidth: 2 }).borderColor).toBe('#b38971')
    expect(resolveStyle(book.style, { titleFontSize: 22 }).noteBox?.borderWidth).toBe(3)
  })

  it('uses the optional two-character first-line indent in preview and volume chapters', () => {
    const book = createEmptyProject()
    expect(book.style.bodyFirstLineIndent).toBe(false)
    expect(previewStyles(book.style)['--body-indent']).toBe('0')
    book.style.bodyFirstLineIndent = true
    expect(previewStyles(resolveStyle(book.style, { bodyFontSize: 24 }))['--body-indent']).toBe('2em')
  })

  it('uses configurable paragraph and chapter title spacing in preview and volume chapters', () => {
    const book = createEmptyProject()
    book.style.bodyParagraphSpacing = 1.4
    book.style.chapterBodySpacing = 72
    const css = previewStyles(resolveStyle(book.style, { bodyFontSize: 24 }))
    expect(css['--body-paragraph-spacing']).toBe('1.4em')
    expect(css['--chapter-body-spacing']).toBe('72px')
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

describe('chapter background', () => {
  it('uses the selected image and size on chapter pages', () => {
    const book = createEmptyProject()
    expect(chapterBackgroundStyle(book)).toEqual({})
    book.chapterBackgroundImage = 'data:image/png;base64,AAAA'
    book.style.chapterBackgroundSize = '100% 100%'
    expect(chapterBackgroundStyle(book)).toEqual({ backgroundImage: 'url("data:image/png;base64,AAAA")', backgroundSize: '100% 100%', backgroundRepeat: 'no-repeat', backgroundPosition: 'center top' })
  })
})

describe('chapter notes', () => {
  it('orders referenced notes by their position and updates marker numbers', () => {
    const chapter = { id: 'c', title: '章', html: '<p>乙<span data-note-id="b">[2]</span>甲<span data-note-id="a">[1]</span></p>', notes: [{ id: 'a', text: '甲注' }, { id: 'b', text: '乙注' }] }
    expect(orderedNotes(chapter).map(note => note.id)).toEqual(['b', 'a'])
    expect(renderNoteMarkers(chapter.html, orderedNotes(chapter))).toContain('class="note-marker" data-note-id="b">[1]</span>')
  })

  it('uses an image for the inline note marker when configured', () => {
    const html = '<p>正文<span data-note-id="a">[1]</span></p>'
    const notes = [{ id: 'a', text: '注释' }]
    expect(renderNoteMarkers(html, notes, 'data:image/png;base64,AAAA')).toContain('<img class="note-marker-image" src="data:image/png;base64,AAAA" alt="备注 1" />')
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

  it('keeps explicit chapter styles when a saved volume has null title overrides', () => {
    const book = createEmptyProject()
    book.style.chapterNameStyle = { fontFamily: 'EPUBStudioLibraryFont7', fontSize: 32, align: 'right' }
    book.volumes = [{ ...volume('v1', '第一卷'), style: {
      titleFontFamily: null, titleFontSize: null, titleAlign: null,
      bodyFontFamily: null, bodyFontSize: null, bodyLineHeight: null, bodyAlign: null,
    } }]
    book.chapters = [{ id: 'preface', title: '前言', html: '<p>前言</p>' }, { id: 'chapter', title: '第一章 开始', volumeId: 'v1', html: '<p>正文</p>' }]
    const preface = previewStyles(chapterStyle(book, book.chapters[0]))
    const chapter = previewStyles(chapterStyle(book, book.chapters[1]))
    expect(chapter['--chapter-name-font']).toBe(preface['--chapter-name-font'])
    expect(chapter['--chapter-name-size']).toBe('32px')
    expect(chapter['--chapter-name-align']).toBe('right')
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

describe('chapter images', () => {
  const chapter = (id: string, volumeId?: string | null) => ({ id, title: id, volumeId, html: '<p>正文</p>' })

  it('starts with no chapter images and defaults new ones to every chapter below the title', () => {
    const book = createEmptyProject()
    expect(book.chapterImages).toEqual([])
    const entry = createChapterImage('data:image/png;base64,AAAA')
    expect(entry.placement).toBe('below')
    expect(entry.scope).toEqual({ type: 'all' })
    expect(chapterImageApplies({ id: 'a' }, entry)).toBe(true)
  })

  it('limits an entry to the selected chapters or volumes', () => {
    const entry = createChapterImage('data:image/png;base64,AAAA')
    entry.scope = { type: 'chapters', ids: ['a'] }
    expect(chapterImageApplies({ id: 'a', volumeId: 'v1' }, entry)).toBe(true)
    expect(chapterImageApplies({ id: 'b', volumeId: 'v1' }, entry)).toBe(false)
    entry.scope = { type: 'volumes', ids: ['v1'] }
    expect(chapterImageApplies({ id: 'b', volumeId: 'v1' }, entry)).toBe(true)
    expect(chapterImageApplies({ id: 'c', volumeId: null }, entry)).toBe(false)
    expect(chapterImageApplies({ id: 'd' }, entry)).toBe(false)
  })

  it('keeps list order and splits images above and below the title', () => {
    const book = createEmptyProject()
    const above = { ...createChapterImage('a'), id: 'above', placement: 'above' as const }
    const all = { ...createChapterImage('b'), id: 'all' }
    const scoped = { ...createChapterImage('c'), id: 'scoped', scope: { type: 'chapters' as const, ids: ['other'] } }
    book.chapterImages = [above, all, scoped]
    const target = chapter('a', 'v1')
    expect(chapterImagesFor(book, target).map(entry => entry.id)).toEqual(['above', 'all'])
    expect(chapterImagesAt(book, target, 'above').map(entry => entry.id)).toEqual(['above'])
    expect(chapterImagesAt(book, target, 'below').map(entry => entry.id)).toEqual(['all'])
  })
})
