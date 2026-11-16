import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react'
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
  ChevronUp, Download, FilePlus2, FolderOpen, ImagePlus, Italic, List,
  ListOrdered, Plus, Redo2, Save, Trash2, Undo2, X,
  LibraryBig,
} from 'lucide-react'
import { createEmptyProject, fontChoices, previewStyles, reindexChapterLinks, type BookStyle, type Project } from './model'
import { PreserveIds } from './PreserveIds'

type View = 'edit' | 'preview'
type AssetKind = 'font' | 'image'
interface AssetSummary { id: number; kind: AssetKind; name: string; mime: string; size: number }
interface AssetData { id: number; kind: AssetKind; name: string; mime: string; dataUri: string }
const imageFilters = [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'svg'] }]
const fontFilters = [{ name: '字体', extensions: ['ttf', 'otf', 'woff', 'woff2'] }]

function errorMessage(error: unknown) { return error instanceof Error ? error.message : String(error) }
function safeName(name: string) { return name.replace(/[\\/:*?"<>|]/g, '_').trim() || '未命名图书' }

export default function App() {
  const [book, setBook] = useState<Project>(createEmptyProject)
  const [selectedId, setSelectedId] = useState(book.chapters[0].id)
  const [view, setView] = useState<View>('edit')
  const [settingsTab, setSettingsTab] = useState<'settings' | 'library'>('settings')
  const [assetKind, setAssetKind] = useState<AssetKind>('font')
  const [assets, setAssets] = useState<AssetSummary[]>([])
  const [previewAsset, setPreviewAsset] = useState<AssetData | null>(null)
  const [projectPath, setProjectPath] = useState<string | null>(null)
  const [dirty, setDirty] = useState(true)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('准备就绪')
  const [error, setError] = useState('')
  const selectedIdRef = useRef(selectedId)
  const bookRef = useRef(book)
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

  useEffect(() => {
    if (settingsTab !== 'library') return
    setPreviewAsset(null)
    void invoke<AssetSummary[]>('list_assets', { kind: assetKind }).then(setAssets).catch(cause => setError(errorMessage(cause)))
  }, [settingsTab, assetKind])

  const selectedChapter = book.chapters.find(item => item.id === selectedId) ?? book.chapters[0]
  const selectedIndex = book.chapters.findIndex(item => item.id === selectedId)

  function updateBook(next: (previous: Project) => Project) {
    setBook(next)
    setDirty(true)
  }

  function setStyle<K extends keyof BookStyle>(key: K, value: BookStyle[K]) {
    updateBook(previous => ({ ...previous, style: { ...previous.style, [key]: value } }))
  }

  function replaceBook(next: Project, path: string | null, message: string) {
    next = { ...next, fontAssets: next.fontAssets ?? [] }
    editor?.commands.setContent(next.chapters[0].html, { emitUpdate: false })
    setBook(next)
    setSelectedId(next.chapters[0].id)
    setProjectPath(path)
    setDirty(false)
    setView('edit')
    setError('')
    setNotice(message)
  }

  function canReplace() { return !dirty || window.confirm('当前修改尚未保存，确定继续吗？') }

  async function withBusy(action: () => Promise<void>) {
    setBusy(true)
    setError('')
    try { await action() } catch (cause) { setError(errorMessage(cause)) } finally { setBusy(false) }
  }

  async function importFile() {
    if (!canReplace()) return
    const path = await open({ multiple: false, filters: [{ name: '图书', extensions: ['txt', 'epub'] }] })
    if (typeof path !== 'string') return
    await withBusy(async () => {
      const next = await invoke<Project>('import_book', { path })
      replaceBook(next, null, `已导入 ${next.chapters.length} 个章节。请保存项目以保留编辑。`)
      setDirty(true)
    })
  }

  async function openProject() {
    if (!canReplace()) return
    const path = await open({ multiple: false, filters: [{ name: 'EPUB Studio 项目', extensions: ['json'] }] })
    if (typeof path !== 'string') return
    await withBusy(async () => replaceBook(await invoke<Project>('load_project', { path }), path, '项目已打开'))
  }

  async function saveProject() {
    let path = projectPath
    if (!path) path = await save({ defaultPath: `${safeName(book.title)}.epubstudio.json`, filters: [{ name: 'EPUB Studio 项目', extensions: ['json'] }] })
    if (!path) return
    await withBusy(async () => {
      await invoke('save_project', { path, book })
      setProjectPath(path)
      setDirty(false)
      setNotice(`项目已保存：${path}`)
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

  async function chooseImage(target: 'openingImage' | 'closingImage' | 'inline') {
    const path = await open({ multiple: false, filters: imageFilters })
    if (typeof path !== 'string') return
    await withBusy(async () => {
      const source = await invoke<string>('read_image', { path })
      if (target === 'inline') editor?.chain().focus().setImage({ src: source, alt: '章节插图' }).run()
      else updateBook(previous => ({ ...previous, [target]: source }))
      setNotice('图片已添加')
    })
  }

  async function importLibraryAsset() {
    const path = await open({ multiple: false, filters: assetKind === 'font' ? fontFilters : imageFilters })
    if (typeof path !== 'string') return
    await withBusy(async () => {
      await invoke<AssetSummary>('import_asset', { path, kind: assetKind })
      setAssets(await invoke<AssetSummary[]>('list_assets', { kind: assetKind }))
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

  async function useLibraryImage(asset: AssetSummary, target: 'openingImage' | 'closingImage' | 'inline') {
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
      setAssets(await invoke<AssetSummary[]>('list_assets', { kind: assetKind }))
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

  const previewStyle = previewStyles(book.style) as CSSProperties
  const availableFonts = [...fontChoices, ...(book.fontAssets ?? []).map(font => ({ value: font.family, label: font.name }))]
  const embeddedFontCss = (book.fontAssets ?? []).filter(font => /^EPUBStudioFont\d+$/.test(font.family) && /^font\/(ttf|otf|woff|woff2)$/.test(font.mime) && new RegExp(`^data:${font.mime};base64,[A-Za-z0-9+/=]+$`).test(font.dataUri)).map(font => `@font-face{font-family:'${font.family}';src:url('${font.dataUri}')}`).join('\n') + (previewAsset?.kind === 'font' ? `@font-face{font-family:'EPUBStudioFont${previewAsset.id}';src:url('${previewAsset.dataUri}')}` : '')

  return <div className="app-shell">
    <style>{embeddedFontCss}</style>
    <header className="topbar">
      <div className="brand"><div className="brand-icon"><BookOpen size={22} strokeWidth={2.3} /></div><div><strong>EPUB Studio</strong><span>电子书编辑器</span></div></div>
      <div className="document-state"><span className="document-name">{book.title}</span><span className={dirty ? 'state-dot dirty' : 'state-dot'} />{dirty ? '未保存' : '已保存'}</div>
      <div className="top-actions">
        <button className="button subtle" disabled={busy} onClick={importFile}><FilePlus2 size={17}/>导入 TXT / EPUB</button>
        <button className="button subtle" disabled={busy} onClick={openProject}><FolderOpen size={17}/>打开项目</button>
        <span className="divider" />
        <button className="button outline" disabled={busy} onClick={saveProject}><Save size={17}/>保存项目</button>
        <button className="button primary" disabled={busy} onClick={exportBook}><Download size={17}/>导出 EPUB</button>
      </div>
    </header>

    <div className="workspace">
      <aside className="sidebar" aria-label="章节列表">
        <div className="panel-heading"><div><span className="eyebrow">内容导航</span><h2>章节目录 <small>{book.chapters.length}</small></h2></div><button className="icon-button add" title="添加章节" aria-label="添加章节" onClick={addChapter}><Plus size={20}/></button></div>
        <div className="chapter-list">{book.chapters.map((chapter, index) => <button key={chapter.id} className={`chapter-item ${selectedId === chapter.id ? 'active' : ''}`} onClick={() => setSelectedId(chapter.id)}><span className="chapter-number">{String(index + 1).padStart(2, '0')}</span><span className="chapter-label">{chapter.title || `章节 ${index + 1}`}</span></button>)}</div>
        <div className="sidebar-footer"><span>选中章节</span><div><button title="上移章节" aria-label="上移章节" disabled={selectedIndex <= 0} onClick={() => moveChapter(-1)}><ChevronUp size={17}/></button><button title="下移章节" aria-label="下移章节" disabled={selectedIndex >= book.chapters.length - 1} onClick={() => moveChapter(1)}><ChevronDown size={17}/></button><button title="删除章节" aria-label="删除章节" disabled={book.chapters.length === 1} onClick={deleteChapter}><Trash2 size={16}/></button></div></div>
      </aside>

      <main className="main-panel">
        <div className="main-heading"><div><span className="eyebrow">书稿工作区</span><h1>{view === 'edit' ? '章节编辑' : '整书预览'}</h1></div><div className="view-switch" role="group" aria-label="视图切换"><button className={view === 'edit' ? 'selected' : ''} onClick={() => setView('edit')}>编辑</button><button className={view === 'preview' ? 'selected' : ''} onClick={() => setView('preview')}>预览</button></div></div>
        {view === 'edit' ? <>
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
          <div className="editor-scroll"><div className="paper edit-paper" style={previewStyle}><h1 className="paper-chapter-title">{selectedChapter.title || '未命名章节'}</h1>{book.openingImage && <img className="boundary-image" src={book.openingImage} alt="章节开头"/>}<EditorContent editor={editor} className="chapter-editor" />{book.closingImage && <img className="boundary-image" src={book.closingImage} alt="章节末尾"/>}</div></div>
        </> : <div className="preview-scroll" onClick={handlePreviewClick}><div className="preview-note">预览按当前统一样式显示整本书。导出后阅读器可能使用自己的字体设置。</div>{book.chapters.map((chapter, index) => <article className="paper preview-paper" id={`preview-chapter-${index + 1}`} style={previewStyle} key={chapter.id}><h1 className="paper-chapter-title" id={chapter.titleId ?? undefined}>{chapter.title}</h1>{book.openingImage && <img className="boundary-image" src={book.openingImage} alt="章节开头"/>}<div className="preview-content" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(chapter.html, { USE_PROFILES: { html: true } }) }}/>{book.closingImage && <img className="boundary-image" src={book.closingImage} alt="章节末尾"/>}</article>)}</div>}
      </main>

      <aside className="settings-panel" aria-label="图书设置与资源库"><div className="settings-inner"><div className="settings-tabs" role="tablist" aria-label="侧边栏"><button role="tab" aria-selected={settingsTab === 'settings'} className={settingsTab === 'settings' ? 'active' : ''} onClick={() => setSettingsTab('settings')}>图书设置</button><button role="tab" aria-selected={settingsTab === 'library'} className={settingsTab === 'library' ? 'active' : ''} onClick={() => setSettingsTab('library')}><LibraryBig size={15}/>资源库</button></div>{settingsTab === 'settings' ? <><div className="panel-heading"><div><span className="eyebrow">统一管理</span><h2>图书设置</h2></div></div>
        <section className="setting-section"><h3>基本信息</h3><label>书名<input value={book.title} onChange={event => updateBook(previous => ({ ...previous, title: event.target.value }))}/></label><label>作者<input value={book.author} onChange={event => updateBook(previous => ({ ...previous, author: event.target.value }))}/></label><label>语言<input value={book.language} onChange={event => updateBook(previous => ({ ...previous, language: event.target.value }))}/></label></section>
        <section className="setting-section"><h3>章节标题</h3><label>字体<select value={book.style.titleFontFamily} onChange={event => setStyle('titleFontFamily', event.target.value)}>{availableFonts.map(font => <option key={font.value} value={font.value}>{font.label}</option>)}</select></label><div className="field-row"><label>字号<input type="number" min="16" max="72" value={book.style.titleFontSize} onChange={event => setStyle('titleFontSize', Number(event.target.value))}/></label><label>对齐<select value={book.style.titleAlign} onChange={event => setStyle('titleAlign', event.target.value)}><option value="left">左对齐</option><option value="center">居中</option><option value="right">右对齐</option></select></label></div></section>
        <section className="setting-section"><h3>正文</h3><label>字体<select value={book.style.bodyFontFamily} onChange={event => setStyle('bodyFontFamily', event.target.value)}>{availableFonts.map(font => <option key={font.value} value={font.value}>{font.label}</option>)}</select></label><div className="field-row"><label>字号<input type="number" min="10" max="48" value={book.style.bodyFontSize} onChange={event => setStyle('bodyFontSize', Number(event.target.value))}/></label><label>行距<input type="number" min="1.2" max="3" step="0.1" value={book.style.bodyLineHeight} onChange={event => setStyle('bodyLineHeight', Number(event.target.value))}/></label></div><label>对齐<select value={book.style.bodyAlign} onChange={event => setStyle('bodyAlign', event.target.value)}><option value="left">左对齐</option><option value="center">居中</option><option value="right">右对齐</option><option value="justify">两端对齐</option></select></label></section>
        <section className="setting-section"><h3>每章图片</h3><p className="setting-help">统一应用在每个章节的开头或末尾。</p>{(['openingImage', 'closingImage'] as const).map((target) => <div className="image-slot" key={target}><span>{target === 'openingImage' ? '章节开头' : '章节末尾'}</span>{book[target] ? <div className="image-slot-preview"><img src={book[target]!} alt={target === 'openingImage' ? '章节开头图片' : '章节末尾图片'}/><button title="移除图片" aria-label="移除图片" onClick={() => updateBook(previous => ({ ...previous, [target]: null }))}><X size={16}/></button></div> : <button className="image-add" onClick={() => chooseImage(target)}><ImagePlus size={17}/>选择图片</button>}</div>)}</section>
      </> : <div className="library-panel"><div className="panel-heading"><div><span className="eyebrow">本机 SQLite 资源库</span><h2>字体与图片</h2></div></div><div className="library-kind" role="group" aria-label="资源类型"><button className={assetKind === 'font' ? 'active' : ''} onClick={() => setAssetKind('font')}>字体</button><button className={assetKind === 'image' ? 'active' : ''} onClick={() => setAssetKind('image')}>图片</button></div><button className="button primary library-import" disabled={busy} onClick={importLibraryAsset}><Plus size={16}/>导入{assetKind === 'font' ? '字体' : '图片'}</button><p className="setting-help">资源保存在本机。应用到书稿后，项目和导出的 EPUB 会保留所用资源。</p><div className="library-list">{previewAsset && <div className="library-preview"><strong>{previewAsset.name}</strong>{previewAsset.kind === 'image' ? <img src={previewAsset.dataUri} alt={previewAsset.name}/> : <span style={{ fontFamily: `'EPUBStudioFont${previewAsset.id}', serif` }}>字体预览：春江花月夜 ABC 123</span>}</div>}{assets.length === 0 && <p className="library-empty">还没有{assetKind === 'font' ? '字体' : '图片'}，点击上方按钮导入。</p>}{assets.map(asset => <div className="library-item" key={asset.id}><div className="library-item-heading"><strong title={asset.name}>{asset.name}</strong><button title={`删除 ${asset.name}`} aria-label={`删除 ${asset.name}`} onClick={() => deleteLibraryAsset(asset)}><Trash2 size={15}/></button></div><small>{asset.mime} · {(asset.size / 1024).toFixed(1)} KB</small><div className="library-actions"><button onClick={() => showAssetPreview(asset)}>预览</button>{assetKind === 'font' ? <><button onClick={() => useFont(asset, 'title')}>标题</button><button onClick={() => useFont(asset, 'body')}>正文</button><button onClick={() => useFont(asset, 'selection')} disabled={view !== 'edit'}>选中文字</button></> : <><button onClick={() => useLibraryImage(asset, 'openingImage')}>每章开头</button><button onClick={() => useLibraryImage(asset, 'closingImage')}>每章末尾</button><button onClick={() => useLibraryImage(asset, 'inline')} disabled={view !== 'edit'}>光标处</button></>}</div></div>)}</div></div>}</div></aside>
    </div>
    <footer className="statusbar"><span className={error ? 'status-error' : ''}>{error || notice}</span><span>{busy ? '处理中…' : `${book.chapters.length} 章 · ${view === 'edit' ? '编辑模式' : '预览模式'}`}</span></footer>
  </div>
}
