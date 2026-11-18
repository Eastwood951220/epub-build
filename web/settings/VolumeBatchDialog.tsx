import { useEffect, useMemo, useRef, useState } from 'react'
import { Layers, X } from 'lucide-react'
import type { Volume } from '../book/model'
import {
  formatVolumeTitle,
  parseChapterTitle,
  replaceInVolumeTitles,
  renumberVolumeTitles,
  type ChapterNumberStyle,
} from '../chapters/chapters'

export interface VolumeBatchDialogProps {
  volumes: Volume[]
  /** 每卷的章节数，用于确认批量修改的对象。 */
  chapterCount: (volumeId: string) => number
  busy?: boolean
  onCancel: () => void
  onSave: (volumes: Volume[]) => void
}

const STYLES: { value: ChapterNumberStyle; label: string }[] = [
  { value: 'chinese', label: '第X卷（中文数字）' },
  { value: 'upper', label: '第X卷（大写汉字：壹贰叁）' },
  { value: 'arabic', label: '第X卷（阿拉伯数字）' },
  { value: 'bare', label: '1 名称' },
  { value: 'dot', label: '1. 名称' },
  { value: 'dun', label: '1、名称' },
  { value: 'name', label: '无前缀（只保留名称）' },
]

const UNITS = ['卷', '部', '篇']

export default function VolumeBatchDialog({ volumes, chapterCount, busy = false, onCancel, onSave }: VolumeBatchDialogProps) {
  const [drafts, setDrafts] = useState<Volume[]>(() => volumes.map(volume => ({ ...volume })))
  const [style, setStyle] = useState<ChapterNumberStyle>('chinese')
  const [unit, setUnit] = useState(() => parseChapterTitle(volumes[0]?.title ?? '').unit ?? '卷')
  const [start, setStart] = useState(1)
  const [find, setFind] = useState('')
  const [replacement, setReplacement] = useState('')
  const [message, setMessage] = useState('')
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    panel.current?.focus()
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCancel()
      }
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onCancel])

  const preview = useMemo(() => {
    if (drafts.length === 0) return '还没有卷'
    const sample = drafts[0]
    const parsed = parseChapterTitle(sample.title)
    const number = style === 'name' ? 0 : (parsed.number ?? start)
    const title = formatVolumeTitle(number, parsed.text || sample.title, style, unit)
    return `示例：${title}`
  }, [drafts, style, unit, start])

  function setTitle(id: string, title: string) {
    setDrafts(previous => previous.map(volume => volume.id === id ? { ...volume, title } : volume))
  }

  function applyNumbering() {
    const result = renumberVolumeTitles(drafts, { style, start, unit: style === 'name' ? undefined : unit })
    setDrafts(result.volumes)
    setMessage(result.renamed === 0 ? '卷标题已经是目标格式' : `已重排 ${result.renamed} 个卷标题`)
  }

  function applyReplacement() {
    if (!find) return
    const result = replaceInVolumeTitles(drafts, find, replacement)
    setDrafts(result.volumes)
    setMessage(result.matches === 0 ? `没有卷标题包含“${find}”` : `已替换 ${result.matches} 处`)
  }

  return <div
    className="chapter-review-backdrop"
    onMouseDown={event => { if (event.target === event.currentTarget && !busy) onCancel() }}
  >
    <div
      className="volume-batch-panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="volume-batch-title"
      tabIndex={-1}
      ref={panel}
    >
      <header className="review-heading">
        <div>
          <span className="review-eyebrow">VOLUME BATCH · 卷批量编辑</span>
          <h2 id="volume-batch-title">卷批量编辑</h2>
          <p>共 {drafts.length} 卷。可统一重排卷号、批量替换卷名里的文字，保存后卷内章节不受影响。</p>
        </div>
        <button className="review-close" aria-label="关闭卷批量编辑" title="关闭" onClick={onCancel}><X size={18}/></button>
      </header>

      <section className="review-renumber" aria-label="统一卷编号">
        <div className="review-renumber-row">
          <span className="review-section-label">卷名前缀</span>
          <select value={style} onChange={event => setStyle(event.target.value as ChapterNumberStyle)} aria-label="卷编号格式">
            {STYLES.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <label className="review-inline">单位
            <select value={unit} disabled={style === 'name'} onChange={event => setUnit(event.target.value)} aria-label="卷单位">
              {UNITS.map(value => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label className="review-inline">起始
            <input
              type="number"
              min="1"
              max="9999"
              value={start}
              disabled={style === 'name'}
              onChange={event => { const value = Number(event.target.value); if (Number.isFinite(value)) setStart(Math.max(1, Math.min(9999, Math.round(value)))) }}
              aria-label="起始卷号"
            />
          </label>
          <button className="button outline" disabled={drafts.length === 0} onClick={applyNumbering}>{style === 'name' ? '去掉前缀' : '应用编号'}</button>
        </div>
        <p className="review-hint">{preview} · 卷号按卷在目录里的先后顺序排列，卷标题里已有的编号会先被抽掉，剩下的文字作为卷名。</p>
      </section>

      <section className="volume-batch-replace" aria-label="批量替换卷名">
        <span className="review-section-label">批量替换</span>
        <input value={find} onChange={event => setFind(event.target.value)} placeholder="查找" aria-label="查找卷名文字" />
        <input value={replacement} onChange={event => setReplacement(event.target.value)} placeholder="替换为" aria-label="替换后的文字"/>
        <button className="button outline" disabled={!find} onClick={applyReplacement}>全部替换</button>
      </section>
      {message && <p className="review-message" role="status">{message}</p>}

      <ol className="volume-batch-list">
        {drafts.map((volume, index) => <li className="volume-batch-row" key={volume.id}>
          <span className="review-index">{String(index + 1).padStart(2, '0')}</span>
          <Layers size={15}/>
          <input
            className="review-title"
            value={volume.title}
            onChange={event => setTitle(volume.id, event.target.value)}
            aria-label={`第 ${index + 1} 卷标题`}
            placeholder="卷标题"
          />
          <span className="review-count">{chapterCount(volume.id)} 章</span>
        </li>)}
        {drafts.length === 0 && <li className="ci-empty">还没有卷，先在左侧新建卷。</li>}
      </ol>

      <footer className="review-footer">
        <span className="review-hint">只改卷标题，卷的样式、卷首图与章节归属都不会变动。</span>
        <div>
          <button className="button subtle" disabled={busy} onClick={onCancel}>取消</button>
          <button
            className="button primary"
            disabled={busy || drafts.length === 0}
            onClick={() => onSave(drafts.map(volume => ({ ...volume, title: volume.title.trim() || '未命名卷' })))}
          >保存 {drafts.length} 卷标题</button>
        </div>
      </footer>
    </div>
  </div>
}
