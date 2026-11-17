import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { X } from 'lucide-react'

/** Common text colours; WKWebView does not reliably open the native picker. */
const PALETTE = ['#1f2937', '#dc2626', '#ea580c', '#d97706', '#16a34a', '#0d9488', '#2563eb', '#7c3aed', '#db2777', '#0ea5e9', '#475569', '#94a3b8']

export interface TextColorControlProps {
  editor: Editor | null
}

function normalizeColor(value: string): string {
  const node = document.createElement('span')
  node.style.color = ''
  node.style.color = value
  return node.style.color
}

function toHex(value: string | undefined, fallback: string): string {
  if (!value) return fallback
  if (/^#[0-9a-f]{6}$/i.test(value)) return value
  const match = value.match(/rgba?\((\d+)[^\d]+(\d+)[^\d]+(\d+)/i)
  if (!match) return fallback
  const hex = (part: string) => Math.min(255, Number(part)).toString(16).padStart(2, '0')
  return `#${hex(match[1])}${hex(match[2])}${hex(match[3])}`
}

/**
 * Selection-level text colour for the body. Uses a visible palette instead of
 * the invisible native `<input type="color">` overlay, which WKWebView (the
 * Tauri webview) does not reliably open; the native input stays as the
 * custom-colour escape hatch.
 */
export default function TextColorControl({ editor }: TextColorControlProps) {
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState({ left: 0, top: 0 })
  const [custom, setCustom] = useState('#0d9488')
  const [, setRevision] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!editor) return
    const refresh = () => setRevision(value => value + 1)
    editor.on('transaction', refresh)
    return () => {
      editor.off('transaction', refresh)
    }
  }, [editor])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    const onScroll = () => setOpen(false)
    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open])

  const current = editor?.getAttributes('textStyle').color as string | undefined

  function toggle() {
    const rect = button.current?.getBoundingClientRect()
    if (rect) setAnchor({ left: Math.max(8, Math.min(rect.left, window.innerWidth - 224)), top: rect.bottom + 8 })
    setCustom(toHex(current, custom))
    setOpen(value => !value)
  }

  function apply(color: string, close = true) {
    if (!editor) return
    editor.chain().focus().setColor(color).run()
    setCustom(color)
    if (close) setOpen(false)
  }

  function clear() {
    if (!editor) return
    editor.chain().focus().unsetColor().removeEmptyTextStyle().run()
    setOpen(false)
  }

  return <div className="text-color" ref={root}>
    <button
      ref={button}
      type="button"
      className={`text-color-button${open ? ' active' : ''}`}
      title="文字颜色"
      aria-label="文字颜色"
      aria-haspopup="dialog"
      aria-expanded={open}
      onMouseDown={event => event.preventDefault()}
      onClick={toggle}
    >
      <span className="text-color-glyph">A</span>
      <span className="text-color-bar" style={{ background: current ?? '#20302e' }}/>
    </button>
    {open && <div className="text-color-popover" role="dialog" aria-label="文字颜色" style={{ left: anchor.left, top: anchor.top }}>
      <div className="text-color-grid">
        {PALETTE.map(color => <button
          key={color}
          type="button"
          className={`text-color-swatch${current && normalizeColor(current) === normalizeColor(color) ? ' selected' : ''}`}
          style={{ background: color }}
          title={color}
          aria-label={`文字颜色 ${color}`}
          onMouseDown={event => event.preventDefault()}
          onClick={() => apply(color)}
        />)}
      </div>
      <label className="text-color-custom">自定义颜色<input type="color" value={custom} onChange={event => apply(event.target.value, false)}/></label>
      <button type="button" className="text-color-clear" onMouseDown={event => event.preventDefault()} onClick={clear}><X size={13}/>清除颜色</button>
    </div>}
  </div>
}
