import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

export default function AdvancedSettingsDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    panel.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') closeRef.current() }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown); previousFocus?.focus() }
  }, [])

  return <div className="advanced-settings-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <div className="advanced-settings-dialog" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={panel}>
      <header><h2>{title}</h2><button type="button" aria-label="关闭设置" onClick={onClose}><X size={19}/></button></header>
      <div className="advanced-settings-body">{children}</div>
    </div>
  </div>
}
