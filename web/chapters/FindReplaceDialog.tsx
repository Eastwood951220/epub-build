import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { EditableChapter, Volume } from '../book/model'
import { findReplace, type FindReplaceOptions, type FindReplaceResult } from './findReplace'

interface Props {
  chapters: EditableChapter[]
  volumes: Volume[]
  onClose: () => void
  onApply: (result: FindReplaceResult) => void
}

export default function FindReplace({ chapters, volumes, onClose, onApply }: Props) {
  const [find, setFind] = useState('')
  const [replacement, setReplacement] = useState('')
  const [regex, setRegex] = useState(false)
  const [matchCase, setMatchCase] = useState(true)
  const [scope, setScope] = useState({ titles: true, body: true, volumes: true })
  const [message, setMessage] = useState('')
  const deferredFind = useDeferredValue(find)
  const input = useRef<HTMLInputElement>(null)
  const options: FindReplaceOptions = useMemo(() => ({ find: deferredFind, replacement, regex, matchCase, scope }), [deferredFind, replacement, regex, matchCase, scope])
  const preview = useMemo(() => findReplace(chapters, volumes, options, false), [chapters, volumes, options])

  useEffect(() => {
    input.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  function apply() {
    const result = findReplace(chapters, volumes, { ...options, find }, true)
    if (result.error || result.matches === 0) return
    onApply(result)
    setMessage(`已替换 ${result.matches} 处，涉及 ${result.chaptersChanged} 章${result.volumesChanged ? `、${result.volumesChanged} 卷` : ''}`)
  }

  const searching = deferredFind !== find
  return <div className="chapter-review-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <div className="find-replace-panel" role="dialog" aria-modal="true" aria-labelledby="find-replace-title">
      <header className="review-heading">
        <div><span className="review-eyebrow">FIND & REPLACE</span><h2 id="find-replace-title">查找替换</h2><p>在全书的章节标题、正文和卷标题中查找，预览数量后统一替换。</p></div>
        <button className="review-close" aria-label="关闭查找替换" onClick={onClose}><X size={18}/></button>
      </header>
      <div className="find-replace-content">
        <div className="find-replace-fields">
          <label className="review-field">查找<input ref={input} value={find} onChange={event => { setFind(event.target.value); setMessage('') }} placeholder={regex ? '例如：第(\\d+)章' : '输入要查找的文字'}/></label>
          <label className="review-field">替换为<input value={replacement} onChange={event => setReplacement(event.target.value)} placeholder="留空表示删除"/></label>
        </div>
        <div className="find-replace-options">
          <label><input type="checkbox" checked={regex} onChange={event => setRegex(event.target.checked)}/>正则表达式</label>
          <label><input type="checkbox" checked={matchCase} onChange={event => setMatchCase(event.target.checked)}/>区分大小写</label>
        </div>
        <div className="find-replace-scope" aria-label="查找范围">
          <strong>查找范围</strong>
          <label><input type="checkbox" checked={scope.titles} onChange={event => setScope(value => ({ ...value, titles: event.target.checked }))}/>章节标题</label>
          <label><input type="checkbox" checked={scope.body} onChange={event => setScope(value => ({ ...value, body: event.target.checked }))}/>正文内容</label>
          {volumes.length > 0 && <label><input type="checkbox" checked={scope.volumes} onChange={event => setScope(value => ({ ...value, volumes: event.target.checked }))}/>卷标题</label>}
        </div>
        <p className="review-hint">正文按可见文字匹配，不改动 HTML 标签和属性；跨标签的文字不会合并匹配。正则替换支持 $1、$2 等分组引用。</p>
        {preview.error ? <p className="find-replace-error" role="alert">正则无效：{preview.error}</p> : <p className="find-replace-count" role="status">{searching ? '正在查找…' : !find ? '输入文字开始查找' : `找到 ${preview.matches} 处 · ${preview.chaptersChanged} 章${preview.volumesChanged ? ` · ${preview.volumesChanged} 卷` : ''}`}</p>}
        {message && <p className="review-message" role="status">{message}</p>}
      </div>
      <footer className="review-footer"><span className="review-hint">替换后可继续编辑，保存工程时写入磁盘。</span><div><button className="button subtle" onClick={onClose}>关闭</button><button className="button primary" disabled={!find || searching || !!preview.error || preview.matches === 0} onClick={apply}>全部替换</button></div></footer>
    </div>
  </div>
}
