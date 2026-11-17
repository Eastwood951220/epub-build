import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import TextAlign from '@tiptap/extension-text-align'
import { TextStyleKit } from '@tiptap/extension-text-style'
import { invoke } from '@tauri-apps/api/core'
import { open, save } from '@tauri-apps/plugin-dialog'
import DOMPurify from 'dompurify'
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, BookOpen, ChevronDown,
  ChevronRight, ChevronUp, Download, FolderOpen, ImagePlus, Italic, List,
  ListOrdered, ListTree, Layers, Settings2, Plus, Redo2, Save, Trash2, Undo2, X,
  LibraryBig, House,
} from 'lucide-react'
import {
  chapterGroups, chapterStyle, chapterVolume, createEmptyProject, createVolume, fontChoices,
  previewStyles, reindexChapterLinks, resolveStyle, type BookStyle, type EditableChapter, type Project, type Volume,
} from './model'
import { PreserveIds } from './PreserveIds'
import ChapterReview from './ChapterReview'
import VolumeSettings from './VolumeSettings'
import LibraryPanel, { type AssetData, type AssetKind, type AssetSummary } from './LibraryPanel'
import Home, { type WorkspaceSummary } from './Home'

type View = 'edit' | 'preview'
interface ReviewState { mode: 'import' | 'manage'; book: Project; sourcePath?: string }
const imageFilters = [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'svg'] }]
const fontFilters = [{ name: '字体', extensions: ['ttf', 'otf', 'woff', 'woff2'] }]

function errorMessage(error: unknown) { return error instanceof Error ? error.message : String(error) }
function safeName(name: string) { return name.replace(/[\\/:*?"<>|]/g, '_').trim() || '未命名图书' }

export default function App() {
  const [book, setBook] = useState<Project>(createEmptyProject)
  const [screen, setScreen] = useState<'home' | 'editor'>('home')
  const [workspaceId, setWorkspaceId] = useState<number | null>(null)
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([])
  const [selectedId, setSelectedId] = useState(book.chapters[0].id)
  const [view, setView] = useState<View>('edit')
  const [settingsTab, setSettingsTab] = useState<'settings' | 'library'>('settings')
  const [assetKind, setAssetKind] = useState<AssetKind>('font')
  const [assetsByKind, setAssetsByKind] = useState<Record<AssetKind, AssetSummary[]>>({ font: [], image: [] })
  const [previewAsset, setPreviewAsset] = useState<AssetData | null>(null)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('准备就绪')
  const [error, setError] = useState('')
  const [review, setReview] = useState<ReviewState | null>(null)
  const [reviewKey, setReviewKey] = useState(0)
  const [volumeSettingsId, setVolumeSettingsId] = useState<string | null>(null)
  const [collapsedVolumeIds, setCollapsedVolumeIds] = useState<string[]>([])
  const selectedIdRef = useRef(selectedId)
  const bookRef = useRef(book)
  const editorScrollRef = useRef<HTMLDivElement>(null)
  selectedIdRef.current = selectedId
  bookRef.current = book

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, HTMLAttributes: { target: null, rel: null } } }),
      PreserveIds,
      TextStyleKit,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Image.configure({ allowBase64: true }),
    ],
    content: book.chapters[0].html,
    onUpdate: ({ editor: current }) => {
      const id = selectedIdRef.current
      const html = current.getHTML()
      setBook(previous => ({ ...previous, chapters: previous.chapters.map(chapter => chapter.id === id ? { ...chapter, html } : chapter) }))
      setDirty(true)
    },
  })

  useEffect(() => {
    const chapter = bookRef.current.chapters.find(item => item.id === selectedId)
    if (editor && chapter && editor.getHTML() !== chapter.html) editor.commands.setContent(chapter.html, { emitUpdate: false })
  }, [selectedId, editor])

  function scrollEditorToTop() {
    const node = editorScrollRef.current
    if (node) node.scrollTop = 0
  }

  function selectChapter(id: string) {
    setSelectedId(id)
    scrollEditorToTop()
  }

  function toggleVolume(volumeId: string) {
    setCollapsedVolumeIds(previous => previous.includes(volumeId) ? previous.filter(id => id !== volumeId) : [...previous, volumeId])
  }

  // 切换章节时正文回到开头；重复点击当前章节也回到开头。
  useEffect(() => {
    scrollEditorToTop()
  }, [selectedId])

  // 选中章节变化时展开它所在的卷，避免当前章节被折叠在列表外。
  useEffect(() => {
    const volumeId = bookRef.current.chapters.find(chapter => chapter.id === selectedId)?.volumeId
    if (volumeId) setCollapsedVolumeIds(previous => previous.includes(volumeId) ? previous.filter(id => id !== volumeId) : previous)
  }, [selectedId])

  useEffect(() => {
    if (settingsTab !== 'library') return
    setPreviewAsset(null)
    void loadLibraryAssets().catch(cause => setError(errorMessage(cause)))
  }, [settingsTab])

  useEffect(() => {
    void invoke<WorkspaceSummary[]>('list_workspaces').then(setWorkspaces).catch(cause => setError(errorMessage(cause)))
  }, [])

  const assets = assetsByKind[assetKind]
  const selectedChapter = book.chapters.find(item => item.id === selectedId) ?? book.chapters[0]
  const selectedIndex = book.chapters.findIndex(item => item.id === selectedId)
  const currentVolume = chapterVolume(book, selectedChapter)
  const groups = useMemo(() => chapterGroups(book.chapters, book.volumes), [book.chapters, book.volumes])
  const chapterIndex = useMemo(() => new Map(book.chapters.map((chapter, index) => [chapter.id, index])), [book.chapters])
  const editingVolume = volumeSettingsId ? book.volumes.find(volume => volume.id === volumeSettingsId) : undefined

  function updateBook(next: (previous: Project) => Project) {
    setBook(next)
    setDirty(true)
  }

  function setStyle<K extends keyof BookStyle>(key: K, value: BookStyle[K]) {
    updateBook(previous => ({ ...previous, style: { ...previous.style, [key]: value } }))
  }

  function replaceBook(next: Project, id: number, message: string) {
    next = { ...next, coverImage: next.coverImage ?? null, fontAssets: next.fontAssets ?? [] }
    editor?.commands.setContent(next.chapters[0].html, { emitUpdate: false })
    setBook(next)
    setSelectedId(next.chapters[0].id)
    setWorkspaceId(id)
    setVolumeSettingsId(null)
    setCollapsedVolumeIds([])
    setDirty(false)
    setView('edit')
    setSettingsTab('settings')
    setScreen('editor')
    setError('')
    setNotice(message)
  }

  function canReplace() { return !dirty || window.confirm('当前修改尚未保存，确定继续吗？') }

  async function withBusy(action: () => Promise<void>) {
    setBusy(true)
    setError('')
    try { await action() } catch (cause) { setError(errorMessage(cause)) } finally { setBusy(false) }
  }

  function openReview(mode: ReviewState['mode'], source: Project, sourcePath?: string) {
    setError('')
    setReview({ mode, book: source, sourcePath })
    setReviewKey(key => key + 1)
  }

  async function confirmReview(chapters: EditableChapter[], volumes: Volume[]) {
    if (!review) return
    const next: Project = {
      ...review.book,
      chapters: reindexChapterLinks(review.book.chapters, chapters),
      volumes,
      coverImage: review.book.coverImage ?? null,
      fontAssets: review.book.fontAssets ?? [],
    }
    if (review.mode === 'import') {
      await withBusy(async () => {
        const created = await invoke<WorkspaceSummary>('create_workspace', { book: next })
        replaceBook(next, created.id, `已导入 ${next.chapters.length} 个章节并创建工程`)
        setReview(null)
      })
      return
    }
    setBook(next)
    setDirty(true)
    const current = next.chapters.find(chapter => chapter.id === selectedId) ?? next.chapters[0]
    setSelectedId(current.id)
    if (editor && editor.getHTML() !== current.html) editor.commands.setContent(current.html, { emitUpdate: false })
    setReview(null)
    setError('')
    setView('edit')
    setNotice('章节已更新')
  }

  function addVolume() {
    const volume = createVolume(book.volumes.length + 1)
    updateBook(previous => ({ ...previous, volumes: [...previous.volumes, volume] }))
    setVolumeSettingsId(volume.id)
    setNotice('已添加卷，可设置卷首图与独立样式')
  }

  function saveVolume(next: Volume) {
    updateBook(previous => ({ ...previous, volumes: previous.volumes.map(volume => volume.id === next.id ? next : volume) }))
    setVolumeSettingsId(null)
    setNotice(`卷设置已更新：${next.title}`)
  }

  function deleteVolume(volume: Volume) {
    if (!window.confirm(`删除“${volume.title}”？卷内章节会变为未分卷，正文不会丢失。`)) return
    updateBook(previous => ({
      ...previous,
      volumes: previous.volumes.filter(item => item.id !== volume.id),
      chapters: previous.chapters.map(chapter => chapter.volumeId === volume.id ? { ...chapter, volumeId: null } : chapter),
    }))
    setVolumeSettingsId(null)
    setCollapsedVolumeIds(previous => previous.filter(id => id !== volume.id))
    setNotice('卷已删除，其章节回到未分卷')
  }

  function assignVolume(volumeId: string | null) {
    updateBook(previous => ({
      ...previous,
      chapters: previous.chapters.map(chapter => chapter.id === selectedId ? { ...chapter, volumeId } : chapter),
    }))
  }

  async function pickVolumeImage() {
    const path = await open({ multiple: false, filters: imageFilters })
    if (typeof path !== 'string') return null
    try {
      return await invoke<string>('read_image', { path })
    } catch (cause) {
      setError(errorMessage(cause))
      return null
    }
  }

  async function importFile() {
    if (!canReplace()) return
    const path = await open({ multiple: false, filters: [{ name: '图书', extensions: ['txt', 'epub'] }] })
    if (typeof path !== 'string') return
    await withBusy(async () => {
      const next = await invoke<Project>('import_book', { path })
      openReview('import', next, path.toLowerCase().endsWith('.txt') ? path : undefined)
      setNotice(`已识别 ${next.chapters.length} 个章节，核对后确认导入`)
    })
  }

  async function openProject() {
    if (!canReplace()) return
    const path = await open({ multiple: false, filters: [{ name: 'EPUB Studio 项目', extensions: ['json'] }] })
    if (typeof path !== 'string') return
    await withBusy(async () => {
      const next = await invoke<Project>('load_project', { path })
      const created = await invoke<WorkspaceSummary>('create_workspace', { book: next })
      replaceBook(next, created.id, '项目文件已导入为新工程')
    })
  }

  async function saveProject() {
    if (workspaceId === null) return
    await withBusy(async () => {
      await invoke('save_workspace', { id: workspaceId, book })
      setDirty(false)
      setNotice('工程已保存')
    })
  }

  async function saveProjectFile() {
    const path = await save({ defaultPath: `${safeName(book.title)}.epubstudio.json`, filters: [{ name: 'EPUB Studio 项目', extensions: ['json'] }] })
    if (!path) return
    await withBusy(async () => {
      await invoke('save_project', { path, book })
      setNotice(`项目文件已导出：${path}`)
    })
  }

  async function createWorkspace(details: { title: string; author: string; language: string }) {
    await withBusy(async () => {
      const next = createEmptyProject()
      next.title = details.title.trim()
      next.author = details.author.trim() || '未知作者'
      next.language = details.language.trim() || 'zh-CN'
      const created = await invoke<WorkspaceSummary>('create_workspace', { book: next })
      replaceBook(next, created.id, '工程已创建')
    })
  }

  async function openWorkspace(id: number) {
    if (!canReplace()) return
    await withBusy(async () => replaceBook(await invoke<Project>('load_workspace', { id }), id, '工程已打开'))
  }

  async function deleteWorkspace(id: number) {
    await withBusy(async () => {
      await invoke('delete_workspace', { id })
      setWorkspaces(await invoke<WorkspaceSummary[]>('list_workspaces'))
      setNotice('工程已删除')
    })
  }

  async function goHome() {
    if (!canReplace()) return
    await withBusy(async () => {
      setWorkspaces(await invoke<WorkspaceSummary[]>('list_workspaces'))
      setScreen('home')
      setWorkspaceId(null)
      setDirty(false)
    })
  }

  async function exportBook() {
    const path = await save({ defaultPath: `${safeName(book.title)}.epub`, filters: [{ name: 'EPUB 电子书', extensions: ['epub'] }] })
    if (!path) return
    await withBusy(async () => {
      await invoke('export_epub', { path, book })
      setNotice(`EPUB 已导出：${path}`)
    })
  }

  async function chooseImage(target: 'coverImage' | 'openingImage' | 'closingImage' | 'inline') {
    const path = await open({ multiple: false, filters: imageFilters })
    if (typeof path !== 'string') return
    await withBusy(async () => {
      const source = await invoke<string>('read_image', { path })
      if (target === 'inline') editor?.chain().focus().setImage({ src: source, alt: '章节插图' }).run()
      else updateBook(previous => ({ ...previous, [target]: source }))
      setNotice('图片已添加')
    })
  }

  async function loadLibraryAssets() {
    const [font, image] = await Promise.all([
      invoke<AssetSummary[]>('list_assets', { kind: 'font' }),
      invoke<AssetSummary[]>('list_assets', { kind: 'image' }),
    ])
    setAssetsByKind({ font, image })
  }

  async function importLibraryAsset() {
    const path = await open({ multiple: false, filters: assetKind === 'font' ? fontFilters : imageFilters })
    if (typeof path !== 'string') return
    await withBusy(async () => {
      await invoke<AssetSummary>('import_asset', { path, kind: assetKind })
      await loadLibraryAssets()
      setNotice(`${assetKind === 'font' ? '字体' : '图片'}已导入资源库`)
    })
  }

  async function useFont(asset: AssetSummary, target: 'title' | 'body' | 'selection') {
    await withBusy(async () => {
      const data = await invoke<AssetData>('get_asset', { id: asset.id })
      const family = `EPUBStudioFont${asset.id}`
      updateBook(previous => ({
        ...previous,
        fontAssets: previous.fontAssets.some(font => font.family === family) ? previous.fontAssets : [...previous.fontAssets, { family, name: data.name, mime: data.mime, dataUri: data.dataUri }],
        style: target === 'selection' ? previous.style : { ...previous.style, [target === 'title' ? 'titleFontFamily' : 'bodyFontFamily']: family },
      }))
      if (target === 'selection') editor?.chain().focus().setFontFamily(family).run()
      setNotice('字体已应用到书稿')
    })
  }

  async function useLibraryImage(asset: AssetSummary, target: 'coverImage' | 'openingImage' | 'closingImage' | 'inline') {
    await withBusy(async () => {
      const data = await invoke<AssetData>('get_asset', { id: asset.id })
      if (target === 'inline') { setView('edit'); editor?.chain().focus().setImage({ src: data.dataUri, alt: asset.name }).run() }
      else updateBook(previous => ({ ...previous, [target]: data.dataUri }))
      setNotice('图片已添加到书稿')
    })
  }

  async function deleteLibraryAsset(asset: AssetSummary) {
    if (!window.confirm(`从资源库删除“${asset.name}”？已加入书稿的内容仍会保留。`)) return
    await withBusy(async () => {
      await invoke('delete_asset', { id: asset.id })
      if (previewAsset?.id === asset.id) setPreviewAsset(null)
      await loadLibraryAssets()
      setNotice('资源已从库中删除')
    })
  }

  async function showAssetPreview(asset: AssetSummary) {
    await withBusy(async () => setPreviewAsset(await invoke<AssetData>('get_asset', { id: asset.id })))
  }

  function addChapter() {
    const id = crypto.randomUUID()
    updateBook(previous => ({ ...previous, chapters: [...previous.chapters, { id, title: `第${previous.chapters.length + 1}章`, html: '<p></p>' }] }))
    setSelectedId(id)
    setView('edit')
  }

  function deleteChapter() {
    if (book.chapters.length === 1 || !window.confirm(`删除“${selectedChapter.title}”？`)) return
    const next = reindexChapterLinks(book.chapters, book.chapters.filter(chapter => chapter.id !== selectedId))
    updateBook(previous => ({ ...previous, chapters: next }))
    setSelectedId(next[Math.min(selectedIndex, next.length - 1)].id)
  }

  function moveChapter(direction: -1 | 1) {
    const target = selectedIndex + direction
    if (target < 0 || target >= book.chapters.length) return
    const chapters = [...book.chapters]
    ;[chapters[selectedIndex], chapters[target]] = [chapters[target], chapters[selectedIndex]]
    const next = reindexChapterLinks(book.chapters, chapters)
    updateBook(previous => ({ ...previous, chapters: next }))
    const current = next.find(chapter => chapter.id === selectedId)
    if (current && editor?.getHTML() !== current.html) editor?.commands.setContent(current.html, { emitUpdate: false })
  }

  function handlePreviewClick(event: MouseEvent<HTMLDivElement>) {
    const link = event.target instanceof Element ? event.target.closest('a[href]') : null
    const href = link?.getAttribute('href')
    if (!href) return
    event.preventDefault()
    const match = /^(?:chapter-(\d+)\.xhtml)?(?:#(.+))?$/.exec(href)
    if (!match) { setNotice('外部链接可在导出的 EPUB 中打开'); return }
    const article = match[1] ? document.getElementById(`preview-chapter-${match[1]}`) : link?.closest('.preview-paper')
    const target = match[2] ? article?.querySelector(`#${CSS.escape(match[2])}`) : article
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void saveProject()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  const selectedStyle = previewStyles(chapterStyle(book, selectedChapter)) as CSSProperties
  const availableFonts = [...fontChoices, ...(book.fontAssets ?? []).map(font => ({ value: font.family, label: font.name }))]
  const embeddedFontCss = (book.fontAssets ?? []).filter(font => /^EPUBStudioFont\d+$/.test(font.family) && /^font\/(ttf|otf|woff|woff2)$/.test(font.mime) && new RegExp(`^data:${font.mime};base64,[A-Za-z0-9+/=]+$`).test(font.dataUri)).map(font => `@font-face{font-family:'${font.family}';src:url('${font.dataUri}')}`).join('\n') + (previewAsset?.kind === 'font' ? `@font-face{font-family:'EPUBStudioFont${previewAsset.id}';src:url('${previewAsset.dataUri}')}` : '')

  const reviewDialog = review ? <ChapterReview
    key={reviewKey}
    mode={review.mode}
    chapters={review.book.chapters}
    volumes={review.book.volumes ?? []}
    sourcePath={review.sourcePath}
    onRedetect={async (chapterPattern, volumePattern) => {
      if (!review.sourcePath) throw new Error('未找到 TXT 源文件')
      const next = await invoke<Project>('redetect_txt', { path: review.sourcePath, chapterPattern, volumePattern })
      setReview(previous => previous ? { ...previous, book: next } : previous)
      return next
    }}
    bookTitle={review.book.title}
    busy={busy}
    error={error}
    onCancel={() => setReview(null)}
    onConfirm={confirmReview}
  /> : null

  if (screen === 'home') return <>
    <Home
      workspaces={workspaces}
      busy={busy}
      error={error}
      notice={notice}
      onCreate={createWorkspace}
      onOpen={openWorkspace}
      onDelete={deleteWorkspace}
      onImportBook={importFile}
      onImportProject={openProject}
    />
    {reviewDialog}
  </>

  return <div className="app-shell">
    <style>{embeddedFontCss}</style>
    <header className="topbar">
      <div className="brand"><div className="brand-icon"><BookOpen size={22} strokeWidth={2.3} /></div><div><strong>EPUB Studio</strong><span>电子书编辑器</span></div></div>
      <div className="document-state"><span className="document-name">{book.title}</span><span className={dirty ? 'state-dot dirty' : 'state-dot'} />{dirty ? '未保存' : '已保存'}</div>
      <div className="top-actions">
        <button className="button subtle" disabled={busy} onClick={goHome}><House size={17}/>工程列表</button>
        <span className="divider" />
        <button className="button subtle" disabled={busy} onClick={saveProjectFile}><FolderOpen size={17}/>导出项目文件</button>
        <button className="button outline" disabled={busy || !dirty} onClick={saveProject}><Save size={17}/>保存工程</button>
        <button className="button primary" disabled={busy} onClick={exportBook}><Download size={17}/>导出 EPUB</button>
      </div>
    </header>

    <div className="workspace">
      <aside className="sidebar" aria-label="章节列表">
        <div className="panel-heading"><div><span className="eyebrow">内容导航</span><h2>章节目录 <small>{book.chapters.length}</small></h2></div><div className="heading-actions"><button className="icon-button" title="新建卷" aria-label="新建卷" onClick={addVolume}><Layers size={18}/></button><button className="icon-button" title="章节整理与批量替换" aria-label="章节整理与批量替换" onClick={() => openReview('manage', book)}><ListTree size={18}/></button><button className="icon-button add" title="添加章节" aria-label="添加章节" onClick={addChapter}><Plus size={20}/></button></div></div>
        <div className="chapter-list">
          {groups.map((group, groupIndex) => {
            const groupKey = group.volume?.id ?? group.chapters[0]?.id ?? 'loose'
            const collapsed = group.volume ? collapsedVolumeIds.includes(group.volume.id) : false
            const listId = group.volume ? `volume-chapters-${group.volume.id}-${groupIndex}` : undefined
            return <div className={`chapter-group ${collapsed ? 'collapsed' : ''}`} key={`${groupKey}-${groupIndex}`}>
              {group.volume && <div className="volume-row">
                <button className="volume-toggle" aria-expanded={!collapsed} aria-controls={listId} aria-label={`${collapsed ? '展开' : '折叠'}${group.volume.title}`} title={collapsed ? '展开本卷' : '折叠本卷'} onClick={() => toggleVolume(group.volume!.id)}>
                  <ChevronRight size={14}/>
                </button>
                <button className="volume-item" onClick={() => setVolumeSettingsId(group.volume!.id)} title={`${group.volume.title} · 卷设置`}>
                  <Layers size={14}/><span className="volume-name">{group.volume.title}</span><span className="volume-count">{group.chapters.length}</span>
                </button>
              </div>}
              {!collapsed && <div className="chapter-group-items" id={listId}>
                {group.chapters.map(chapter => {
                  const index = chapterIndex.get(chapter.id) ?? 0
                  return <button key={chapter.id} className={`chapter-item ${group.volume ? 'in-volume' : ''} ${selectedId === chapter.id ? 'active' : ''}`} onClick={() => selectChapter(chapter.id)}>
                    <span className="chapter-number">{String(index + 1).padStart(2, '0')}</span>
                    <span className="chapter-label">{chapter.title || `章节 ${index + 1}`}</span>
                  </button>
                })}
              </div>}
            </div>
          })}
        </div>
        <div className="sidebar-footer"><span>选中章节</span><div><button title="上移章节" aria-label="上移章节" disabled={selectedIndex <= 0} onClick={() => moveChapter(-1)}><ChevronUp size={17}/></button><button title="下移章节" aria-label="下移章节" disabled={selectedIndex >= book.chapters.length - 1} onClick={() => moveChapter(1)}><ChevronDown size={17}/></button><button title="删除章节" aria-label="删除章节" disabled={book.chapters.length === 1} onClick={deleteChapter}><Trash2 size={16}/></button></div></div>
      </aside>

      <main className="main-panel">
        <div className="main-heading"><div><span className="eyebrow">书稿工作区</span><h1>{view === 'edit' ? '章节编辑' : '整书预览'}</h1></div><div className="view-switch" role="group" aria-label="视图切换"><button className={view === 'edit' ? 'selected' : ''} onClick={() => setView('edit')}>编辑</button><button className={view === 'preview' ? 'selected' : ''} onClick={() => setView('preview')}>预览</button></div></div>
        {view === 'edit' ? <>
          <div className="chapter-volume-bar">
            <span className="chapter-volume-label"><Layers size={14}/>所属卷</span>
            <select value={selectedChapter.volumeId ?? ''} onChange={event => assignVolume(event.target.value || null)} aria-label="章节所属卷">
              <option value="">未分卷</option>
              {book.volumes.map(volume => <option key={volume.id} value={volume.id}>{volume.title}</option>)}
            </select>
            {currentVolume && <button className="button subtle" onClick={() => setVolumeSettingsId(currentVolume.id)}><Settings2 size={15}/>卷设置</button>}
          </div>
          <div className="chapter-title-field"><label htmlFor="chapter-title">章节标题</label><input id="chapter-title" value={selectedChapter.title} onChange={event => updateBook(previous => ({ ...previous, chapters: previous.chapters.map(chapter => chapter.id === selectedId ? { ...chapter, title: event.target.value } : chapter) }))} /></div>
          <div className="editor-toolbar" aria-label="文字格式工具栏">
            <button title="撤销" aria-label="撤销" onClick={() => editor?.chain().focus().undo().run()}><Undo2 size={17}/></button><button title="重做" aria-label="重做" onClick={() => editor?.chain().focus().redo().run()}><Redo2 size={17}/></button><span className="toolbar-divider"/>
            <select aria-label="段落样式" defaultValue="paragraph" onChange={event => { const value = event.target.value; if (value === 'paragraph') editor?.chain().focus().setParagraph().run(); else editor?.chain().focus().toggleHeading({ level: Number(value) as 1 | 2 | 3 }).run() }}><option value="paragraph">正文段落</option><option value="1">一级标题</option><option value="2">二级标题</option><option value="3">三级标题</option></select>
            <select aria-label="所选文字字体" defaultValue="" onChange={event => { if (event.target.value) editor?.chain().focus().setFontFamily(event.target.value).run() }}><option value="">局部字体</option>{availableFonts.map(font => <option key={font.value} value={font.value}>{font.label}</option>)}</select>
            <select aria-label="所选文字字号" defaultValue="" onChange={event => { if (event.target.value) editor?.chain().focus().setFontSize(`${event.target.value}px`).run() }}><option value="">字号</option>{[12, 14, 16, 18, 20, 24, 28, 32, 40].map(size => <option key={size} value={size}>{size}</option>)}</select>
            <span className="toolbar-divider"/><button title="加粗" aria-label="加粗" onClick={() => editor?.chain().focus().toggleBold().run()}><Bold size={17}/></button><button title="斜体" aria-label="斜体" onClick={() => editor?.chain().focus().toggleItalic().run()}><Italic size={17}/></button><label className="color-picker" title="所选文字颜色"><span>A</span><input type="color" aria-label="所选文字颜色" onChange={event => editor?.chain().focus().setColor(event.target.value).run()}/></label>
            <span className="toolbar-divider"/><button title="左对齐" aria-label="左对齐" onClick={() => editor?.chain().focus().setTextAlign('left').run()}><AlignLeft size={17}/></button><button title="居中" aria-label="居中" onClick={() => editor?.chain().focus().setTextAlign('center').run()}><AlignCenter size={17}/></button><button title="右对齐" aria-label="右对齐" onClick={() => editor?.chain().focus().setTextAlign('right').run()}><AlignRight size={17}/></button><button title="两端对齐" aria-label="两端对齐" onClick={() => editor?.chain().focus().setTextAlign('justify').run()}><AlignJustify size={17}/></button>
            <span className="toolbar-divider"/><button title="无序列表" aria-label="无序列表" onClick={() => editor?.chain().focus().toggleBulletList().run()}><List size={17}/></button><button title="有序列表" aria-label="有序列表" onClick={() => editor?.chain().focus().toggleOrderedList().run()}><ListOrdered size={17}/></button><button title="在光标处插入图片" aria-label="在光标处插入图片" onClick={() => chooseImage('inline')}><ImagePlus size={18}/></button>
          </div>
          <div className="editor-scroll" ref={editorScrollRef}><div className="paper edit-paper" style={selectedStyle}><h1 className="paper-chapter-title">{selectedChapter.title || '未命名章节'}</h1>{book.openingImage && <img className="boundary-image" src={book.openingImage} alt="章节开头"/>}<EditorContent editor={editor} className="chapter-editor" />{book.closingImage && <img className="boundary-image" src={book.closingImage} alt="章节末尾"/>}</div></div>
        </> : <div className="preview-scroll" onClick={handlePreviewClick}>
          <div className="preview-note">预览按当前统一样式显示整本书，卷的字体与图片设置也会生效。导出后阅读器可能使用自己的字体设置。</div>
          {groups.map(group => {
            const volumeStyle = group.volume ? previewStyles(resolveStyle(book.style, group.volume.style)) as CSSProperties : undefined
            return <Fragment key={group.volume?.id ?? group.chapters[0]?.id ?? 'empty'}>
              {group.volume && <article className="paper preview-paper volume-paper" style={volumeStyle}>
                <h1 className="paper-chapter-title">{group.volume.title}</h1>
                {group.volume.openingImage && <img className="boundary-image" src={group.volume.openingImage} alt="卷首图"/>}
              </article>}
              {group.chapters.map(chapter => {
                const index = chapterIndex.get(chapter.id) ?? 0
                const last = group.chapters[group.chapters.length - 1].id === chapter.id
                return <article className="paper preview-paper" id={`preview-chapter-${index + 1}`} style={previewStyles(chapterStyle(book, chapter)) as CSSProperties} key={chapter.id}>
                  <h1 className="paper-chapter-title" id={chapter.titleId ?? undefined}>{chapter.title}</h1>
                  {book.openingImage && <img className="boundary-image" src={book.openingImage} alt="章节开头"/>}
                  <div className="preview-content" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(chapter.html, { USE_PROFILES: { html: true } }) }}/>
                  {book.closingImage && <img className="boundary-image" src={book.closingImage} alt="章节末尾"/>}
                  {group.volume?.closingImage && last && <img className="boundary-image" src={group.volume.closingImage} alt="卷尾图"/>}
                </article>
              })}
            </Fragment>
          })}
        </div>}
      </main>

      <aside className="settings-panel" aria-label="图书设置与资源库"><div className="settings-inner"><div className="settings-tabs" role="tablist" aria-label="侧边栏"><button role="tab" aria-selected={settingsTab === 'settings'} className={settingsTab === 'settings' ? 'active' : ''} onClick={() => setSettingsTab('settings')}>图书设置</button><button role="tab" aria-selected={settingsTab === 'library'} className={settingsTab === 'library' ? 'active' : ''} onClick={() => setSettingsTab('library')}><LibraryBig size={15}/>资源库</button></div>{settingsTab === 'settings' ? <><div className="panel-heading"><div><span className="eyebrow">统一管理</span><h2>图书设置</h2></div></div>
        <section className="setting-section"><h3>基本信息</h3><label>书名<input value={book.title} onChange={event => updateBook(previous => ({ ...previous, title: event.target.value }))}/></label><label>作者<input value={book.author} onChange={event => updateBook(previous => ({ ...previous, author: event.target.value }))}/></label><label>语言<input value={book.language} onChange={event => updateBook(previous => ({ ...previous, language: event.target.value }))}/></label></section>
        <section className="setting-section"><h3>图书封面</h3><p className="setting-help">创建工程时可留空，保存后会显示在工程书架，并写入 EPUB。</p>{book.coverImage ? <div className="cover-slot"><img src={book.coverImage} alt="图书封面预览"/><div><button className="button outline" onClick={() => chooseImage('coverImage')}>更换封面</button><button className="button subtle" onClick={() => updateBook(previous => ({ ...previous, coverImage: null }))}>移除</button></div></div> : <button className="image-add" onClick={() => chooseImage('coverImage')}><ImagePlus size={17}/>上传封面</button>}</section>
        <section className="setting-section"><h3>章节标题</h3><label>字体<select value={book.style.titleFontFamily} onChange={event => setStyle('titleFontFamily', event.target.value)}>{availableFonts.map(font => <option key={font.value} value={font.value}>{font.label}</option>)}</select></label><div className="field-row"><label>字号<input type="number" min="16" max="72" value={book.style.titleFontSize} onChange={event => setStyle('titleFontSize', Number(event.target.value))}/></label><label>对齐<select value={book.style.titleAlign} onChange={event => setStyle('titleAlign', event.target.value)}><option value="left">左对齐</option><option value="center">居中</option><option value="right">右对齐</option></select></label></div></section>
        <section className="setting-section"><h3>正文</h3><label>字体<select value={book.style.bodyFontFamily} onChange={event => setStyle('bodyFontFamily', event.target.value)}>{availableFonts.map(font => <option key={font.value} value={font.value}>{font.label}</option>)}</select></label><div className="field-row"><label>字号<input type="number" min="10" max="48" value={book.style.bodyFontSize} onChange={event => setStyle('bodyFontSize', Number(event.target.value))}/></label><label>行距<input type="number" min="1.2" max="3" step="0.1" value={book.style.bodyLineHeight} onChange={event => setStyle('bodyLineHeight', Number(event.target.value))}/></label></div><label>对齐<select value={book.style.bodyAlign} onChange={event => setStyle('bodyAlign', event.target.value)}><option value="left">左对齐</option><option value="center">居中</option><option value="right">右对齐</option><option value="justify">两端对齐</option></select></label></section>
        <section className="setting-section"><h3>每章图片</h3><p className="setting-help">统一应用在每个章节的开头或末尾。</p>{(['openingImage', 'closingImage'] as const).map((target) => <div className="image-slot" key={target}><span>{target === 'openingImage' ? '章节开头' : '章节末尾'}</span>{book[target] ? <div className="image-slot-preview"><img src={book[target]!} alt={target === 'openingImage' ? '章节开头图片' : '章节末尾图片'}/><button title="移除图片" aria-label="移除图片" onClick={() => updateBook(previous => ({ ...previous, [target]: null }))}><X size={16}/></button></div> : <button className="image-add" onClick={() => chooseImage(target)}><ImagePlus size={17}/>选择图片</button>}</div>)}</section>
      </> : <LibraryPanel
          kind={assetKind}
          assets={assets}
          counts={{ font: assetsByKind.font.length, image: assetsByKind.image.length }}
          previewAsset={previewAsset}
          busy={busy}
          editing={view === 'edit'}
          onKindChange={next => { setPreviewAsset(null); setAssetKind(next) }}
          onImport={() => void importLibraryAsset()}
          onDelete={asset => void deleteLibraryAsset(asset)}
          onPreview={asset => void showAssetPreview(asset)}
          onClosePreview={() => setPreviewAsset(null)}
          onUseFont={(asset, target) => void useFont(asset, target)}
          onUseImage={(asset, target) => void useLibraryImage(asset, target)}
        />}</div></aside>
    </div>
    <footer className="statusbar"><span className={error ? 'status-error' : ''}>{error || notice}</span><span>{busy ? '处理中…' : `${book.chapters.length} 章 · ${view === 'edit' ? '编辑模式' : '预览模式'}`}</span></footer>
    {editingVolume && <VolumeSettings
      volume={editingVolume}
      baseStyle={book.style}
      availableFonts={availableFonts}
      chapterCount={book.chapters.filter(chapter => chapter.volumeId === editingVolume.id).length}
      busy={busy}
      error={error}
      onPickImage={pickVolumeImage}
      onCancel={() => setVolumeSettingsId(null)}
      onSave={saveVolume}
      onDelete={deleteVolume}
    />}
    {reviewDialog}
  </div>
}
