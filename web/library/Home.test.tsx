import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import Home, { type WorkspaceSummary } from './Home'

const existing: WorkspaceSummary = {
  id: 1,
  title: '已有工程',
  author: '作者',
  chapterCount: 2,
  coverImage: null,
  updatedAt: '2026-11-19',
}

describe('bookshelf project creation', () => {
  it.each([{ workspaces: [] }, { workspaces: [existing] }])('keeps book and JSON imports without blank project creation', ({ workspaces }) => {
    const html = renderToStaticMarkup(<Home
      workspaces={workspaces}
      busy={false}
      error=""
      notice=""
      onOpen={async () => {}}
      onDelete={async () => {}}
      onImportBook={async () => {}}
      onImportProject={async () => {}}
    />)

    expect(html).toContain('导入 TXT / EPUB')
    expect(html).not.toContain('新建工程')
    expect(html).toContain('导入项目')
  })
})
