import { Node, mergeAttributes, type Editor } from '@tiptap/core'

/** Adds a tip at the end of the chapter body, independently of numbered notes. */
export function appendNoteBox(editor: Editor, title = '小贴士'): void {
  editor.chain().focus().insertContentAt(editor.state.doc.content.size, {
    type: 'noteBox',
    content: [
      { type: 'noteBoxTitle', content: [{ type: 'text', text: title.trim() || '小贴士' }] },
      { type: 'paragraph', content: [{ type: 'text', text: '输入备注内容' }] },
    ],
  }).run()
}

export const NoteBoxTitle = Node.create({
  name: 'noteBoxTitle',
  group: 'noteBoxTitle',
  content: 'inline*',
  defining: true,
  // Paragraph parses at priority 1000; the title must win so it stays inside the box.
  priority: 1100,
  parseHTML() { return [{ tag: 'p.note-box-title' }] },
  renderHTML({ HTMLAttributes }) { return ['p', mergeAttributes(HTMLAttributes, { class: 'note-box-title' }), 0] },
})

/** A bordered tip with its own directly editable title and body. */
export const NoteBox = Node.create({
  name: 'noteBox',
  group: 'block',
  // Listing the children keeps a tip from nesting inside another tip.
  content: 'noteBoxTitle (paragraph|heading|bulletList|orderedList|blockquote|image)+',
  defining: true,
  isolating: true,
  parseHTML() { return [{ tag: 'aside.note-box' }] },
  renderHTML({ HTMLAttributes }) { return ['aside', mergeAttributes(HTMLAttributes, { class: 'note-box' }), 0] },
})
