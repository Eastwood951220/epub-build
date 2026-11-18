import { Eye, Image as ImageIcon, Info, Plus, Trash2, Type, X } from 'lucide-react'

import type { AssetData, AssetKind, AssetSummary } from '../platform/backend'
import { sharedFontFamily } from './fontSelection'
export type { AssetData, AssetKind, AssetSummary } from '../platform/backend'

type FontTarget = 'title' | 'body' | 'selection'
type ImageTarget = 'coverImage' | 'chapterImage' | 'inline'

export interface LibraryPanelProps {
  kind: AssetKind
  assets: AssetSummary[]
  counts: Record<AssetKind, number>
  previewAsset: AssetData | null
  busy: boolean
  editing: boolean
  onKindChange: (kind: AssetKind) => void
  onImport: () => void
  onDelete: (asset: AssetSummary) => void
  onPreview: (asset: AssetSummary) => void
  onClosePreview: () => void
  onUseFont: (asset: AssetSummary, target: FontTarget) => void
  onUseImage: (asset: AssetSummary, target: ImageTarget) => void
}

const kindMeta = {
  font: { label: '字体', hint: '支持 TTF · OTF · WOFF · WOFF2' },
  image: { label: '图片', hint: '支持 PNG · JPG · GIF · SVG' },
} as const

function formatMeta(asset: AssetSummary) {
  const format = (asset.mime.split('/')[1] ?? asset.mime).split('+')[0].toUpperCase()
  const size = asset.size >= 1024 * 1024
    ? `${(asset.size / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(asset.size / 1024))} KB`
  return `${format} · ${size}`
}

export default function LibraryPanel({
  kind, assets, counts, previewAsset, busy, editing,
  onKindChange, onImport, onDelete, onPreview, onClosePreview, onUseFont, onUseImage,
}: LibraryPanelProps) {
  const meta = kindMeta[kind]

  const fontActions: { label: string; title: string; target: FontTarget; disabled?: boolean }[] = [
    { label: '标题', title: '设为章节标题字体', target: 'title' },
    { label: '正文', title: '设为正文字体', target: 'body' },
    { label: '选中文字', title: '应用到选中的文字', target: 'selection', disabled: !editing },
  ]
  const imageActions: { label: string; title: string; target: ImageTarget; disabled?: boolean; wide?: boolean }[] = [
    { label: '设为封面', title: '设为图书封面', target: 'coverImage' },
    { label: '章节图片', title: '添加为章节标题下方图片（默认全部章节）', target: 'chapterImage' },
    { label: '光标处', title: '插入到光标处', target: 'inline', disabled: !editing, wide: true },
  ]

  return (
    <div className="library-panel">
      <header className="library-head">
        <div className="library-head-text">
          <span className="eyebrow">本机 SQLite 资源库</span>
          <h2>字体与图片</h2>
        </div>
        {assets.length > 0 && (
          <button className="library-add" disabled={busy} onClick={onImport} title={`导入${meta.label}`} aria-label={`导入${meta.label}`}>
            <Plus size={14} />导入
          </button>
        )}
      </header>

      <div className="library-switch" role="tablist" aria-label="资源类型">
        <button role="tab" aria-selected={kind === 'font'} className={kind === 'font' ? 'active' : ''} onClick={() => onKindChange('font')}>
          <Type size={13} />字体<em>{counts.font}</em>
        </button>
        <button role="tab" aria-selected={kind === 'image'} className={kind === 'image' ? 'active' : ''} onClick={() => onKindChange('image')}>
          <ImageIcon size={13} />图片<em>{counts.image}</em>
        </button>
      </div>

      <div className="library-body">
        {previewAsset && (
          <section className="library-preview" aria-label={`${previewAsset.name} 预览`}>
            <div className="library-preview-head">
              <span className="library-preview-badge">预览</span>
              <strong title={previewAsset.name}>{previewAsset.name}</strong>
              <button className="library-preview-close" title="收起预览" aria-label="收起预览" onClick={onClosePreview}><X size={13} /></button>
            </div>
            <div className="library-preview-body">
              {previewAsset.kind === 'image'
                ? <img src={previewAsset.dataUri} alt={previewAsset.name} />
                : <div className="library-specimen" style={{ fontFamily: `'${sharedFontFamily(previewAsset.id)}', serif` }}>
                  <p className="library-specimen-sample">春江花月夜</p>
                  <p className="library-specimen-note">永和九年，岁在癸丑 · ABC 123</p>
                </div>}
            </div>
          </section>
        )}

        {assets.length === 0
          ? <div className="library-empty">
            <span className="library-empty-icon">{kind === 'font' ? <Type size={18} /> : <ImageIcon size={18} />}</span>
            <strong>还没有{meta.label}</strong>
            <p>{meta.hint}</p>
            <button className="button primary" disabled={busy} onClick={onImport}><Plus size={15} />导入{meta.label}</button>
          </div>
          : <ul className="library-list">
            {assets.map(asset => (
              <li className="library-card" key={asset.id}>
                <div className="library-card-head">
                  <span className={`library-card-icon ${kind}`}>{kind === 'font' ? <Type size={14} /> : <ImageIcon size={14} />}</span>
                  <div className="library-card-text">
                    <strong title={asset.name}>{asset.name}</strong>
                    <small>{formatMeta(asset)}</small>
                  </div>
                  <button className="library-card-delete" title={`删除 ${asset.name}`} aria-label={`删除 ${asset.name}`} onClick={() => onDelete(asset)}><Trash2 size={14} /></button>
                </div>
                <div className="library-card-actions">
                  <button className="library-action" title={`预览 ${asset.name}`} onClick={() => onPreview(asset)}><Eye size={12} />预览</button>
                  {kind === 'font'
                    ? fontActions.map(action => (
                      <button key={action.target} className="library-action" title={action.title} disabled={action.disabled}
                        onClick={() => onUseFont(asset, action.target)}>{action.label}</button>
                    ))
                    : imageActions.map(action => (
                      <button key={action.target} className={`library-action${action.wide ? ' wide' : ''}`} title={action.title} disabled={action.disabled}
                        onClick={() => onUseImage(asset, action.target)}>{action.label}</button>
                    ))}
                </div>
              </li>
            ))}
          </ul>}

        <p className="library-note"><Info size={12} />资源保存在本机，应用到书稿后，项目和导出的 EPUB 会一并保留。</p>
      </div>
    </div>
  )
}
