import { Mark, mergeAttributes } from '@tiptap/core'

/** Keeps EPUB span classes so their original CSS survives editing. */
export const SourceClass = Mark.create({
  name: 'sourceClass',
  addAttributes() {
    return { class: {
      default: null,
      parseHTML: element => element.getAttribute('class'),
      renderHTML: attributes => attributes.class ? { class: attributes.class } : {},
    } }
  },
  parseHTML() { return [{ tag: 'span[class]:not([data-note-id])' }] },
  renderHTML({ HTMLAttributes }) { return ['span', mergeAttributes(HTMLAttributes), 0] },
})
