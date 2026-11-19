// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EditorView } from '@codemirror/view'
import CssCodeEditor from './CssCodeEditor'

describe('CSS code editor', () => {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)

  afterEach(() => {
    act(() => { root.render(null) })
    container.replaceChildren()
  })

  it('edits CSS and accepts an updated value from the project without emitting a second change', () => {
    const onChange = vi.fn()
    act(() => { root.render(<CssCodeEditor label="原书 CSS 1" value="body { color: red; }" onChange={onChange}/>) })
    const view = EditorView.findFromDOM(container.querySelector('.cm-editor') as HTMLElement)
    expect(view?.state.doc.toString()).toBe('body { color: red; }')
    expect(container.querySelector('[aria-label="原书 CSS 1"]')).not.toBeNull()

    act(() => { view?.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'body { color: blue; }' } }) })
    expect(onChange).toHaveBeenCalledWith('body { color: blue; }')

    onChange.mockClear()
    act(() => { root.render(<CssCodeEditor label="原书 CSS 1" value="p { margin: 0; }" onChange={onChange}/>) })
    expect(EditorView.findFromDOM(container.querySelector('.cm-editor') as HTMLElement)?.state.doc.toString()).toBe('p { margin: 0; }')
    expect(onChange).not.toHaveBeenCalled()
  })
})
