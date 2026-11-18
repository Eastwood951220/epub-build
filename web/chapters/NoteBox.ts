import { Node, mergeAttributes } from '@tiptap/core'

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
