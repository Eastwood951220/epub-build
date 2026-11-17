import { Node, mergeAttributes } from '@tiptap/core'

export const NoteMarker = Node.create({
  name: 'noteMarker',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { noteId: { default: null, parseHTML: element => element.getAttribute('data-note-id'), renderHTML: attributes => ({ 'data-note-id': attributes.noteId }) }, number: { default: 1, parseHTML: element => Number(element.textContent?.replace(/\D/g, '')) || 1, renderHTML: () => ({}) } }
  },
  parseHTML() { return [{ tag: 'span[data-note-id]' }] },
  renderHTML({ node, HTMLAttributes }) { return ['span', mergeAttributes(HTMLAttributes, { class: 'note-marker' }), `[${node.attrs.number}]`] },
})
