import { useEffect, useRef } from 'react'
import { EditorView, basicSetup } from 'codemirror'
import { css } from '@codemirror/lang-css'

interface Props {
  label: string
  value: string
  onChange: (value: string) => void
}

export default function CssCodeEditor({ label, value, onChange }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  const syncing = useRef(false)
  onChangeRef.current = onChange

  useEffect(() => {
    if (!host.current) return
    const editor = new EditorView({
      doc: value,
      parent: host.current,
      extensions: [
        basicSetup,
        css(),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ 'aria-label': label, spellcheck: 'false' }),
        EditorView.updateListener.of(update => {
          if (update.docChanged && !syncing.current) onChangeRef.current(update.state.doc.toString())
        }),
      ],
    })
    view.current = editor
    return () => { editor.destroy(); view.current = null }
  }, [label])

  useEffect(() => {
    const editor = view.current
    if (!editor || editor.state.doc.toString() === value) return
    syncing.current = true
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } })
    syncing.current = false
  }, [value])

  return <div className="css-code-editor" ref={host}/>
}
