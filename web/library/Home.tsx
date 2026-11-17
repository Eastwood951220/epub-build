import { useEffect, useRef, useState, type FormEvent } from 'react'
import { backend, type AssetData, type AssetKind, type AssetSummary, type WorkspaceSummary } from '../platform/backend'
import { open } from '@tauri-apps/plugin-dialog'
import { BookOpen, FilePlus2, FolderOpen, Image as ImageIcon, Plus, Trash2, Type, X } from 'lucide-react'
import { startWindowDrag } from '../platform/windowDrag'

export type { WorkspaceSummary } from '../platform/backend'

type Tab = 'projects' | 'font' | 'image'
export interface NewWorkspaceDetails { title: string; author: string; language: string }
interface Props {
  workspaces: WorkspaceSummary[]
  busy: boolean
  error: string
  notice: string
  onCreate: (details: NewWorkspaceDetails) => Promise<void>
  onOpen: (id: number) => Promise<void>
  onDelete: (id: number) => Promise<void>
  onImportBook: () => Promise<void>
  onImportProject: () => Promise<void>
}

const filters = {
  font: [{ name: '字体', extensions: ['ttf', 'otf', 'woff', 'woff2'] }],
  image: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] }],
}
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

function ImageThumbnail({ asset }: { asset: AssetSummary }) {
  const element = useRef<HTMLDivElement>(null)
  const [source, setSource] = useState<string | null>(null)
  useEffect(() => {
    const target = element.current
    if (!target) return
    const observer = new IntersectionObserver(entries => {
      if (!entries[0].isIntersecting) return
      observer.disconnect()
      void backend.getAsset(asset.id).then(data => setSource(data.dataUri)).catch(() => {})
    }, { rootMargin: '100px' })
    observer.observe(target)
    return () => observer.disconnect()
  }, [asset.id])
  return <div className="books-asset-symbol" ref={element}>{source ? <img src={source} alt={asset.name}/> : <ImageIcon size={30}/>}</div>
}

export default function Home({ workspaces, busy, error, notice, onCreate, onOpen, onDelete, onImportBook, onImportProject }: Props) {
  const [tab, setTab] = useState<Tab>('projects')
  const [showCreate, setShowCreate] = useState(false)
  const [details, setDetails] = useState<NewWorkspaceDetails>({ title: '', author: '', language: 'zh-CN' })
  const [assets, setAssets] = useState<AssetSummary[]>([])
  const [preview, setPreview] = useState<AssetData | null>(null)
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

  useEffect(() => {
    if (!showCreate) return
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setShowCreate(false) }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [showCreate])

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
      setLibraryNotice('资源已导入公共库')
    })
  }

  async function deleteAsset(asset: AssetSummary) {
    if (!window.confirm(`从公共资源库删除“${asset.name}”？已用于工程的资源仍会保留。`)) return
    await withLibraryBusy(async () => {
      await backend.deleteAsset(asset.id)
      setAssets(await backend.listAssets(kind))
      if (preview?.id === asset.id) setPreview(null)
      setLibraryNotice('资源已删除')
    })
  }

  async function previewAsset(asset: AssetSummary) {
    await withLibraryBusy(async () => setPreview(await backend.getAsset(asset.id)))
  }

  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!details.title.trim()) return
    void onCreate(details)
  }

  const fontPreviewCss = preview?.kind === 'font' && /^font\/(ttf|otf|woff|woff2)$/.test(preview.mime) && new RegExp(`^data:${preview.mime};base64,[A-Za-z0-9+/=]+$`).test(preview.dataUri)
    ? `@font-face{font-family:'EPUBStudioFont${preview.id}';src:url('${preview.dataUri}')}` : ''

  return <div className="books-home">
    <style>{fontPreviewCss}</style>
    <header className="books-home-header" onMouseDown={startWindowDrag}>
      <div className="books-brand"><span><BookOpen size={22}/></span><div><strong>EPUB Studio</strong><small>我的图书工作台</small></div></div>
      <div className="books-header-actions">
        <button onClick={onImportBook} disabled={busy}><FilePlus2 size={16}/>导入 TXT / EPUB</button>
        <button onClick={onImportProject} disabled={busy}><FolderOpen size={16}/>导入项目</button>
        <button className="books-new" onClick={() => setShowCreate(true)} disabled={busy}><Plus size={17}/>新建工程</button>
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
        {workspaces.length === 0 ? <div className="books-empty"><BookOpen size={36}/><h2>书架还是空的</h2><p>创建工程并填写书名、作者，封面可以稍后上传。</p><button className="books-new" onClick={() => setShowCreate(true)}><Plus size={17}/>新建工程</button></div> : <div className="books-grid">
          {workspaces.map(workspace => <article className="books-item" key={workspace.id}>
            <button className="books-cover-button" onClick={() => onOpen(workspace.id)} disabled={busy} aria-label={`打开工程 ${workspace.title}`}>
              {workspace.coverImage ? <img src={workspace.coverImage} alt={`${workspace.title}封面`}/> : <div className="books-cover-fallback"><span>{workspace.title}</span><small>{workspace.author || '未知作者'}</small></div>}
            </button>
            <div className="books-item-caption"><button className="books-item-title" onClick={() => onOpen(workspace.id)} disabled={busy} title={workspace.title}>{workspace.title}</button><button className="books-item-menu" onClick={() => { if (window.confirm(`删除工程“${workspace.title}”？此操作无法撤销。`)) void onDelete(workspace.id) }} disabled={busy} title={`删除 ${workspace.title}`} aria-label={`删除 ${workspace.title}`}><Trash2 size={16}/></button></div>
            <p>{workspace.author || '未知作者'} · {workspace.chapterCount} 章</p>
          </article>)}
          <button className="books-add-tile" onClick={() => setShowCreate(true)}><Plus size={32}/><span>新建工程</span></button>
        </div>}
      </section> : <section aria-label={tab === 'font' ? '字体库' : '图片库'}>
        <div className="books-section-title"><div><span>SHARED ASSETS</span><h1>{tab === 'font' ? '字体库' : '图片库'}</h1></div><button className="books-new" onClick={importAsset} disabled={libraryBusy}><Plus size={17}/>导入{tab === 'font' ? '字体' : '图片'}</button></div>
        <p className="books-library-help">资源由所有工程共享。选入书稿后会随工程保存。</p>
        {preview && <div className="books-asset-preview"><div><strong>{preview.name}</strong><button onClick={() => setPreview(null)} aria-label="关闭预览"><X size={18}/></button></div>{preview.kind === 'image' ? <img src={preview.dataUri} alt={preview.name}/> : <p style={{fontFamily:`'EPUBStudioFont${preview.id}',serif`}}>春江花月夜 · ABC 123</p>}</div>}
        {assets.length === 0 ? <div className="books-empty"><span>{tab === 'font' ? <Type size={36}/> : <ImageIcon size={36}/>}</span><h2>还没有{tab === 'font' ? '字体' : '图片'}</h2><p>点击右上角导入，之后可在任何工程中使用。</p></div> : <div className="books-assets-grid">{assets.map(asset => <article className="books-asset-item" key={asset.id}>{tab === 'font' ? <div className="books-asset-symbol"><Type size={30}/></div> : <ImageThumbnail asset={asset}/>}<strong title={asset.name}>{asset.name}</strong><small>{asset.mime} · {(asset.size / 1024).toFixed(1)} KB</small><div><button onClick={() => previewAsset(asset)} disabled={libraryBusy}>预览</button><button onClick={() => deleteAsset(asset)} disabled={libraryBusy} title={`删除 ${asset.name}`} aria-label={`删除 ${asset.name}`}><Trash2 size={16}/></button></div></article>)}</div>}
      </section>}
    </div></div>
    <footer className="books-home-status"><span>{libraryNotice || notice}</span><span>{busy || libraryBusy ? '处理中…' : '本机工程 · 公共资源库'}</span></footer>
    {showCreate && <div className="books-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setShowCreate(false) }}><form className="books-create-modal" role="dialog" aria-modal="true" aria-labelledby="create-title" onSubmit={create}>
      <div className="books-modal-heading"><div><span>NEW PROJECT</span><h2 id="create-title">创建工程</h2></div><button type="button" onClick={() => setShowCreate(false)} aria-label="关闭"><X size={19}/></button></div>
      <p>填写图书基本信息。封面可在进入工程后上传。</p>
      {error && <div className="books-error" role="alert">{error}</div>}
      <label htmlFor="create-book-title">书名 <span>*</span></label><input id="create-book-title" value={details.title} onChange={event => setDetails(previous => ({...previous,title:event.target.value}))} autoFocus required placeholder="输入书名"/>
      <label htmlFor="create-book-author">作者</label><input id="create-book-author" value={details.author} onChange={event => setDetails(previous => ({...previous,author:event.target.value}))} placeholder="输入作者"/>
      <label htmlFor="create-book-language">语言</label><input id="create-book-language" value={details.language} onChange={event => setDetails(previous => ({...previous,language:event.target.value}))} placeholder="zh-CN"/>
      <div className="books-modal-actions"><button type="button" onClick={() => setShowCreate(false)}>取消</button><button className="books-new" type="submit" disabled={busy || !details.title.trim()}>创建并编辑</button></div>
    </form></div>}
  </div>
}
