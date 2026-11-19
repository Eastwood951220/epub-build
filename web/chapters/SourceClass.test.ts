// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { Editor, type JSONContent } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TextStyleKit } from '@tiptap/extension-text-style'
import Image from '@tiptap/extension-image'
import { PreserveIds } from './PreserveIds'
import { SourceClass } from './SourceClass'
import { NoteBox, NoteBoxTitle, NoteInlineImage } from './NoteBox'

describe('imported CSS classes', () => {
  it('keeps dialogue and paragraph classes after opening and editing a chapter', () => {
    const editor = new Editor({
      extensions: [StarterKit, TextStyleKit, PreserveIds, SourceClass],
      content: '<p class="special-p2">他说：<span class="talk" style="color:#863020;font-family:Georgia">小心</span>。</p>',
    })
    const html = editor.getHTML()
    expect(html).toContain('class="special-p2"')
    expect(html).toContain('class="talk"')
    expect(html).toContain('color:')
    expect(html).toContain('font-family:')
    editor.destroy()
  })

  it('keeps a tip icon beside its paragraph text', () => {
    const editor = new Editor({
      extensions: [StarterKit, Image.configure({ allowBase64: true }), NoteInlineImage, NoteBox, NoteBoxTitle, PreserveIds, SourceClass],
      content: '<aside class="note-box"><p class="note-box-title">小贴士</p><p class="jieti"><span class="zhonghei"><img class="footnote-img" src="data:image/png;base64,AA==" alt="备注"/></span>正文内容</p></aside>',
    })
    const tip = (editor.getJSON() as JSONContent).content?.find(node => node.type === 'noteBox')
    expect(tip?.content?.[1].type).toBe('paragraph')
    expect(tip?.content?.[1].content?.some(node => node.type === 'noteInlineImage')).toBe(true)
    expect(tip?.content?.[1].content?.some(node => node.type === 'text' && node.text === '正文内容')).toBe(true)
    expect(editor.getHTML()).toContain('class="footnote-img"')
    editor.destroy()
  })
})
