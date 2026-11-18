import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUpToLine, ChevronDown, ChevronUp, Layers, Trash2, X } from 'lucide-react'
import { chapterGroups, type EditableChapter, type Project, type Volume } from '../book/model'
import {
  blockCount,
  formatChapterTitle,
  formatVolumeTitle,
  looksLikeChapterHeading,
  mergeWithPrevious,
  normalizeChapters,
  previewText,
  removeChapter,
  parseChapterTitle,
  renumberChapters,
  suggestNumberingStart,
  splitChapter,
  splitHtmlBlocks,
  type ChapterCounting,
  type ChapterNumberStyle,
} from './chapters'

export interface ChapterReviewProps {
  mode: 'import' | 'manage'
  chapters: EditableChapter[]
  volumes: Volume[]
  sourcePath?: string
  onRedetect?: (chapterPattern?: string, volumePattern?: string) => Promise<Project>
  bookTitle: string
  busy?: boolean
  error?: string
  onCancel: () => void
  onConfirm: (chapters: EditableChapter[], volumes: Volume[]) => void | Promise<void>
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export default function ChapterReview({ mode, chapters, volumes, sourcePath, onRedetect, bookTitle, busy = false, error, onCancel, onConfirm }: ChapterReviewProps) {
  const [drafts, setDrafts] = useState<EditableChapter[]>(() => chapters.map(chapter => ({ ...chapter })))
  const [volumeDrafts, setVolumeDrafts] = useState<Volume[]>(() => volumes.map(volume => ({ ...volume, style: { ...volume.style } })))
  const [expanded, setExpanded] = useState<string | null>(null)
  const [numberStyle, setNumberStyle] = useState<ChapterNumberStyle>('chinese')
  const [counting, setCounting] = useState<ChapterCounting>('book')
  const [start, setStart] = useState(1)
  const [fromChapterId, setFromChapterId] = useState<string | null>(() => suggestNumberingStart(chapters, volumes))
  const [renumberVolumes, setRenumberVolumes] = useState(true)
  const [message, setMessage] = useState('')
  const [working, setWorking] = useState(false)
  const [chapterPattern, setChapterPattern] = useState('')
  const [volumePattern, setVolumePattern] = useState('')
  const [ruleError, setRuleError] = useState('')
  const panel = useRef<HTMLDivElement>(null)

  const counts = useMemo(() => new Map(drafts.map(chapter => [chapter.id, blockCount(chapter)])), [drafts])
  const groups = useMemo(() => chapterGroups(drafts, volumeDrafts), [drafts, volumeDrafts])
  const effectiveFromId = drafts.some(chapter => chapter.id === fromChapterId) ? fromChapterId : suggestNumberingStart(drafts, volumeDrafts)
  const fromIndex = Math.max(0, drafts.findIndex(chapter => chapter.id === effectiveFromId))
  const blocks = useMemo(() => {
    const chapter = drafts.find(item => item.id === expanded)
    return chapter ? splitHtmlBlocks(chapter.html) : []
  }, [drafts, expanded])

  useEffect(() => {
    panel.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCancel()
        return
      }
      if (event.key !== 'Tab' || !panel.current) return
      const focusable = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

  function setTitle(id: string, title: string) {
    setDrafts(previous => previous.map(chapter => chapter.id === id ? { ...chapter, title } : chapter))
  }

  function setVolumeTitle(id: string, title: string) {
    setVolumeDrafts(previous => previous.map(volume => volume.id === id ? { ...volume, title } : volume))
  }

  function merge(index: number) {
    setDrafts(previous => mergeWithPrevious(previous, index))
    setMessage('已并入上一章')
  }

  function split(index: number, blockIndex: number) {
    setDrafts(previous => splitChapter(previous, index, blockIndex))
    setExpanded(null)
    setMessage('已从此处拆分章节')
  }

  function remove(index: number) {
    const chapter = drafts[index]
    if (drafts.length <= 1) return
    if (window.confirm(`删除“${chapter.title || `章节 ${index + 1}`}”及其正文？`)) {
      setDrafts(previous => removeChapter(previous, index))
      setMessage('已删除章节')
    }
  }

  function applyNumbering() {
    const result = renumberChapters(drafts, volumeDrafts, {
      style: numberStyle,
      counting: counting === 'volume' && volumeDrafts.length === 0 ? 'book' : counting,
      start,
      fromChapterId: effectiveFromId ?? undefined,
      renumberVolumes: renumberVolumes && volumeDrafts.length > 0,
    })
    setDrafts(result.chapters)
    setVolumeDrafts(result.volumes)
    const parts: string[] = []
    if (result.renamed > 0) parts.push(`${result.renamed} 章`)
    if (result.renamedVolumes > 0) parts.push(`${result.renamedVolumes} 个卷`)
    setMessage(parts.length === 0 ? '章节标题已经是目标格式' : `已重排 ${parts.join('、')}标题`)
  }

  async function redetect() {
    if (!onRedetect) return
    setWorking(true)
    setRuleError('')
    try {
      const next = await onRedetect(chapterPattern.trim() || undefined, volumePattern.trim() || undefined)
      setDrafts(next.chapters)
      setVolumeDrafts(next.volumes)
      setFromChapterId(suggestNumberingStart(next.chapters, next.volumes))
      setExpanded(null)
      setMessage(`已重新识别 ${next.chapters.length} 章、${next.volumes.length} 卷`)
    } catch (cause) {
      setRuleError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setWorking(false)
    }
  }

  const numberingPreview = (() => {
    if (numberStyle === 'name' && drafts.length === 0) return '示例：—'
    if (drafts.length === 0) return '示例：—'
    const sample = drafts[fromIndex]
    const parsed = parseChapterTitle(sample.title)
    const name = parsed.text || sample.title
    if (numberStyle === 'name') return `示例：${name}`
    const number = counting === 'keep' ? (parsed.number ?? start) : start
    const chapterText = formatChapterTitle(number, name, numberStyle)
    if (!renumberVolumes || volumeDrafts.length === 0) return `示例：${chapterText}`
    const volume = parseChapterTitle(volumeDrafts[0].title)
    const volumeText = formatVolumeTitle(volume.number ?? start, volume.text, numberStyle, volume.unit ?? '卷')
    return `示例：${chapterText} · ${volumeText}`
  })()

  async function confirm() {
    setWorking(true)
    try {
      await onConfirm(normalizeChapters(drafts), volumeDrafts.map(volume => ({ ...volume, title: volume.title.trim() || '未命名卷' })))
    } finally {
      setWorking(false)
    }
  }

  const pending = busy || working
  let cursor = 0

  return <div
    className="chapter-review-backdrop"
    onMouseDown={event => { if (event.target === event.currentTarget && !pending) onCancel() }}
  >
    <div
      className="chapter-review-panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="chapter-review-title"
      tabIndex={-1}
      ref={panel}
    >
      <header className="review-heading">
        <div>
          <span className="review-eyebrow">CHAPTER REVIEW · 章节核对</span>
          <h2 id="chapter-review-title">{mode === 'import' ? '确认导入的章节' : '整理章节'}</h2>
          <p>《{bookTitle || '未命名图书'}》共 {drafts.length} 章{volumeDrafts.length > 0 ? ` · ${volumeDrafts.length} 卷` : ''}。识别多了可与上一章合并，识别少了可在段落处分章。</p>
        </div>
        <button className="review-close" aria-label="关闭章节核对" title="关闭" onClick={() => { if (!pending) onCancel() }}><X size={18}/></button>
      </header>

      {mode === 'import' && sourcePath && <section className="review-rules" aria-label="TXT 章节识别规则">
        <div className="review-rules-fields">
          <label className="review-field">章节正则<input value={chapterPattern} onChange={event => setChapterPattern(event.target.value)} placeholder={String.raw`^\d+、.+$`}/></label>
          <label className="review-field">卷正则<input value={volumePattern} onChange={event => setVolumePattern(event.target.value)} placeholder={String.raw`^第\d+卷.*$`}/></label>
          <button className="button outline" disabled={pending} onClick={() => void redetect()}>重新识别</button>
        </div>
        <p className="review-hint">留空使用默认规则；填写后替换对应默认规则。正则按单行匹配，建议加 ^ 和 $。重新识别会重置当前章节与卷标题的手工修改。</p>
        {ruleError && <p className="review-rule-error" role="alert">{ruleError}</p>}
      </section>}

      <section className="review-renumber" aria-label="统一章节编号">
        <div className="review-renumber-row">
          <span className="review-section-label">章节名前缀</span>
          <select value={numberStyle} onChange={event => setNumberStyle(event.target.value as ChapterNumberStyle)} aria-label="编号格式">
            <option value="chinese">第X章（中文数字）</option>
            <option value="upper">第X章（大写汉字：壹贰叁）</option>
            <option value="arabic">第X章（阿拉伯数字）</option>
            <option value="bare">1 名称</option>
            <option value="dot">1. 名称</option>
            <option value="dun">1、名称</option>
            <option value="name">无前缀（只保留名称）</option>
          </select>
          <select value={counting} disabled={numberStyle === 'name'} onChange={event => setCounting(event.target.value as ChapterCounting)} aria-label="编号方式">
            <option value="book">全书连续</option>
            <option value="volume" disabled={volumeDrafts.length === 0}>每卷从 1 开始</option>
            <option value="keep">保留原标题编号（缺编号的按顺序补）</option>
          </select>
          <label className="review-inline">编号从
            <input
              type="number"
              min="1"
              max="9999"
              value={start}
              disabled={numberStyle === 'name' || counting === 'keep'}
              onChange={event => { const value = Number(event.target.value); if (Number.isFinite(value)) setStart(Math.max(1, Math.min(9999, Math.round(value)))) }}
              aria-label="起始编号"
            />
          </label>
          <label className="review-inline">从第
            <input type="number" min="1" max={Math.max(1, drafts.length)} value={drafts.length ? fromIndex + 1 : 1} disabled={drafts.length === 0}
              onChange={event => { const index = Math.max(0, Math.min(drafts.length - 1, Math.round(Number(event.target.value) || 1) - 1)); setFromChapterId(drafts[index]?.id ?? null) }}
              aria-label="从第几项章节开始编号"/>
            项开始
          </label>
          {volumeDrafts.length > 0 && <label className="review-inline"><input type="checkbox" checked={renumberVolumes} onChange={event => setRenumberVolumes(event.target.checked)}/>同时整理卷标题</label>}
          <button className="button outline" disabled={drafts.length === 0} onClick={applyNumbering}>{numberStyle === 'name' ? '去掉前缀' : '应用前缀'}</button>
        </div>
        <p className="review-hint">{numberingPreview} · 从第 {fromIndex + 1} 项“{drafts[fromIndex]?.title ?? '—'}”开始；此前的封面、作者简介等保留原标题且不占编号。所选范围内会先去掉旧编号再统一重写。卷号保留原数字。</p>
        {message && <p className="review-message" role="status">{message}</p>}
      </section>

      {error && <div className="review-error" role="alert">{error}</div>}

      <ol className="review-list">
        {groups.map(group => {
          const groupStart = cursor
          cursor += group.chapters.length
          return <Fragment key={group.volume?.id ?? group.chapters[0]?.id ?? 'loose'}>
            {group.volume && <li className="review-volume">
              <Layers size={15}/>
              <input
                className="review-title"
                value={group.volume.title}
                onChange={event => setVolumeTitle(group.volume!.id, event.target.value)}
                aria-label="卷标题"
                placeholder="卷标题"
              />
              <span className="review-count">{group.chapters.length} 章</span>
              <span className="review-hint">卷内章节与卷首页使用本卷样式</span>
            </li>}
            {group.chapters.map((chapter, offset) => {
              const index = groupStart + offset
              const suspicious = !looksLikeChapterHeading(chapter.title)
              const extracted = parseChapterTitle(chapter.title).text
              const open = expanded === chapter.id
              return <li className="review-chapter" key={chapter.id}>
                <div className="review-chapter-head">
                  <span className="review-index">{String(index + 1).padStart(2, '0')}</span>
                  <input
                    className="review-title"
                    value={chapter.title}
                    onChange={event => setTitle(chapter.id, event.target.value)}
                    aria-label={`第 ${index + 1} 章标题`}
                    placeholder={`章节 ${index + 1}`}
                  />
                  <span className="review-count">{counts.get(chapter.id) ?? 0} 段</span>
                  <div className="review-tools">
                    <button
                      title="并入上一章"
                      aria-label={`把第 ${index + 1} 章并入上一章`}
                      disabled={index === 0}
                      onClick={() => merge(index)}
                    ><ArrowUpToLine size={16}/></button>
                    <button
                      title={open ? '收起段落' : '查看段落并分章'}
                      aria-label={`${open ? '收起' : '展开'}第 ${index + 1} 章的段落`}
                      aria-expanded={open}
                      onClick={() => setExpanded(open ? null : chapter.id)}
                    >{open ? <ChevronUp size={17}/> : <ChevronDown size={17}/>}</button>
                    <button
                      title="删除章节"
                      aria-label={`删除第 ${index + 1} 章`}
                      disabled={drafts.length === 1}
                      onClick={() => remove(index)}
                    ><Trash2 size={15}/></button>
                  </div>
                </div>
                {extracted && extracted !== chapter.title.trim() && <p className="review-extracted">提取名称：{extracted}</p>}
                <p className="review-preview">{previewText(chapter.html) || '（本章没有正文）'}</p>
                {suspicious && <p className="review-suspicious">疑似正文被识别成标题：确认无误可保留，否则点击上方“并入上一章”。</p>}
                {open && <div className="review-blocks">
                  <p className="review-hint">共 {blocks.length} 个段落。在任意段落点击“从此处分章”，该段之前留在本章。</p>
                  {blocks.map((block, blockIndex) => <div className="review-block" key={`${chapter.id}-${blockIndex}`}>
                    <span>{blockIndex + 1}</span>
                    <p title={previewText(block, 200)}>{previewText(block) || '（空行）'}</p>
                    <button
                      className="review-split"
                      disabled={blockIndex === 0}
                      onClick={() => split(index, blockIndex)}
                    >从此处分章</button>
                  </div>)}
                  {blocks.length <= 1 && <p className="review-hint">本章只有一个段落，无法再拆分。</p>}
                </div>}
              </li>
            })}
          </Fragment>
        })}
      </ol>

      <footer className="review-footer">
        <span className="review-hint">{mode === 'import' ? '确认后创建工程；之后仍可从左侧“章节整理”再次打开。' : '应用后工程会标记为未保存，记得保存。'}</span>
        <div>
          <button className="button subtle" disabled={pending} onClick={onCancel}>取消</button>
          <button className="button primary" disabled={pending || drafts.length === 0} onClick={() => void confirm()}>
            {mode === 'import' ? `确认导入 ${drafts.length} 章${volumeDrafts.length > 0 ? ` · ${volumeDrafts.length} 卷` : ''}` : '应用修改'}
          </button>
        </div>
      </footer>
    </div>
  </div>
}
