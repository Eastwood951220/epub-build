import { Extension } from '@tiptap/core'

export const PreserveIds = Extension.create({
  name: 'preserveIds',
  addGlobalAttributes() {
    return [{
      types: ['paragraph', 'heading', 'listItem', 'link'],
      attributes: {
        id: {
          default: null,
          parseHTML: element => element.getAttribute('id'),
          renderHTML: attributes => attributes.id ? { id: attributes.id } : {},
        },
      },
    }]
  },
})
