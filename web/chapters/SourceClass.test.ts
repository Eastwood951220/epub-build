// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TextStyleKit } from '@tiptap/extension-text-style'
import { PreserveIds } from './PreserveIds'
import { SourceClass } from './SourceClass'

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
})
