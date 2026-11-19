import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'

interface Props {
  name: string
  dataUri: string
  onClose: () => void
}

export default function ImagePreviewDialog({ name, dataUri, onClose }: Props) {
  const closeButton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeButton.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if (event.key === 'Tab') {
        event.preventDefault()
        closeButton.current?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      previousFocus?.focus()
    }
  }, [onClose])

  return <div className="books-image-preview-backdrop" onMouseDown={event => {
    if (event.target === event.currentTarget) onClose()
  }} role="presentation">
    <div className="books-image-preview-dialog" role="dialog" aria-modal="true" aria-label={`图片预览：${name}`}>
      <div className="books-image-preview-heading"><strong title={name}>{name}</strong><button ref={closeButton} onClick={onClose} aria-label="关闭图片预览"><X size={20}/></button></div>
      <img src={dataUri} alt={name}/>
    </div>
  </div>
}
