// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ImagePreviewDialog from './ImagePreviewDialog'

describe('image preview dialog', () => {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)

  afterEach(() => {
    act(() => root.render(null))
    container.replaceChildren()
  })

  it('shows the image in a modal and closes from the backdrop, button, or Escape', () => {
    const onClose = vi.fn()
    const render = () => act(() => root.render(<ImagePreviewDialog name="封面.png" dataUri="data:image/png;base64,AA==" onClose={onClose}/>))

    render()
    expect(container.querySelector('[role="dialog"][aria-modal="true"] img')?.getAttribute('alt')).toBe('封面.png')
    act(() => container.querySelector('.books-image-preview-backdrop')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    expect(onClose).toHaveBeenCalledTimes(1)

    render()
    act(() => container.querySelector('[aria-label="关闭图片预览"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(onClose).toHaveBeenCalledTimes(2)

    render()
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(onClose).toHaveBeenCalledTimes(3)
  })
})
