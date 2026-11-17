import { describe, expect, it } from 'vitest'
import type { EditableChapter, Volume } from './model'
import { findReplace } from './findReplace'

const chapters: EditableChapter[] = [
  { id: '1', title: 'Chapter 1', html: '<p data-note="Chapter">Chapter &amp; chapter</p>' },
  { id: '2', title: 'chapter 2', html: '<p><strong>Chapter</strong> end</p>' },
]
const volumes = [{ id: 'v', title: 'Chapter collection', style: {} }] as Volume[]
const scope = { titles: true, body: true, volumes: true }

describe('findReplace', () => {
  it('previews scoped matches without changing the book', () => {
    const result = findReplace(chapters, volumes, { find: 'Chapter', replacement: 'Part', regex: false, matchCase: true, scope }, false)
    expect(result.matches).toBe(4)
    expect(result.chapters).toBe(chapters)
    expect(result.volumes).toBe(volumes)
  })

  it('supports case insensitive regex groups across selected fields', () => {
    const result = findReplace(chapters, volumes, {
      find: 'chapter (\\d+)', replacement: '第$1章', regex: true, matchCase: false,
      scope: { titles: true, body: false, volumes: false },
    }, true)
    expect(result.matches).toBe(2)
    expect(result.chapters.map(item => item.title)).toEqual(['第1章', '第2章'])
    expect(result.chapters[0].html).toBe(chapters[0].html)
    expect(result.volumes).toBe(volumes)
  })

  it('keeps replacement literal in plain mode and protects HTML attributes', () => {
    const result = findReplace(chapters, volumes, {
      find: 'Chapter', replacement: '$1 <新>', regex: false, matchCase: true,
      scope: { titles: false, body: true, volumes: false },
    }, true)
    expect(result.matches).toBe(2)
    expect(result.chapters[0].html).toBe('<p data-note="Chapter">$1 &lt;新&gt; &amp; chapter</p>')
    expect(result.chapters[1].html).toBe('<p><strong>$1 &lt;新&gt;</strong> end</p>')
  })

  it('treats regex characters literally in plain mode', () => {
    const result = findReplace([{ id: 'a', title: 'a.b', html: '<p>a?b</p>' }], [], {
      find: '.', replacement: '$&', regex: false, matchCase: true,
      scope: { titles: true, body: true, volumes: false },
    }, true)
    expect(result.matches).toBe(1)
    expect(result.chapters[0].title).toBe('a$&b')
  })

  it('matches decoded HTML entities and preserves markup', () => {
    const result = findReplace(chapters, volumes, {
      find: '&', replacement: '和', regex: false, matchCase: true,
      scope: { titles: false, body: true, volumes: false },
    }, true)
    expect(result.matches).toBe(1)
    expect(result.chapters[0].html).toBe('<p data-note="Chapter">Chapter 和 chapter</p>')
  })

  it('reports invalid regexes and rejects an empty search', () => {
    expect(findReplace(chapters, volumes, { find: '[', replacement: '', regex: true, matchCase: true, scope }, false).error).toBeTruthy()
    expect(findReplace(chapters, volumes, { find: '', replacement: '', regex: false, matchCase: true, scope }, false).matches).toBe(0)
  })
})
