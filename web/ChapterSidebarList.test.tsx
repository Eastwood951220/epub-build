import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import ChapterSidebarList from './ChapterSidebarList'
import { createEmptyProject } from './model'

describe('chapter sidebar', () => {
  it('keeps a thousand-chapter book to a small rendered window', () => {
    const template = createEmptyProject().chapters[0]
    const chapters = Array.from({ length: 1000 }, (_, index) => ({ ...template, id: String(index), title: `章节 ${index}` }))
    const html = renderToStaticMarkup(<ChapterSidebarList
      groups={[{ chapters }]}
      collapsedVolumeIds={[]}
      selectedId="0"
      chapterCount={chapters.length}
      onSelectChapter={() => {}}
      onToggleVolume={() => {}}
      onVolumeSettings={() => {}}
      onEditTitle={() => {}}
      onMoveChapter={() => {}}
      onDeleteChapter={() => {}}
    />)
    expect((html.match(/class="chapter-item/g) ?? []).length).toBeLessThan(30)
    expect(html).toContain('章节 0')
    expect(html).not.toContain('章节 999')
  })
})
