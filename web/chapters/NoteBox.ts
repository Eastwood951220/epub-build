import { Node, mergeAttributes, type Editor } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

function tipRanges(editor: Editor): { node: ProseMirrorNode; from: number; to: number }[] {
  const ranges: { node: ProseMirrorNode; from: number; to: number }[] = []
  editor.state.doc.forEach((node, offset) => {
    if (node.type.name === 'noteBox') ranges.push({ node, from: offset, to: offset + node.nodeSize })
  })
  return ranges
}

export function hasNoteBox(editor: Editor | null): boolean {
  return editor !== null && tipRanges(editor).length > 0
}

/** Adds a line to the chapter's existing tip, or creates its first tip. */
export function appendNoteBox(editor: Editor, title = '小贴士'): 'created' | 'appended' {
  const ranges = tipRanges(editor)
  const existing = ranges.at(-1)
  if (existing) {
    if (ranges.length > 1 || existing.to < editor.state.doc.content.size) {
      const children: ProseMirrorNode[] = []
      const heading = ranges[0].node.firstChild
      if (heading) children.push(heading)
      for (const [index, range] of ranges.entries()) range.node.forEach(child => {
        if (child.type.name !== 'noteBoxTitle') children.push(child)
        else if (index > 0 && child.textContent.trim() && child.textContent !== heading?.textContent) {
          children.push(editor.state.schema.nodes.paragraph.create(null, child.content))
        }
      })
      children.push(editor.state.schema.nodes.paragraph.create())
      const merged = ranges[0].node.type.create(ranges[0].node.attrs, children)
      const transaction = editor.state.tr
      for (const range of [...ranges].reverse()) transaction.delete(range.from, range.to)
      transaction.insert(transaction.doc.content.size, merged)
      editor.view.dispatch(transaction)
      return 'appended'
    }
    editor.chain().focus().insertContentAt(existing.to - 1, { type: 'paragraph' }).run()
    return 'appended'
  }
  editor.chain().focus().insertContentAt(editor.state.doc.content.size, {
    type: 'noteBox',
    content: [
      { type: 'noteBoxTitle', content: [{ type: 'text', text: title.trim() || '小贴士' }] },
      { type: 'paragraph' },
    ],
  }).run()
  return 'created'
}

/** Removes chapter tips, including duplicate boxes created by older versions. */
export function removeNoteBoxes(editor: Editor): number {
  const ranges = tipRanges(editor)
  if (ranges.length === 0) return 0
  let chain = editor.chain().focus()
  for (const { from, to } of ranges.reverse()) chain = chain.deleteRange({ from, to })
  chain.run()
  return ranges.length
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

/** Inline icons inside imported tip paragraphs; regular chapter images stay block images. */
export const NoteInlineImage = Node.create({
  name: 'noteInlineImage',
  group: 'inline',
  inline: true,
  atom: true,
  priority: 1100,
  addAttributes() {
    return {
      src: { default: null, parseHTML: element => element.getAttribute('src') },
      alt: { default: null, parseHTML: element => element.getAttribute('alt') },
      class: { default: null, parseHTML: element => element.getAttribute('class') },
    }
  },
  parseHTML() { return [{ tag: 'aside.note-box img' }, { tag: 'img.footnote-img' }] },
  renderHTML({ HTMLAttributes }) { return ['img', mergeAttributes(HTMLAttributes)] },
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
