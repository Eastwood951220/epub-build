import { Extension } from '@tiptap/core'

export const PreserveIds = Extension.create({
  name: 'preserveIds',
  addGlobalAttributes() {
    return [{
      types: ['paragraph', 'heading', 'listItem', 'orderedList', 'bulletList', 'blockquote', 'link', 'bold', 'italic', 'underline', 'strike'],
      attributes: {
        id: {
          default: null,
          parseHTML: element => element.getAttribute('id'),
          renderHTML: attributes => attributes.id ? { id: attributes.id } : {},
        },
        class: {
          default: null,
          parseHTML: element => element.getAttribute('class'),
          renderHTML: attributes => attributes.class ? { class: attributes.class } : {},
        },
      },
    }]
  },
})
