// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import SourceImage from './SourceImage'

describe('imported EPUB images', () => {
  it('keeps separator class and width through chapter editing', () => {
    const editor = new Editor({
      extensions: [StarterKit, SourceImage.configure({ allowBase64: true })],
      content: '<img src="data:image/png;base64,AA==" alt="pp" class="pp" width="15%" />',
    })
    expect(editor.getHTML()).toContain('class="pp"')
    expect(editor.getHTML()).toContain('width="15%"')
    editor.destroy()
  })
})
