import { useState } from 'react'
import { ImagePlus, X } from 'lucide-react'
import { chapterGroups, createChapterImage, type ChapterImage, type ChapterImagePlacement, type ChapterImageScope, type EditableChapter, type Volume } from '../book/model'

export interface ChapterImagesSettingsProps {
  entries: ChapterImage[]
  chapters: EditableChapter[]
  volumes: Volume[]
  selectedChapterId: string
  busy?: boolean
  onPickImage: () => Promise<string | null>
  onChange: (entries: ChapterImage[]) => void
}

const PLACEMENTS: { value: ChapterImagePlacement; label: string }[] = [
  { value: 'above', label: '章节标题上方' },
  { value: 'below', label: '章节标题下方' },
]

const SCOPES: { value: ChapterImageScope['type']; label: string }[] = [
  { value: 'all', label: '全部章节' },
  { value: 'chapters', label: '选定章节' },
  { value: 'volumes', label: '选定卷' },
]

/**
 * Manages the chapter image list: every entry picks its own placement around
 * the chapter title and the chapters (or volumes) it applies to.
 */
export default function ChapterImagesSettings({
  entries,
  chapters,
  volumes,
  selectedChapterId,
  busy = false,
  onPickImage,
  onChange,
}: ChapterImagesSettingsProps) {
  const [picking, setPicking] = useState(false)
  const groups = chapterGroups(chapters, volumes)
  const volumeNames = new Map(volumes.map(volume => [volume.id, volume.title]))

  function update(id: string, patch: Partial<ChapterImage>) {
    onChange(entries.map(entry => entry.id === id ? { ...entry, ...patch } : entry))
  }

  async function add() {
    setPicking(true)
    try {
      const image = await onPickImage()
      if (image) onChange([...entries, createChapterImage(image)])
    } finally {
      setPicking(false)
    }
  }

  function setScope(entry: ChapterImage, type: ChapterImageScope['type']) {
    if (type === entry.scope.type) return
    if (type === 'all') {
      update(entry.id, { scope: { type: 'all' } })
      return
    }
    if (type === 'chapters') {
      const fallback = chapters.some(chapter => chapter.id === selectedChapterId) ? [selectedChapterId] : []
      update(entry.id, { scope: { type: 'chapters', ids: fallback } })
      return
    }
    const volumeId = chapters.find(chapter => chapter.id === selectedChapterId)?.volumeId
    update(entry.id, { scope: { type: 'volumes', ids: volumeId ? [volumeId] : [] } })
  }

  function toggleScopeId(entry: ChapterImage, id: string) {
    if (entry.scope.type === 'all') return
    const ids = entry.scope.ids.includes(id)
      ? entry.scope.ids.filter(value => value !== id)
      : [...entry.scope.ids, id]
    const scope: ChapterImageScope = entry.scope.type === 'chapters'
      ? { type: 'chapters', ids }
      : { type: 'volumes', ids }
    update(entry.id, { scope })
  }

  function setAllScopeIds(entry: ChapterImage, ids: string[]) {
    if (entry.scope.type === 'all') return
    const scope: ChapterImageScope = entry.scope.type === 'chapters'
      ? { type: 'chapters', ids }
      : { type: 'volumes', ids }
    update(entry.id, { scope })
  }

  return <section className="setting-section">
    <h3>章节图片</h3>
    <p className="setting-help">默认作用于全部章节，可添加多张；每张可单独限定在选定章节或卷中生效，位置放在章节标题上方或下方。</p>
    <div className="chapter-image-list">
      {entries.map((entry, index) => {
        const scopeIds = entry.scope.type === 'all' ? [] : entry.scope.ids
        return <div className="ci-item" key={entry.id}>
          <div className="ci-item-head">
            <img className="ci-thumb" src={entry.image} alt={`章节图片 ${index + 1}`} />
            <span className="ci-title">图片 {index + 1}</span>
            <button className="ci-remove" title="删除这张章节图片" aria-label={`删除章节图片 ${index + 1}`} onClick={() => onChange(entries.filter(item => item.id !== entry.id))}><X size={15}/></button>
          </div>
          <div className="ci-fields">
            <label>位置
              <select aria-label={`图片 ${index + 1} 位置`} value={entry.placement} onChange={event => update(entry.id, { placement: event.target.value as ChapterImagePlacement })}>
                {PLACEMENTS.map(placement => <option key={placement.value} value={placement.value}>{placement.label}</option>)}
              </select>
            </label>
            <label>生效范围
              <select aria-label={`图片 ${index + 1} 生效范围`} value={entry.scope.type} onChange={event => setScope(entry, event.target.value as ChapterImageScope['type'])}>
                {SCOPES.map(scope => <option key={scope.value} value={scope.value}>{scope.label}</option>)}
              </select>
            </label>
          </div>
          {entry.scope.type !== 'all' && <div className="ci-scope">
            <div className="ci-scope-head">
              <span>{entry.scope.type === 'chapters' ? `已选 ${scopeIds.length} 章` : `已选 ${scopeIds.length} 卷`}</span>
              <span className="ci-scope-actions">
                <button onClick={() => setAllScopeIds(entry, entry.scope.type === 'chapters' ? chapters.map(chapter => chapter.id) : volumes.map(volume => volume.id))}>全选</button>
                <button onClick={() => setAllScopeIds(entry, [])}>清空</button>
              </span>
            </div>
            {entry.scope.type === 'chapters'
              ? <div className="ci-options">
                {groups.filter(group => group.chapters.length > 0).map(group => <div key={group.volume?.id ?? group.chapters[0].id}>
                  {group.volume && <div className="ci-group-title">{group.volume.title}</div>}
                  {group.chapters.map(chapter => <label className="ci-option" key={chapter.id}>
                    <input type="checkbox" checked={scopeIds.includes(chapter.id)} onChange={() => toggleScopeId(entry, chapter.id)} />
                    <span>{chapter.title || '未命名章节'}</span>
                  </label>)}
                </div>)}
              </div>
              : volumes.length > 0
                ? <div className="ci-options">
                  {volumes.map(volume => <label className="ci-option" key={volume.id}>
                    <input type="checkbox" checked={scopeIds.includes(volume.id)} onChange={() => toggleScopeId(entry, volume.id)} />
                    <span>{volume.title || '未命名卷'}</span>
                  </label>)}
                </div>
                : <p className="ci-empty">还没有卷，先在左侧新建卷。</p>}
            {entry.scope.type === 'volumes' && scopeIds.some(id => !volumeNames.has(id)) && <p className="ci-empty">已选的卷不存在。</p>}
          </div>}
        </div>
      })}
      {entries.length === 0 && <p className="ci-empty">尚未添加章节图片。</p>}
    </div>
    <button className="image-add" disabled={busy || picking} onClick={() => void add()}><ImagePlus size={17}/>{picking ? '选择图片…' : '添加章节图片'}</button>
  </section>
}
