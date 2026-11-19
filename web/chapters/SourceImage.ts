import Image from '@tiptap/extension-image'

/** Keeps the imported image class so its EPUB CSS also survives chapter edits. */
export default Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      class: {
        default: null,
        parseHTML: element => element.getAttribute('class'),
        renderHTML: attributes => attributes.class ? { class: attributes.class } : {},
      },
    }
  },
})
