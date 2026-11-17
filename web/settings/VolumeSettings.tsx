import { useEffect, useRef, useState } from 'react'
import { ImagePlus, X } from 'lucide-react'
import { resolveStyle, volumeOverrideCount, type BookStyle, type Volume, type VolumeStyle } from '../book/model'

export interface VolumeSettingsProps {
  volume: Volume
  baseStyle: BookStyle
  availableFonts: { value: string; label: string }[]
  chapterCount: number
  busy?: boolean
  error?: string
  onPickImage: (target: 'opening' | 'closing') => Promise<string | null>
  onCancel: () => void
  onSave: (volume: Volume) => void
  onDelete: (volume: Volume) => void
}

const ALIGNS = [
  { value: 'left', label: '左对齐' },
  { value: 'center', label: '居中' },
  { value: 'right', label: '右对齐' },
  { value: 'justify', label: '两端对齐' },
]

export default function VolumeSettings({
  volume,
  baseStyle,
  availableFonts,
  chapterCount,
  busy = false,
  error,
  onPickImage,
  onCancel,
  onSave,
  onDelete,
}: VolumeSettingsProps) {
  const [draft, setDraft] = useState<Volume>(() => ({ ...volume, style: { ...volume.style } }))
  const [picking, setPicking] = useState(false)
  const panel = useRef<HTMLDivElement>(null)
  const overrides = volumeOverrideCount(draft.style)
  const effective = resolveStyle(baseStyle, draft.style)

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

  function setOverride<K extends keyof VolumeStyle>(key: K, value: VolumeStyle[K]) {
    setDraft(previous => ({ ...previous, style: { ...previous.style, [key]: value } }))
  }

  async function pick(target: 'opening' | 'closing') {
    setPicking(true)
    try {
      const image = await onPickImage(target)
      if (image) {
        setDraft(previous => target === 'opening'
          ? { ...previous, openingImage: image }
          : { ...previous, closingImage: image })
      }
    } finally {
      setPicking(false)
    }
  }

  return <div
    className="chapter-review-backdrop"
    onMouseDown={event => { if (event.target === event.currentTarget && !busy) onCancel() }}
  >
    <div
      className="volume-settings-panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="volume-settings-title"
      tabIndex={-1}
      ref={panel}
    >
      <header className="review-heading">
        <div>
          <span className="review-eyebrow">VOLUME · 卷设置</span>
          <h2 id="volume-settings-title">{draft.title.trim() || '未命名卷'}</h2>
          <p>本卷 {chapterCount} 章。卷首图放在卷首页，卷尾图放在本卷最后一章之后。</p>
        </div>
        <button className="review-close" aria-label="关闭卷设置" title="关闭" onClick={onCancel}><X size={18}/></button>
      </header>

      <div className="vs-body">
        {error && <div className="review-error" role="alert">{error}</div>}
        <section className="vs-section">
          <h3>卷标题</h3>
          <label className="vs-field">名称<input value={draft.title} onChange={event => setDraft(previous => ({ ...previous, title: event.target.value }))} placeholder="例如：第一卷 少年"/></label>
          <label className="vs-field">标题排列<select value={draft.titleLayout ?? 'stacked'} onChange={event => setDraft(previous => ({ ...previous, titleLayout: event.target.value as 'inline' | 'stacked' }))}><option value="stacked">分两行</option><option value="inline">同一行</option></select></label>
        </section>

        <section className="vs-section">
          <div className="vs-section-head">
            <h3>本卷字体与样式</h3>
            <span className={`vs-badge ${overrides === 0 ? '' : 'active'}`}>{overrides === 0 ? '跟随全书' : `已覆盖 ${overrides} 项`}</span>
          </div>
          <p className="review-hint">修改任意一项即启用本卷独立样式，未修改的项目继续跟随全书设置。导出时会写入该卷的样式表。</p>
          <div className="vs-grid">
            <label className="vs-field">标题字体<select value={effective.titleFontFamily} onChange={event => setOverride('titleFontFamily', event.target.value)}>{availableFonts.map(font => <option key={font.value} value={font.value}>{font.label}</option>)}</select></label>
            <label className="vs-field">标题字号<input type="number" min="16" max="72" value={effective.titleFontSize} onChange={event => { const value = Number(event.target.value); if (Number.isFinite(value)) setOverride('titleFontSize', Math.min(72, Math.max(16, Math.round(value)))) }}/></label>
            <label className="vs-field">标题对齐<select value={effective.titleAlign} onChange={event => setOverride('titleAlign', event.target.value)}>{ALIGNS.map(align => <option key={align.value} value={align.value}>{align.label}</option>)}</select></label>
            <label className="vs-field">正文字体<select value={effective.bodyFontFamily} onChange={event => setOverride('bodyFontFamily', event.target.value)}>{availableFonts.map(font => <option key={font.value} value={font.value}>{font.label}</option>)}</select></label>
            <label className="vs-field">正文字号<input type="number" min="10" max="48" value={effective.bodyFontSize} onChange={event => { const value = Number(event.target.value); if (Number.isFinite(value)) setOverride('bodyFontSize', Math.min(48, Math.max(10, Math.round(value)))) }}/></label>
            <label className="vs-field">正文行距<input type="number" min="1.2" max="3" step="0.1" value={effective.bodyLineHeight} onChange={event => { const value = Number(event.target.value); if (Number.isFinite(value)) setOverride('bodyLineHeight', Math.min(3, Math.max(1.2, value))) }}/></label>
            <label className="vs-field">正文对齐<select value={effective.bodyAlign} onChange={event => setOverride('bodyAlign', event.target.value)}>{ALIGNS.map(align => <option key={align.value} value={align.value}>{align.label}</option>)}</select></label>
          </div>
          <button className="button subtle" disabled={overrides === 0} onClick={() => setDraft(previous => ({ ...previous, style: {} }))}>恢复为全书设置</button>
        </section>

        <section className="vs-section">
          <h3>卷图片</h3>
          <div className="vs-images">
            {(['opening', 'closing'] as const).map(target => {
              const image = target === 'opening' ? draft.openingImage : draft.closingImage
              return <div className="vs-image-slot" key={target}>
                <span>{target === 'opening' ? '卷首图' : '卷尾图'}</span>
                {image
                  ? <div className="vs-image-preview"><img src={image} alt={target === 'opening' ? '卷首图' : '卷尾图'}/><button title="移除图片" aria-label={`移除${target === 'opening' ? '卷首图' : '卷尾图'}`} onClick={() => setDraft(previous => target === 'opening' ? { ...previous, openingImage: null } : { ...previous, closingImage: null })}><X size={15}/></button></div>
                  : <button className="image-add" disabled={picking} onClick={() => void pick(target)}><ImagePlus size={16}/>选择图片</button>}
              </div>
            })}
          </div>
        </section>
      </div>

      <footer className="review-footer">
        <button className="button subtle delete-volume" disabled={busy} onClick={() => onDelete(draft)}>删除本卷</button>
        <div>
          <button className="button subtle" disabled={busy} onClick={onCancel}>取消</button>
          <button className="button primary" disabled={busy || picking} onClick={() => onSave({ ...draft, title: draft.title.trim() || '未命名卷' })}>保存卷设置</button>
        </div>
      </footer>
    </div>
  </div>
}
