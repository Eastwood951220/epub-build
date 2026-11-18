import { describe, expect, it, vi } from 'vitest'
import type { Editor } from '@tiptap/core'
import { Schema } from '@tiptap/pm/model'
import { EditorState } from '@tiptap/pm/state'
import { appendNoteBox, hasNoteBox, removeNoteBoxes } from './NoteBox'

describe('chapter-end tip', () => {
  it('appends a standalone tip after the last body block without a note marker', () => {
    const run = vi.fn()
    const insertContentAt = vi.fn(() => ({ run }))
    const focus = vi.fn(() => ({ insertContentAt }))
    const editor = {
      state: { doc: { content: { size: 42 }, forEach: () => {} }, selection: { $to: { pos: 12 } } },
      chain: () => ({ focus }),
    } as unknown as Editor

    expect(appendNoteBox(editor)).toBe('created')

    expect(insertContentAt).toHaveBeenCalledWith(42, {
      type: 'noteBox',
      content: [
        { type: 'noteBoxTitle', content: [{ type: 'text', text: '小贴士' }] },
        { type: 'paragraph' },
      ],
    })
    expect(run).toHaveBeenCalledOnce()
    appendNoteBox(editor, '史料补充')
    expect(insertContentAt).toHaveBeenLastCalledWith(42, expect.objectContaining({
      content: expect.arrayContaining([{ type: 'noteBoxTitle', content: [{ type: 'text', text: '史料补充' }] }]),
    }))
  })

  it('adds an empty line inside an existing tip instead of creating another box', () => {
    const run = vi.fn()
    const insertContentAt = vi.fn(() => ({ run }))
    const focus = vi.fn(() => ({ insertContentAt }))
    const editor = {
      state: { doc: { content: { size: 30 }, forEach: (visit: (node: unknown, offset: number) => void) => {
        visit({ type: { name: 'paragraph' }, nodeSize: 10 }, 0)
        visit({ type: { name: 'noteBox' }, nodeSize: 20 }, 10)
      } } },
      chain: () => ({ focus }),
    } as unknown as Editor

    expect(hasNoteBox(editor)).toBe(true)
    expect(appendNoteBox(editor)).toBe('appended')
    expect(insertContentAt).toHaveBeenCalledWith(29, { type: 'paragraph' })
  })

  it('deletes all tip boxes in a chapter so old duplicates can be removed', () => {
    const run = vi.fn()
    const deleteRange = vi.fn(() => ({ deleteRange, run }))
    const focus = vi.fn(() => ({ deleteRange }))
    const editor = {
      state: { doc: { forEach: (visit: (node: unknown, offset: number) => void) => {
        visit({ type: { name: 'noteBox' }, nodeSize: 8 }, 0)
        visit({ type: { name: 'paragraph' }, nodeSize: 6 }, 8)
        visit({ type: { name: 'noteBox' }, nodeSize: 10 }, 14)
      } } },
      chain: () => ({ focus }),
    } as unknown as Editor

    expect(removeNoteBoxes(editor)).toBe(2)
    expect(deleteRange.mock.calls).toEqual([[{ from: 14, to: 24 }], [{ from: 0, to: 8 }]])
    expect(run).toHaveBeenCalledOnce()
  })

  it('merges old duplicate tips at the chapter end while keeping their content', () => {
    const schema = new Schema({ nodes: {
      doc: { content: 'block+' },
      paragraph: { group: 'block', content: 'text*' },
      noteBox: { group: 'block', content: 'noteBoxTitle paragraph+' },
      noteBoxTitle: { content: 'text*' },
      text: { group: 'inline' },
    } })
    const paragraph = (text: string) => schema.nodes.paragraph.create(null, text ? schema.text(text) : undefined)
    const tip = (title: string, text: string) => schema.nodes.noteBox.create(null, [schema.nodes.noteBoxTitle.create(null, schema.text(title)), paragraph(text)])
    let state = EditorState.create({ doc: schema.nodes.doc.create(null, [tip('小贴士', '甲'), paragraph('正文'), tip('史料补充', '乙')]) })
    const editor = {
      get state() { return state },
      view: { dispatch: (transaction: typeof state.tr) => { state = state.apply(transaction) } },
    } as unknown as Editor

    expect(appendNoteBox(editor)).toBe('appended')
    expect(state.doc.childCount).toBe(2)
    expect(state.doc.lastChild?.type.name).toBe('noteBox')
    expect(state.doc.lastChild?.textContent).toBe('小贴士甲史料补充乙')
    expect(state.doc.lastChild?.childCount).toBe(5)
  })
})
