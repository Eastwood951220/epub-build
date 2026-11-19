import { useEffect, useRef, useState } from 'react'
import {
  backend, type AssetKind, type AssetSummary,
  type ProjectAssetGroup, type ProjectAssetRef, type WorkspaceSummary,
} from '../platform/backend'
import { open } from '@tauri-apps/plugin-dialog'
import { BookOpen, ChevronDown, FilePlus2, FolderOpen, Image as ImageIcon, Plus, Settings2, Trash2, Type, X } from 'lucide-react'
import { startWindowDrag } from '../platform/windowDrag'
import { assetMeta, kindLabel, markShared, pendingAssets } from './projectAssets'
import { sharedFontFamily } from './fontSelection'
import SettingsDialog from '../settings/SettingsDialog'
import ImagePreviewDialog from './ImagePreviewDialog'

export type { WorkspaceSummary } from '../platform/backend'

type Tab = 'projects' | 'font' | 'image'
interface Props {
  workspaces: WorkspaceSummary[]
  busy: boolean
  error: string
  notice: string
  onOpen: (id: number) => Promise<void>
  onDelete: (id: number) => Promise<void>
  onImportBook: () => Promise<void>
  onImportProject: () => Promise<void>
}

interface PreviewState { name: string; kind: AssetKind; mime: string; dataUri: string; family: string }

const filters = {
  font: [{ name: '字体', extensions: ['ttf', 'otf', 'woff', 'woff2'] }],
  image: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] }],
}
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

// A large project is expensive to parse. Keep thumbnail requests from
// competing with each other while the user scrolls through its cards.
let activeProjectImageLoads = 0
const waitingProjectImageLoads: Array<() => void> = []
function queueProjectImage(load: () => Promise<string>, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const start = () => {
      if (signal.aborted) { reject(new Error('已取消')); waitingProjectImageLoads.shift()?.(); return }
      activeProjectImageLoads++
      void load().then(resolve, reject).finally(() => {
        activeProjectImageLoads--
        waitingProjectImageLoads.shift()?.()
      })
    }
    if (activeProjectImageLoads < 2) start()
    else waitingProjectImageLoads.push(start)
  })
}

/** Loads its picture only once the card scrolls near the viewport. */
function LazyImage({ name, load }: { name: string; load: (signal: AbortSignal) => Promise<string> }) {
  const element = useRef<HTMLDivElement>(null)
  const loader = useRef(load)
  const [source, setSource] = useState<string | null>(null)
  useEffect(() => { loader.current = load })
  useEffect(() => {
    const target = element.current
    if (!target) return
    let active = true
    const controller = new AbortController()
    const observer = new IntersectionObserver(entries => {
      if (!entries[0].isIntersecting) return
      observer.disconnect()
      void loader.current(controller.signal).then(uri => {
        if (!active) return
        const picture = new Image()
        picture.onload = () => {
          if (!active) return
          const scale = Math.min(1, 480 / picture.naturalWidth, 320 / picture.naturalHeight)
          const canvas = document.createElement('canvas')
          canvas.width = Math.max(1, Math.round(picture.naturalWidth * scale))
          canvas.height = Math.max(1, Math.round(picture.naturalHeight * scale))
          try {
            const context = canvas.getContext('2d')
            if (!context) throw new Error('缩略图画布不可用')
            context.drawImage(picture, 0, 0, canvas.width, canvas.height)
            setSource(canvas.toDataURL('image/webp', .82))
          } catch { setSource(uri) }
        }
        picture.onerror = () => { if (active) setSource(null) }
        picture.src = uri
      }).catch(() => {})
    }, { rootMargin: '24px' })
    observer.observe(target)
    return () => { active = false; controller.abort(); observer.disconnect() }
  }, [])
  return <div className="books-asset-symbol books-asset-picture" ref={element}>{source ? <img src={source} alt={name} decoding="async"/> : <ImageIcon size={30}/>}</div>
}

interface GroupProps {
  project: WorkspaceSummary
  kind: AssetKind
  group?: ProjectAssetGroup
  groupError?: string
  busy: boolean
  onLoad: (projectId: number) => Promise<void>
  onPreview: (projectId: number, item: ProjectAssetRef) => void
  onExtract: (projectId: number, items: ProjectAssetRef[]) => void
}

/** Opening a project reads the full book, so fetch only after the user expands it. */
function ProjectGroup({ project, kind, group, groupError, busy, onLoad, onPreview, onExtract }: GroupProps) {
  const [expanded, setExpanded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [visibleCount, setVisibleCount] = useState(24)

  async function toggle() {
    if (expanded) { setExpanded(false); return }
    setExpanded(true)
    if (group || loading) return
    setLoading(true)
    try { await onLoad(project.id) } finally { setLoading(false) }
  }

  const items = group ? (kind === 'font' ? group.fonts : group.images) : []
  const pending = pendingAssets(items)
  const label = kindLabel(kind)
  return <div className="books-library-group">
    <div className="books-library-group-head">
      <button className="books-group-toggle" aria-expanded={expanded} onClick={() => void toggle()} title={`查看 ${project.title} 的${label}`}>
        <ChevronDown size={17}/><span>{project.title}</span>
      </button>
      <small>{group ? `${items.length} 项${label}` : loading ? '读取中…' : '点击展开'}</small>
      {expanded && pending.length > 0 && <button className="books-group-action" onClick={() => onExtract(project.id, pending)} disabled={busy}>
        {kind === 'font' ? '全部放入字体库' : '全部提取为公用'}
      </button>}
    </div>
    {expanded && (groupError ? <p className="books-library-group-note" role="alert">{groupError}</p>
      : !group ? <p className="books-library-group-note">正在读取工程资源…</p>
        : items.length === 0 ? <p className="books-library-group-note">这个工程还没有{label}。</p>
          : <><div className="books-assets-grid">{items.slice(0, visibleCount).map(item => <article className="books-asset-item" key={item.key}>
            {kind === 'font'
              ? <div className="books-asset-symbol"><Type size={30}/></div>
              : <LazyImage name={item.name} load={signal => queueProjectImage(
                () => backend.readProjectAsset(project.id, item.key).then(data => data.dataUri), signal,
              )}/>}
            <strong title={item.name}>{item.name}</strong>
            <small>{assetMeta(item)}{item.inLibrary ? ' · 已公用' : ''}</small>
            <div>
              <button onClick={() => onPreview(project.id, item)} disabled={busy}>预览</button>
              <button className="books-asset-take" onClick={() => onExtract(project.id, [item])} disabled={busy || item.inLibrary} title={item.inLibrary ? '公用库中已有同一份' : (kind === 'font' ? '复制到字体库' : '复制到公用图片')}>
                {item.inLibrary ? '已公用' : (kind === 'font' ? '放入字体库' : '提取公用')}
              </button>
            </div>
          </article>)}</div>
            {items.length > visibleCount && <button className="books-show-more" onClick={() => setVisibleCount(count => count + 24)}>
              显示更多 · 还有 {items.length - visibleCount} 项
            </button>}</>)}
  </div>
}

export default function Home({ workspaces, busy, error, notice, onOpen, onDelete, onImportBook, onImportProject }: Props) {
  const [tab, setTab] = useState<Tab>('projects')
  const [showSettings, setShowSettings] = useState(false)
  const [assets, setAssets] = useState<AssetSummary[]>([])
  const [groups, setGroups] = useState<Record<number, ProjectAssetGroup>>({})
  const [groupRevision, setGroupRevision] = useState(0)
  const [groupErrors, setGroupErrors] = useState<Record<number, string>>({})
  const [preview, setPreview] = useState<PreviewState | null>(null)
  const [libraryBusy, setLibraryBusy] = useState(false)
  const [libraryError, setLibraryError] = useState('')
  const [libraryNotice, setLibraryNotice] = useState('')
  const kind: AssetKind = tab === 'image' ? 'image' : 'font'

  useEffect(() => {
    if (tab === 'projects') return
    let active = true
    setPreview(null)
    setAssets([])
    setLibraryError('')
    void backend.listAssets(kind)
      .then(items => { if (active) setAssets(items) })
      .catch(cause => { if (active) setLibraryError(errorMessage(cause)) })
    return () => { active = false }
  }, [tab, kind])

  async function withLibraryBusy(action: () => Promise<void>) {
    setLibraryBusy(true)
    setLibraryError('')
    try { await action() } catch (cause) { setLibraryError(errorMessage(cause)) } finally { setLibraryBusy(false) }
  }

  async function importAsset() {
    const path = await open({ multiple: false, filters: filters[kind] })
    if (typeof path !== 'string') return
    await withLibraryBusy(async () => {
      await backend.importAsset(path, kind)
      setAssets(await backend.listAssets(kind))
      setGroups({})
      setGroupErrors({})
      setGroupRevision(previous => previous + 1)
      setLibraryNotice('资源已导入公用库')
    })
  }

  async function deleteAsset(asset: AssetSummary) {
    if (!window.confirm(`从公用资源库删除“${asset.name}”？已用于工程的资源仍会保留。`)) return
    await withLibraryBusy(async () => {
      await backend.deleteAsset(asset.id)
      setAssets(await backend.listAssets(kind))
      // The shared mark on project cards may be stale now.
      setGroups({})
      setGroupErrors({})
      setGroupRevision(previous => previous + 1)
      if (preview?.name === asset.name) setPreview(null)
      setLibraryNotice('资源已删除')
    })
  }

  async function previewAsset(asset: AssetSummary) {
    await withLibraryBusy(async () => {
      const data = await backend.getAsset(asset.id)
      setPreview({ name: data.name, kind: asset.kind, mime: data.mime, dataUri: data.dataUri, family: asset.kind === 'font' ? sharedFontFamily(asset.id) : '' })
    })
  }

  async function loadGroup(projectId: number) {
    try {
      const group = await backend.listProjectAssets(projectId)
      setGroups(previous => ({ ...previous, [projectId]: group }))
      setGroupErrors(previous => {
        if (!(projectId in previous)) return previous
        const next = { ...previous }
        delete next[projectId]
        return next
      })
    } catch (cause) {
      setGroupErrors(previous => ({ ...previous, [projectId]: errorMessage(cause) }))
    }
  }

  async function previewProjectAsset(projectId: number, item: ProjectAssetRef) {
    await withLibraryBusy(async () => {
      const data = await backend.readProjectAsset(projectId, item.key)
      setPreview({
        name: data.name, kind, mime: data.mime, dataUri: data.dataUri,
        family: kind === 'font' ? `EPUBStudioFont${item.key}` : '',
      })
    })
  }

  async function extractProjectAssets(projectId: number, items: ProjectAssetRef[]) {
    const pending = pendingAssets(items)
    if (pending.length === 0) return
    await withLibraryBusy(async () => {
      for (const item of pending) await backend.extractProjectAsset(projectId, item.key)
      const keys = pending.map(item => item.key)
      setGroups(previous => previous[projectId]
        ? { ...previous, [projectId]: { ...previous[projectId], ...markShared(previous[projectId], kind, keys) } }
        : previous)
      setAssets(await backend.listAssets(kind))
      setLibraryNotice(`已把 ${keys.length} 项${kindLabel(kind)}放入公用库`)
    })
  }

  const label = kindLabel(kind)
  // Only a data URI whose MIME matches can reach the @font-face rule.
  const fontPreviewCss = preview?.family && /^font\/(ttf|otf|woff|woff2)$/.test(preview.mime)
    && new RegExp(`^data:${preview.mime};base64,[A-Za-z0-9+/=]+$`).test(preview.dataUri)
    ? `@font-face{font-family:'${preview.family}';src:url('${preview.dataUri}')}` : ''

  return <div className="books-home">
    <style>{fontPreviewCss}</style>
    <header className="books-home-header" onMouseDown={startWindowDrag}>
      <div className="books-brand"><span><BookOpen size={22}/></span><div><strong>EPUB Studio</strong><small>我的图书工作台</small></div></div>
      <div className="books-header-actions">
        <button className="books-new" onClick={onImportBook} disabled={busy}><FilePlus2 size={16}/>导入 TXT / EPUB</button>
        <button onClick={onImportProject} disabled={busy}><FolderOpen size={16}/>导入项目</button>
        <button onClick={() => setShowSettings(true)} title="设置" aria-label="设置"><Settings2 size={16}/>设置</button>
      </div>
    </header>
    {busy && <div className="books-loading" role="status"><span className="loading-spinner" aria-hidden="true"/>正在处理工程…</div>}
    <div className="books-home-scroll"><div className="books-home-inner">
      <nav className="books-tabs" aria-label="首页分类">
        <button className={tab === 'projects' ? 'active' : ''} aria-current={tab === 'projects' ? 'page' : undefined} onClick={() => setTab('projects')}><BookOpen size={17}/>工程</button>
        <button className={tab === 'font' ? 'active' : ''} aria-current={tab === 'font' ? 'page' : undefined} onClick={() => setTab('font')}><Type size={17}/>字体库</button>
        <button className={tab === 'image' ? 'active' : ''} aria-current={tab === 'image' ? 'page' : undefined} onClick={() => setTab('image')}><ImageIcon size={17}/>图片库</button>
      </nav>
      {(error || libraryError) && <div className="books-error" role="alert">{error || libraryError}</div>}
      {tab === 'projects' ? <section aria-label="工程书架">
        <div className="books-section-title"><div><span>LIBRARY</span><h1>我的工程</h1></div><p>{workspaces.length} 本书</p></div>
        {workspaces.length === 0 ? <div className="books-empty"><BookOpen size={36}/><h2>书架还是空的</h2><p>导入 TXT 或 EPUB 文件，核对章节后创建工程。</p><button className="books-new" onClick={onImportBook} disabled={busy}><FilePlus2 size={17}/>导入 TXT / EPUB</button></div> : <div className="books-grid">
          {workspaces.map(workspace => <article className="books-item" key={workspace.id}>
            <button className="books-cover-button" onClick={() => onOpen(workspace.id)} disabled={busy} aria-label={`打开工程 ${workspace.title}`}>
              {workspace.coverImage ? <img src={workspace.coverImage} alt={`${workspace.title}封面`}/> : <div className="books-cover-fallback"><span>{workspace.title}</span><small>{workspace.author || '未知作者'}</small></div>}
            </button>
            <div className="books-item-caption"><button className="books-item-title" onClick={() => onOpen(workspace.id)} disabled={busy} title={workspace.title}>{workspace.title}</button><button className="books-item-menu" onClick={() => { if (window.confirm(`删除工程“${workspace.title}”？此操作无法撤销。`)) void onDelete(workspace.id) }} disabled={busy} title={`删除 ${workspace.title}`} aria-label={`删除 ${workspace.title}`}><Trash2 size={16}/></button></div>
            <p>{workspace.author || '未知作者'} · {workspace.chapterCount} 章</p>
          </article>)}
        </div>}
      </section> : <section aria-label={label}>
        <div className="books-section-title"><div><span>SHARED ASSETS</span><h1>{label}</h1></div><button className="books-new" onClick={importAsset} disabled={libraryBusy}><Plus size={17}/>导入{label}</button></div>
        <p className="books-library-help">公用{label}由所有工程共享；工程{label}来自各书稿内嵌的资源，提取只是复制一份，书稿本身不变。</p>
        {preview?.kind === 'font' && <div className="books-asset-preview"><div><strong>{preview.name}</strong><button onClick={() => setPreview(null)} aria-label="关闭预览"><X size={18}/></button></div><p style={{fontFamily:`'${preview.family}',serif`}}>春江花月夜 · ABC 123</p></div>}
        <div className="books-subhead">公用{label}<em>{assets.length}</em></div>
        {assets.length === 0 ? <div className="books-empty"><span>{tab === 'font' ? <Type size={36}/> : <ImageIcon size={36}/>}</span><h2>还没有公用{label}</h2><p>点击右上角导入，之后可在任何工程中使用。</p></div> : <div className="books-assets-grid">{assets.map(asset => <article className="books-asset-item" key={asset.id}>{tab === 'font' ? <div className="books-asset-symbol"><Type size={30}/></div> : <LazyImage name={asset.name} load={() => backend.getAsset(asset.id).then(data => data.dataUri)}/>}<strong title={asset.name}>{asset.name}</strong><small>{assetMeta(asset)}</small><div><button onClick={() => previewAsset(asset)} disabled={libraryBusy}>预览</button><button onClick={() => deleteAsset(asset)} disabled={libraryBusy} title={`删除 ${asset.name}`} aria-label={`删除 ${asset.name}`}><Trash2 size={16}/></button></div></article>)}</div>}
        <div className="books-subhead">工程{label}<em>{workspaces.length}</em></div>
        {workspaces.length === 0 ? <p className="books-library-group-note">还没有工程，导入一本后这里会列出它内嵌的{label}。</p> : workspaces.map(project => <ProjectGroup
          key={`${project.id}-${groupRevision}`} project={project} kind={kind} group={groups[project.id]} groupError={groupErrors[project.id]}
          busy={libraryBusy} onLoad={loadGroup} onPreview={previewProjectAsset} onExtract={extractProjectAssets}/>)}
      </section>}
    </div></div>
    <footer className="books-home-status"><span>{libraryNotice || notice}</span><span>{busy || libraryBusy ? '处理中…' : '本机工程 · 公用资源库'}</span></footer>
    {showSettings && <SettingsDialog onClose={() => setShowSettings(false)}/>}
    {preview?.kind === 'image' && <ImagePreviewDialog name={preview.name} dataUri={preview.dataUri} onClose={() => setPreview(null)}/>}
  </div>
}
