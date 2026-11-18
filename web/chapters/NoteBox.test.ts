import { describe, expect, it, vi } from 'vitest'
import type { Editor } from '@tiptap/core'
import { appendNoteBox } from './NoteBox'

describe('chapter-end tip', () => {
  it('appends a standalone tip after the last body block without a note marker', () => {
    const run = vi.fn()
    const insertContentAt = vi.fn(() => ({ run }))
    const focus = vi.fn(() => ({ insertContentAt }))
    const editor = {
      state: { doc: { content: { size: 42 } }, selection: { $to: { pos: 12 } } },
      chain: () => ({ focus }),
    } as unknown as Editor

    appendNoteBox(editor)

    expect(insertContentAt).toHaveBeenCalledWith(42, {
      type: 'noteBox',
      content: [
        { type: 'noteBoxTitle', content: [{ type: 'text', text: '小贴士' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '输入备注内容' }] },
      ],
    })
    expect(run).toHaveBeenCalledOnce()
    appendNoteBox(editor, '史料补充')
    expect(insertContentAt).toHaveBeenLastCalledWith(42, expect.objectContaining({
      content: expect.arrayContaining([{ type: 'noteBoxTitle', content: [{ type: 'text', text: '史料补充' }] }]),
    }))
  })
})
