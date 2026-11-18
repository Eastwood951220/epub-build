import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import TextAlign from '@tiptap/extension-text-align'
import { TextStyleKit } from '@tiptap/extension-text-style'
import { backend, type AssetData, type AssetKind, type AssetSummary, type WorkspaceSummary } from './platform/backend'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { open, save } from '@tauri-apps/plugin-dialog'
import {
  BookOpen, ChevronDown, ChevronUp, Download, FolderOpen, House, ImagePlus,
  Layers, Layers2, LibraryBig, ListTree, Plus, Save, Search, Settings2, Trash2,
} from 'lucide-react'
import {
  chapterBackgroundStyle, chapterNameBackgroundStyle, chapterNumberBackgroundStyle, chapterGroups, chapterImagesAt, chapterStyle, chapterVolume, createChapterImage, createEmptyProject, createVolume, fontChoices,
  noteBoxStyle, previewStyles, reindexChapterLinks, type BookStyle, type EditableChapter, type NoteBoxStyle, type Project, type Volume,
} from './book/model'
import { PreserveIds } from './chapters/PreserveIds'
import { NoteMarker } from './chapters/NoteMarker'
import { NoteBox, NoteBoxTitle } from './chapters/NoteBox'
import { orderedNotes } from './chapters/notes'
import ChapterReview from './chapters/ChapterReview'
import FindReplace from './chapters/FindReplaceDialog'
import type { FindReplaceResult } from './chapters/findReplace'
import { AUTOSAVE_INTERVAL_MS, shouldAutosave } from './editor/autosave'
import { imageLinkUrls, replaceImageLinks } from './editor/imageLinks'
import VolumeSettings from './settings/VolumeSettings'
import VolumeBatchDialog from './settings/VolumeBatchDialog'
import ChapterImagesSettings from './settings/ChapterImagesSettings'
import LibraryPanel from './library/LibraryPanel'
import { fontOptions, prepareFontSelection, sharedFontFamily } from './library/fontSelection'
import SettingsDialog from './settings/SettingsDialog'
import Home from './library/Home'
import HeadingTitle from './chapters/HeadingTitle'
import HeadingStyleControls, { type HeadingStyleKey } from './settings/HeadingStyleControls'
import AdvancedSettingsDialog from './settings/AdvancedSettingsDialog'
import HexColorInput from './settings/HexColorInput'
import EditorToolbar from './editor/EditorToolbar'
import ChapterSidebarList from './chapters/ChapterSidebarList'
import BookPreview from './preview/BookPreview'
import {
  clampPanelWidth, initialPanelWidth, LEFT_PANEL_DEFAULT_WIDTH, LEFT_PANEL_MIN_WIDTH,
  RIGHT_PANEL_DEFAULT_WIDTH, RIGHT_PANEL_MIN_WIDTH,
} from './editor/editorLayout'
import { startWindowDrag } from './platform/windowDrag'
import { scanImageBatch } from './editor/chapterImageScan'
import { createSaveQueue } from './editor/saveQueue'
import type { HeadingLineStyle } from './book/model'

type View = 'edit' | 'preview'
interface ReviewState { mode: 'import' | 'manage'; book: Project; sourcePath?: string }
const imageFilters = [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] }]
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
  const [settingsDialog, setSettingsDialog] = useState<'titles' | 'notes' | 'images' | 'background' | null>(null)
  const [appSettingsOpen, setAppSettingsOpen] = useState(false)
  const [assetKind, setAssetKind] = useState<AssetKind>('font')
  const [assetsByKind, setAssetsByKind] = useState<Record<AssetKind, AssetSummary[]>>({ font: [], image: [] })
  const [previewAsset, setPreviewAsset] = useState<AssetData | null>(null)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [chapterLoading, setChapterLoading] = useState(false)
  const [chapterLoadVersion, setChapterLoadVersion] = useState(0)
  const [showEditorImages, setShowEditorImages] = useState(false)
  const [forcedPreviewTarget, setForcedPreviewTarget] = useState<{ chapterId: string; anchor: string } | null>(null)
  const [pendingImageCount, setPendingImageCount] = useState(0)
  const [sidebarWidth, setSidebarWidth] = useState(() => initialPanelWidth(localStorage.getItem('epub-studio-sidebar-width'), 240, LEFT_PANEL_DEFAULT_WIDTH, LEFT_PANEL_MIN_WIDTH))
  const [settingsWidth, setSettingsWidth] = useState(() => initialPanelWidth(localStorage.getItem('epub-studio-settings-width'), 294, RIGHT_PANEL_DEFAULT_WIDTH, RIGHT_PANEL_MIN_WIDTH))
  const [notice, setNotice] = useState('准备就绪')
  const [error, setError] = useState('')
  const [review, setReview] = useState<ReviewState | null>(null)
  const [findReplaceOpen, setFindReplaceOpen] = useState(false)
  const [reviewKey, setReviewKey] = useState(0)
  const [volumeSettingsId, setVolumeSettingsId] = useState<string | null>(null)
  const [volumeBatchOpen, setVolumeBatchOpen] = useState(false)
  const [collapsedVolumeIds, setCollapsedVolumeIds] = useState<string[]>([])
  const selectedIdRef = useRef(selectedId)
  const workspaceIdRef = useRef(workspaceId)
  const bookRef = useRef(book)
  const dirtyRef = useRef(dirty)
  const busyRef = useRef(busy)
  const autosavingRef = useRef(false)
  const editorScrollRef = useRef<HTMLDivElement>(null)
  const previewScrollRef = useRef<HTMLDivElement>(null)
  const workspaceRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ side: 'left' | 'right'; startX: number; initialWidth: number; oppositeWidth: number } | null>(null)
  const imageCountCache = useRef(new Map<string, { html: string; count: number }>())
  const chapterLoadingRef = useRef(false)
  const pendingInlineImageRef = useRef<{ chapterId: string; src: string; alt: string } | null>(null)
  const saveQueueRef = useRef(createSaveQueue())
  selectedIdRef.current = selectedId
  workspaceIdRef.current = workspaceId
  bookRef.current = book
  dirtyRef.current = dirty
  busyRef.current = busy

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, HTMLAttributes: { target: null, rel: null } } }),
      PreserveIds,
      NoteMarker,
      NoteBox,
      NoteBoxTitle,
      TextStyleKit,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Image.configure({ allowBase64: true }),
    ],
    content: book.chapters[0].html,
    onUpdate: ({ editor: current }) => {
      if (chapterLoadingRef.current) return
      const id = selectedIdRef.current
      const html = current.getHTML()
      setBook(previous => ({ ...previous, chapters: previous.chapters.map(chapter => chapter.id === id ? { ...chapter, html } : chapter) }))
      setDirty(true)
    },
  })

  useEffect(() => {
    const chapter = bookRef.current.chapters.find(item => item.id === selectedId)
    if (!editor || editor.isDestroyed || !chapter || screen !== 'editor' || view !== 'edit') return
    let secondFrame = 0
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        if (!editor.isDestroyed) {
          editor.commands.setContent(chapter.html, { emitUpdate: false })
          editor.setEditable(true)
          chapterLoadingRef.current = false
          const pendingImage = pendingInlineImageRef.current
          pendingInlineImageRef.current = null
          if (pendingImage?.chapterId === selectedId) {
            editor.chain().focus().setImage({ src: pendingImage.src, alt: pendingImage.alt }).run()
            setNotice('图片已添加到书稿')
          } else if (pendingImage) setNotice('章节已切换，图片插入已取消')
        }
        setChapterLoading(false)
      })
    })
    return () => { cancelAnimationFrame(firstFrame); cancelAnimationFrame(secondFrame) }
  }, [selectedId, editor, screen, view, chapterLoadVersion])

  function beginChapterLoad(id: string, force = false) {
    if (id === selectedId && !force) return
    chapterLoadingRef.current = true
    editor?.setEditable(false)
    setChapterLoading(true)
    if (force) setChapterLoadVersion(version => version + 1)
    setSelectedId(id)
  }

  function scrollEditorToTop() {
    const node = editorScrollRef.current
    if (node) node.scrollTop = 0
  }

  function scrollPreviewToChapter(id: string) {
    const container = previewScrollRef.current
    const index = bookRef.current.chapters.findIndex(chapter => chapter.id === id)
    const target = index >= 0 ? container?.querySelector<HTMLElement>(`#preview-chapter-${index + 1}`) : null
    if (!container || !target) return
    container.scrollTop += target.getBoundingClientRect().top - container.getBoundingClientRect().top - 24
  }

  function selectChapter(id: string) {
    if (view === 'preview') setSelectedId(id)
    else beginChapterLoad(id)
    if (view === 'preview' && id === selectedId) scrollPreviewToChapter(id)
    else scrollEditorToTop()
  }

  function toggleVolume(volumeId: string) {
    setCollapsedVolumeIds(previous => previous.includes(volumeId) ? previous.filter(id => id !== volumeId) : [...previous, volumeId])
  }

  // 切换章节时正文回到开头；重复点击当前章节也回到开头。
  useEffect(() => {
    scrollEditorToTop()
  }, [selectedId])

  useLayoutEffect(() => {
    if (view === 'preview') scrollPreviewToChapter(selectedId)
  }, [view, selectedId])

  useLayoutEffect(() => {
    if (!forcedPreviewTarget || view !== 'preview') return
    const index = bookRef.current.chapters.findIndex(chapter => chapter.id === forcedPreviewTarget.chapterId)
    const article = index >= 0 ? document.getElementById(`preview-chapter-${index + 1}`) : null
    article?.querySelector(`#${CSS.escape(forcedPreviewTarget.anchor)}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [forcedPreviewTarget, view])

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
    if (screen !== 'editor') return
    let active = true
    void backend.listAssets('font')
      .then(font => { if (active) setAssetsByKind(previous => ({ ...previous, font })) })
      .catch(cause => { if (active) setError(errorMessage(cause)) })
    return () => { active = false }
  }, [screen])

  useEffect(() => {
    void backend.listWorkspaces().then(setWorkspaces).catch(cause => setError(errorMessage(cause)))
  }, [])

  const assets = assetsByKind[assetKind]
  const selectedChapter = book.chapters.find(item => item.id === selectedId) ?? book.chapters[0]
  const selectedIndex = book.chapters.findIndex(item => item.id === selectedId)
  const currentVolume = chapterVolume(book, selectedChapter)
  const groups = useMemo(() => chapterGroups(book.chapters, book.volumes), [book.chapters, book.volumes])
  const chapterIndex = useMemo(() => new Map(book.chapters.map((chapter, index) => [chapter.id, index])), [book.chapters])
  const editingVolume = volumeSettingsId ? book.volumes.find(volume => volume.id === volumeSettingsId) : undefined

  useEffect(() => {
    let cancelled = false
    let cursor = 0
    let total = 0
    let timer = 0
    const scan = () => {
      if (cancelled) return
      const batch = scanImageBatch(book.chapters, imageCountCache.current, cursor, 12)
      cursor = batch.next
      total += batch.count
      if (cursor < book.chapters.length) timer = window.setTimeout(scan, 0)
      else setPendingImageCount(total)
    }
    timer = window.setTimeout(scan, 0)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [book.chapters])

  function updateBook(next: (previous: Project) => Project) {
    setBook(next)
    setDirty(true)
  }

  function setStyle<K extends keyof BookStyle>(key: K, value: BookStyle[K]) {
    updateBook(previous => ({ ...previous, style: { ...previous.style, [key]: value } }))
  }

  function setNoteBox<K extends keyof NoteBoxStyle>(key: K, value: NoteBoxStyle[K]) {
    updateBook(previous => ({ ...previous, style: {
      ...previous.style,
      noteBox: { ...noteBoxStyle(previous.style), [key]: value },
    } }))
  }

  async function chooseNoteBoxBackground() {
    const image = await pickImage()
    if (!image) return
    setNoteBox('backgroundImage', image)
    setNotice('已设置小贴士背景图')
  }

  async function chooseChapterBackground() {
    const image = await pickImage()
    if (!image) return
    updateBook(previous => ({ ...previous, chapterBackgroundImage: image }))
    setNotice('已设置章节背景图')
  }

  async function chooseChapterNumberBackground() {
    const image = await pickImage()
    if (!image) return
    updateBook(previous => ({ ...previous, chapterNumberBackgroundImage: image }))
    setNotice('已设置章节序号背景图')
  }

  async function chooseChapterNameBackground() {
    const image = await pickImage()
    if (!image) return
    updateBook(previous => ({ ...previous, chapterNameBackgroundImage: image }))
    setNotice('已设置章节名称背景图')
  }

  function chooseBookFont(key: 'bodyFontFamily' | 'noteFontFamily', family: string) {
    void applyProjectFontFamilies([family], previous => ({ ...previous, style: { ...previous.style, [key]: family } }))
  }

  function chooseSelectedTextFont(family: string) {
    const chapterId = selectedIdRef.current
    void applyProjectFontFamilies([family], previous => previous).then(applied => {
      if (applied && selectedIdRef.current === chapterId) editor?.chain().focus().setFontFamily(family).run()
    })
  }

  function setHeadingStyle(key: HeadingStyleKey, patch: Partial<HeadingLineStyle>) {
    if (patch.fontFamily) {
      void applyProjectFontFamilies([patch.fontFamily], previous => ({ ...previous, style: {
        ...previous.style, [key]: { ...(previous.style[key] ?? {}), ...patch },
      } }))
      return
    }
    updateBook(previous => ({ ...previous, style: { ...previous.style, [key]: { ...(previous.style[key] ?? {}), ...patch } } }))
  }

  async function applyProjectFontFamilies(families: string[], change: (previous: Project) => Project): Promise<boolean> {
    const projectId = workspaceIdRef.current
    try {
      const attachments = (await Promise.all([...new Set(families)].map(family =>
        prepareFontSelection(family, bookRef.current.fontAssets, assetsByKind.font, backend.getAsset)
      ))).filter(font => font !== null)
      if (workspaceIdRef.current !== projectId) return false
      updateBook(previous => {
        const next = change(previous)
        const existing = new Set(next.fontAssets.map(font => font.family))
        return { ...next, fontAssets: [...next.fontAssets, ...attachments.filter(font => !existing.has(font.family))] }
      })
      return true
    } catch (cause) {
      setError(errorMessage(cause))
      return false
    }
  }

  function replaceBook(next: Project, id: number, message: string) {
    next = { ...next, coverImage: next.coverImage ?? null, chapterImages: next.chapterImages ?? [], fontAssets: next.fontAssets ?? [] }
    imageCountCache.current.clear()
    pendingInlineImageRef.current = null
    beginChapterLoad(next.chapters[0].id, true)
    setBook(next)
    setWorkspaceId(id)
    setVolumeSettingsId(null)
    setFindReplaceOpen(false)
    setForcedPreviewTarget(null)
    setCollapsedVolumeIds([])
    setDirty(false)
    setView('edit')
    setShowEditorImages(false)
    setSettingsTab('settings')
    setScreen('editor')
    setError('')
    setNotice(message)
  }

  function canReplace() { return !dirty || window.confirm('当前修改尚未保存，确定继续吗？') }

  // 关闭入口改由系统标题栏的红绿灯提供，未保存确认必须挂在原生关闭事件上。
  useEffect(() => {
    let stop: (() => void) | undefined
    let disposed = false
    void getCurrentWindow().onCloseRequested(event => { if (!canReplace()) event.preventDefault() })
      .then(unlisten => { if (disposed) unlisten(); else stop = unlisten })
      .catch(cause => setError(errorMessage(cause)))
    return () => { disposed = true; stop?.() }
  }, [dirty])

  async function withBusy(action: () => Promise<void>) {
    busyRef.current = true
    setBusy(true)
    setError('')
    try { await action() } catch (cause) { setError(errorMessage(cause)) } finally { busyRef.current = false; setBusy(false) }
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
        const created = await backend.createWorkspace(next)
        replaceBook(next, created.id, `已导入 ${next.chapters.length} 个章节并创建工程`)
        setReview(null)
      })
      return
    }
    setBook(next)
    setDirty(true)
    const current = next.chapters.find(chapter => chapter.id === selectedId) ?? next.chapters[0]
    beginChapterLoad(current.id, true)
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

  function saveVolumeBatch(next: Volume[]) {
    updateBook(previous => ({ ...previous, volumes: next }))
    setVolumeBatchOpen(false)
    setNotice(`已更新 ${next.length} 个卷标题`)
  }

  async function saveVolume(next: Volume) {
    if (await applyProjectFontFamilies([next.style.titleFontFamily, next.style.bodyFontFamily].filter((family): family is string => !!family),
      previous => ({ ...previous, volumes: previous.volumes.map(volume => volume.id === next.id ? next : volume) }))) {
      setVolumeSettingsId(null)
      setNotice(`卷设置已更新：${next.title}`)
    }
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

  async function pickImage() {
    const path = await open({ multiple: false, filters: imageFilters })
    if (typeof path !== 'string') return null
    try {
      return await backend.readImage(path)
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
      const next = await backend.importBook(path)
      openReview('import', next, path.toLowerCase().endsWith('.txt') ? path : undefined)
      setNotice(`已识别 ${next.chapters.length} 个章节，核对后确认导入`)
    })
  }

  async function openProject() {
    if (!canReplace()) return
    const path = await open({ multiple: false, filters: [{ name: 'EPUB Studio 项目', extensions: ['json'] }] })
    if (typeof path !== 'string') return
    await withBusy(async () => {
      const next = await backend.loadProject(path)
      const created = await backend.createWorkspace(next)
      replaceBook(next, created.id, '项目文件已导入为新工程')
    })
  }

  async function saveProject() {
    if (workspaceId === null) return
    await withBusy(async () => {
      const snapshot = bookRef.current
      await saveQueueRef.current(() => backend.saveWorkspace(workspaceId, snapshot))
      if (bookRef.current === snapshot) setDirty(false)
      setNotice('工程已保存')
    })
  }

  async function saveProjectFile() {
    const path = await save({ defaultPath: `${safeName(book.title)}.epubstudio.json`, filters: [{ name: 'EPUB Studio 项目', extensions: ['json'] }] })
    if (!path) return
    await withBusy(async () => {
      await backend.saveProject(path, book)
      setNotice(`项目文件已导出：${path}`)
    })
  }

  async function createWorkspace(details: { title: string; author: string; language: string }) {
    await withBusy(async () => {
      const next = createEmptyProject()
      next.title = details.title.trim()
      next.author = details.author.trim() || '未知作者'
      next.language = details.language.trim() || 'zh-CN'
      const created = await backend.createWorkspace(next)
      replaceBook(next, created.id, '工程已创建')
    })
  }

  async function openWorkspace(id: number) {
    if (!canReplace()) return
    await withBusy(async () => replaceBook(await backend.loadWorkspace(id), id, '工程已打开'))
  }

  async function deleteWorkspace(id: number) {
    await withBusy(async () => {
      await backend.deleteWorkspace(id)
      setWorkspaces(await backend.listWorkspaces())
      setNotice('工程已删除')
    })
  }

  async function goHome() {
    if (!canReplace()) return
    await withBusy(async () => {
      setWorkspaces(await backend.listWorkspaces())
      setScreen('home')
      setWorkspaceId(null)
      setDirty(false)
    })
  }

  async function exportBook() {
    const path = await save({ defaultPath: `${safeName(book.title)}.epub`, filters: [{ name: 'EPUB 电子书', extensions: ['epub'] }] })
    if (!path) return
    await withBusy(async () => {
      await backend.exportEpub(path, book)
      setNotice(`EPUB 已导出：${path}`)
    })
  }

  async function chooseImage(target: 'coverImage' | 'inline') {
    const path = await open({ multiple: false, filters: imageFilters })
    if (typeof path !== 'string') return
    await withBusy(async () => {
      const source = await backend.readImage(path)
      if (target === 'inline') editor?.chain().focus().setImage({ src: source, alt: '章节插图' }).run()
      else updateBook(previous => ({ ...previous, coverImage: source }))
      setNotice('图片已添加')
    })
  }

  async function chooseNoteImage(target: 'noteMarkerImage' | 'noteDetailImage') {
    const image = await pickImage()
    if (!image) return
    updateBook(previous => ({ ...previous, [target]: image }))
    setNotice(target === 'noteMarkerImage' ? '已设置正文备注标记图片' : '已设置备注明细标记图片')
  }

  function addChapterImage(image: string) {
    updateBook(previous => ({ ...previous, chapterImages: [...previous.chapterImages, createChapterImage(image)] }))
    setNotice('已添加章节图片，默认作用全部章节、位于标题下方')
  }

  async function loadLibraryAssets() {
    const [font, image] = await Promise.all([
      backend.listAssets('font'),
      backend.listAssets('image'),
    ])
    setAssetsByKind({ font, image })
  }

  async function importLibraryAsset() {
    const path = await open({ multiple: false, filters: assetKind === 'font' ? fontFilters : imageFilters })
    if (typeof path !== 'string') return
    await withBusy(async () => {
      await backend.importAsset(path, assetKind)
      await loadLibraryAssets()
      setNotice(`${assetKind === 'font' ? '字体' : '图片'}已导入资源库`)
    })
  }

  async function useFont(asset: AssetSummary, target: 'title' | 'body' | 'selection') {
    await withBusy(async () => {
      const family = sharedFontFamily(asset.id)
      const applied = await applyProjectFontFamilies([family], previous => ({
        ...previous, style: target === 'selection' ? previous.style : { ...previous.style, [target === 'title' ? 'titleFontFamily' : 'bodyFontFamily']: family },
      }))
      if (!applied) return
      if (target === 'selection') editor?.chain().focus().setFontFamily(family).run()
      setNotice('字体已应用到书稿')
    })
  }

  async function useLibraryImage(asset: AssetSummary, target: 'coverImage' | 'chapterImage' | 'inline') {
    await withBusy(async () => {
      const data = await backend.getAsset(asset.id)
      if (target === 'inline') {
        if (view === 'preview') {
          pendingInlineImageRef.current = { chapterId: selectedIdRef.current, src: data.dataUri, alt: asset.name }
          beginChapterLoad(selectedIdRef.current, true)
          setView('edit')
          return
        }
        setView('edit')
        editor?.chain().focus().setImage({ src: data.dataUri, alt: asset.name }).run()
        setNotice('图片已添加到书稿')
      } else if (target === 'chapterImage') {
        addChapterImage(data.dataUri)
      } else {
        updateBook(previous => ({ ...previous, coverImage: data.dataUri }))
        setNotice('图片已添加到书稿')
      }
    })
  }

  async function deleteLibraryAsset(asset: AssetSummary) {
    if (!window.confirm(`从资源库删除“${asset.name}”？已加入书稿的内容仍会保留。`)) return
    await withBusy(async () => {
      await backend.deleteAsset(asset.id)
      if (previewAsset?.id === asset.id) setPreviewAsset(null)
      await loadLibraryAssets()
      setNotice('资源已从库中删除')
    })
  }

  async function showAssetPreview(asset: AssetSummary) {
    await withBusy(async () => setPreviewAsset(await backend.getAsset(asset.id)))
  }

  function addChapter() {
    const id = crypto.randomUUID()
    updateBook(previous => ({ ...previous, chapters: [...previous.chapters, { id, title: `第${previous.chapters.length + 1}章`, html: '<p></p>' }] }))
    beginChapterLoad(id)
    setView('edit')
  }

  function addNote() {
    if (!editor) return
    const id = crypto.randomUUID()
    const number = orderedNotes(selectedChapter).length + 1
    editor.chain().focus().insertContent({ type: 'noteMarker', attrs: { noteId: id, number } }).run()
    updateBook(previous => ({ ...previous, chapters: previous.chapters.map(chapter => chapter.id === selectedId ? { ...chapter, notes: [...(chapter.notes ?? []), { id, text: '' }] } : chapter) }))
    setNotice(`已插入备注标记 [${number}]，请在章末填写内容`)
  }

  function addNoteBox() {
    if (!editor) return
    const box = { type: 'noteBox', content: [
      { type: 'noteBoxTitle', content: [{ type: 'text', text: '小贴士' }] },
      { type: 'paragraph', content: [{ type: 'text', text: '输入备注内容' }] },
    ] }
    // Insert after the block holding the caret so a tap on 小贴士 never nests boxes.
    const { $to } = editor.state.selection
    const at = $to.depth >= 1 ? $to.after(1) : editor.state.doc.content.size
    editor.chain().focus().insertContentAt(at, box).run()
  }

  function updateNote(id: string, text: string) {
    updateBook(previous => ({ ...previous, chapters: previous.chapters.map(chapter => chapter.id === selectedId ? { ...chapter, notes: (chapter.notes ?? []).map(note => note.id === id ? { ...note, text } : note) } : chapter) }))
  }

  function deleteNote(id: string) {
    if (editor) {
      const positions: number[] = []
      editor.state.doc.descendants((node, pos) => { if (node.type.name === 'noteMarker' && node.attrs.noteId === id) positions.push(pos) })
      const chain = editor.chain()
      positions.reverse().forEach(pos => chain.deleteRange({ from: pos, to: pos + 1 }))
      chain.run()
    }
    updateBook(previous => ({ ...previous, chapters: previous.chapters.map(chapter => chapter.id === selectedId ? { ...chapter, notes: (chapter.notes ?? []).filter(note => note.id !== id) } : chapter) }))
  }

  function deleteChapter(chapterId: string = selectedId) {
    const index = book.chapters.findIndex(chapter => chapter.id === chapterId)
    if (index < 0 || book.chapters.length === 1 || !window.confirm(`删除“${book.chapters[index].title}”？`)) return
    const next = reindexChapterLinks(book.chapters, book.chapters.filter(chapter => chapter.id !== chapterId))
    updateBook(previous => ({ ...previous, chapters: next }))
    if (chapterId === selectedId) {
      const nextId = next[Math.min(index, next.length - 1)].id
      if (view === 'preview') setSelectedId(nextId)
      else beginChapterLoad(nextId)
    }
  }

  function moveChapter(direction: -1 | 1, chapterId: string = selectedId) {
    const index = book.chapters.findIndex(chapter => chapter.id === chapterId)
    const target = index + direction
    if (index < 0 || target < 0 || target >= book.chapters.length) return
    const chapters = [...book.chapters]
    ;[chapters[index], chapters[target]] = [chapters[target], chapters[index]]
    const next = reindexChapterLinks(book.chapters, chapters)
    updateBook(previous => ({ ...previous, chapters: next }))
    const current = next.find(chapter => chapter.id === selectedId)
    if (view === 'edit' && current && editor && !editor.isDestroyed && editor.getHTML() !== current.html) editor.commands.setContent(current.html, { emitUpdate: false })
  }

  function editChapterTitle(chapterId: string) {
    beginChapterLoad(chapterId, true)
    setView('edit')
    setForcedPreviewTarget(null)
    requestAnimationFrame(() => document.getElementById('chapter-title')?.focus())
  }

  function handlePreviewClick(event: MouseEvent<HTMLDivElement>) {
    const link = event.target instanceof Element ? event.target.closest('a[href]') : null
    const href = link?.getAttribute('href')
    if (!href) return
    event.preventDefault()
    const match = /^(?:chapter-(\d+)\.xhtml)?(?:#(.+))?$/.exec(href)
    if (!match) { setNotice('外部链接可在导出的 EPUB 中打开'); return }
    if (match[1] && match[2]) {
      const chapter = bookRef.current.chapters[Number(match[1]) - 1]
      if (chapter) { setForcedPreviewTarget({ chapterId: chapter.id, anchor: match[2] }); return }
    }
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

  // 每 30 秒把未保存的改动静默写回工程：不走 withBusy，否则整个界面每半分钟闪一次「处理中」。
  useEffect(() => {
    if (screen !== 'editor' || workspaceId === null) return
    const timer = window.setInterval(() => {
      if (!shouldAutosave({ attached: true, dirty: dirtyRef.current, busy: busyRef.current, saving: autosavingRef.current })) return
      const snapshot = bookRef.current
      autosavingRef.current = true
      void saveQueueRef.current(() => backend.saveWorkspace(workspaceId, snapshot))
        // 保存期间用户又改过稿：新的改动仍然算未保存，下一跳会再存一次。
        .then(() => { if (bookRef.current === snapshot) setDirty(false) })
        .catch(cause => setError(errorMessage(cause)))
        .finally(() => { autosavingRef.current = false })
    }, AUTOSAVE_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [screen, workspaceId])

  useEffect(() => {
    localStorage.setItem('epub-studio-sidebar-width', String(sidebarWidth))
    localStorage.setItem('epub-studio-settings-width', String(settingsWidth))
  }, [sidebarWidth, settingsWidth])

  useEffect(() => {
    const node = workspaceRef.current
    if (!node || screen !== 'editor') return
    const observer = new ResizeObserver(() => {
      setSidebarWidth(previous => clampPanelWidth(previous, node.clientWidth, settingsWidth, LEFT_PANEL_MIN_WIDTH))
      setSettingsWidth(previous => clampPanelWidth(previous, node.clientWidth, sidebarWidth, RIGHT_PANEL_MIN_WIDTH))
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [screen, sidebarWidth, settingsWidth])

  function beginPanelResize(side: 'left' | 'right', event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { side, startX: event.clientX, initialWidth: side === 'left' ? sidebarWidth : settingsWidth, oppositeWidth: side === 'left' ? settingsWidth : sidebarWidth }
  }

  function movePanelResize(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || !workspaceRef.current) return
    const delta = event.clientX - drag.startX
    const width = clampPanelWidth(drag.initialWidth + (drag.side === 'left' ? delta : -delta), workspaceRef.current.clientWidth, drag.oppositeWidth, drag.side === 'left' ? LEFT_PANEL_MIN_WIDTH : RIGHT_PANEL_MIN_WIDTH)
    if (drag.side === 'left') setSidebarWidth(width)
    else setSettingsWidth(width)
  }

  function keyboardPanelResize(side: 'left' | 'right', event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const delta = event.key === 'ArrowRight' ? 20 : -20
    const width = workspaceRef.current?.clientWidth ?? window.innerWidth
    if (side === 'left') setSidebarWidth(current => clampPanelWidth(current + delta, width, settingsWidth, LEFT_PANEL_MIN_WIDTH))
    else setSettingsWidth(current => clampPanelWidth(current - delta, width, sidebarWidth, RIGHT_PANEL_MIN_WIDTH))
  }

  const selectedStyle = previewStyles(chapterStyle(book, selectedChapter)) as CSSProperties
  const noteBox = noteBoxStyle(book.style)
  const availableFonts = fontOptions(fontChoices, book.fontAssets ?? [], assetsByKind.font)
  const embeddedFontCss = (book.fontAssets ?? []).filter(font => /^EPUBStudio(?:Library)?Font\d+$/.test(font.family) && /^font\/(ttf|otf|woff|woff2)$/.test(font.mime) && new RegExp(`^data:${font.mime};base64,[A-Za-z0-9+/=]+$`).test(font.dataUri)).map(font => `@font-face{font-family:'${font.family}';src:url('${font.dataUri}')}`).join('\n') + (previewAsset?.kind === 'font' ? `@font-face{font-family:'${sharedFontFamily(previewAsset.id)}';src:url('${previewAsset.dataUri}')}` : '')

  const reviewDialog = review ? <ChapterReview
    key={reviewKey}
    mode={review.mode}
    chapters={review.book.chapters}
    volumes={review.book.volumes ?? []}
    sourcePath={review.sourcePath}
    onRedetect={async (chapterPattern, volumePattern) => {
      if (!review.sourcePath) throw new Error('未找到 TXT 源文件')
      const next = await backend.redetectTxt(review.sourcePath, chapterPattern, volumePattern)
      setReview(previous => previous ? { ...previous, book: next } : previous)
      return next
    }}
    bookTitle={review.book.title}
    busy={busy}
    error={error}
    onCancel={() => setReview(null)}
    onConfirm={confirmReview}
  /> : null

  function applyFindReplace(result: FindReplaceResult) {
    const selected = result.chapters.find(chapter => chapter.id === selectedId)
    if (selected && editor && !editor.isDestroyed && editor.getHTML() !== selected.html) editor.commands.setContent(selected.html, { emitUpdate: false })
    updateBook(previous => ({ ...previous, chapters: result.chapters, volumes: result.volumes }))
  }

  async function embedBodyImages() {
    const urls = [...new Set(bookRef.current.chapters.flatMap(chapter => imageLinkUrls(chapter.html)))]
    if (urls.length === 0) { setNotice('正文中没有待转换的图片标记'); return }
    setBusy(true)
    setError('')
    const downloaded = new Map<string, string>()
    let failures = 0
    try {
      for (let index = 0; index < urls.length; index += 6) {
        const batch = urls.slice(index, index + 6)
        const results = await Promise.allSettled(batch.map(url => backend.downloadImage(url)))
        results.forEach((result, offset) => {
          if (result.status === 'fulfilled') downloaded.set(batch[offset], result.value)
          else failures += 1
        })
        setNotice(`正在嵌入正文图片 ${Math.min(index + 6, urls.length)}/${urls.length}…`)
      }
      if (downloaded.size > 0) {
        const next = bookRef.current.chapters.map(chapter => {
          const html = replaceImageLinks(chapter.html, downloaded)
          return html === chapter.html ? chapter : { ...chapter, html }
        })
        const selected = next.find(chapter => chapter.id === selectedId)
        if (selected && editor && !editor.isDestroyed && editor.getHTML() !== selected.html) editor.commands.setContent(selected.html, { emitUpdate: false })
        updateBook(previous => ({ ...previous, chapters: next }))
      }
      setNotice(`已嵌入 ${downloaded.size} 张正文图片${failures ? `，${failures} 张下载失败（可重试）` : ''}`)
      if (failures && downloaded.size === 0) setError('图片下载失败，请检查网络或图片链接后重试')
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

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
    {volumeBatchOpen && <VolumeBatchDialog
      volumes={book.volumes}
      chapterCount={id => book.chapters.filter(chapter => chapter.volumeId === id).length}
      busy={busy}
      onCancel={() => setVolumeBatchOpen(false)}
      onSave={saveVolumeBatch}
    />}
    {reviewDialog}
  </>

  return <div className="app-shell">
    <style>{embeddedFontCss}</style>
    <header className="topbar" onMouseDown={startWindowDrag}>
      <div className="brand"><div className="brand-icon"><BookOpen size={22} strokeWidth={2.3} /></div><div><strong>EPUB Studio</strong><span>电子书编辑器</span></div></div>
      <div className="document-state"><span className="document-name">{book.title}</span><span className={dirty ? 'state-dot dirty' : 'state-dot'} />{dirty ? '未保存' : '已保存'}</div>
      <div className="top-actions">
        <button className="button subtle" disabled={busy} onClick={goHome}><House size={17}/>工程列表</button>
        <button className="button subtle" type="button" onClick={() => setAppSettingsOpen(true)}><Settings2 size={17}/>应用设置</button>
        <span className="divider" />
        <button className="button subtle" disabled={busy} onClick={saveProjectFile}><FolderOpen size={17}/>导出项目文件</button>
        <button className="button outline" disabled={busy || !dirty} onClick={saveProject}><Save size={17}/>保存工程</button>
        <button className="button primary" disabled={busy} onClick={exportBook}><Download size={17}/>导出 EPUB</button>
      </div>
    </header>

    <div className="workspace" ref={workspaceRef} style={{ gridTemplateColumns: `${sidebarWidth}px 6px minmax(0,1fr) 6px ${settingsWidth}px` }}>
      <aside className="sidebar" aria-label="章节列表">
        <div className="panel-heading"><div><span className="eyebrow">内容导航</span><h2>章节目录 <small>{book.chapters.length}</small></h2></div><div className="heading-actions"><button className="icon-button" title="新建卷" aria-label="新建卷" onClick={addVolume}><Layers size={18}/></button><button className="icon-button" title="卷批量编辑" aria-label="卷批量编辑" onClick={() => setVolumeBatchOpen(book.volumes.length > 0)} disabled={book.volumes.length === 0}><Layers2 size={18}/></button><button className="icon-button" title="整理章节" aria-label="整理章节" onClick={() => openReview('manage', book)}><ListTree size={18}/></button><button className="icon-button" title="查找替换" aria-label="查找替换" onClick={() => setFindReplaceOpen(true)}><Search size={18}/></button><button className="icon-button add" title="添加章节" aria-label="添加章节" onClick={addChapter}><Plus size={20}/></button></div></div>
        {pendingImageCount > 0 && <button className="sidebar-image-action" disabled={busy} onClick={() => void embedBodyImages()}><ImagePlus size={15}/>嵌入正文图片 <span>{pendingImageCount}</span></button>}
        <ChapterSidebarList
          groups={groups}
          collapsedVolumeIds={collapsedVolumeIds}
          selectedId={selectedId}
          chapterCount={book.chapters.length}
          onSelectChapter={selectChapter}
          onToggleVolume={toggleVolume}
          onVolumeSettings={setVolumeSettingsId}
          onEditTitle={editChapterTitle}
          onMoveChapter={moveChapter}
          onDeleteChapter={deleteChapter}
        />
        <div className="sidebar-footer"><span>选中章节</span><div><button title="上移章节" aria-label="上移章节" disabled={selectedIndex <= 0} onClick={() => moveChapter(-1)}><ChevronUp size={17}/></button><button title="下移章节" aria-label="下移章节" disabled={selectedIndex >= book.chapters.length - 1} onClick={() => moveChapter(1)}><ChevronDown size={17}/></button><button title="删除章节" aria-label="删除章节" disabled={book.chapters.length === 1} onClick={() => deleteChapter()}><Trash2 size={16}/></button></div></div>
      </aside>
      <div className="panel-resizer" role="separator" aria-label="调整章节目录宽度" aria-orientation="vertical" aria-valuemin={LEFT_PANEL_MIN_WIDTH} aria-valuemax={480} aria-valuenow={sidebarWidth} tabIndex={0} onPointerDown={event => beginPanelResize('left', event)} onPointerMove={movePanelResize} onPointerUp={() => { dragRef.current = null }} onPointerCancel={() => { dragRef.current = null }} onKeyDown={event => keyboardPanelResize('left', event)}/>

      <main className="main-panel">
        <div className="main-heading"><div><span className="eyebrow">书稿工作区</span><h1>{view === 'edit' ? '章节编辑' : '整书预览'}</h1></div><div className="view-switch" role="group" aria-label="视图切换"><button className={view === 'edit' ? 'selected' : ''} onClick={() => { if (view === 'preview') { beginChapterLoad(selectedId, true); setForcedPreviewTarget(null) } setView('edit') }}>编辑</button><button className={view === 'preview' ? 'selected' : ''} onClick={() => { chapterLoadingRef.current = false; setChapterLoading(false); setView('preview') }}>预览</button></div></div>
        {view === 'edit' ? <>
          <div className="chapter-volume-bar">
            <span className="chapter-volume-label"><Layers size={14}/>所属卷</span>
            <select value={selectedChapter.volumeId ?? ''} onChange={event => assignVolume(event.target.value || null)} aria-label="章节所属卷">
              <option value="">未分卷</option>
              {book.volumes.map(volume => <option key={volume.id} value={volume.id}>{volume.title}</option>)}
            </select>
            {currentVolume && <button className="button subtle" onClick={() => setVolumeSettingsId(currentVolume.id)}><Settings2 size={15}/>卷设置</button>}
          </div>
          <div className="chapter-title-field"><label htmlFor="chapter-title">章节标题</label><input id="chapter-title" value={selectedChapter.title} onChange={event => updateBook(previous => ({ ...previous, chapters: previous.chapters.map(chapter => chapter.id === selectedId ? { ...chapter, title: event.target.value } : chapter) }))} /><select aria-label="章节标题排列" value={selectedChapter.titleLayout ?? 'stacked'} onChange={event => updateBook(previous => ({ ...previous, chapters: previous.chapters.map(chapter => chapter.id === selectedId ? { ...chapter, titleLayout: event.target.value as 'inline' | 'stacked' } : chapter) }))}><option value="stacked">分两行</option><option value="inline">同一行</option></select></div>
          <EditorToolbar editor={editor} availableFonts={availableFonts} showEditorImages={showEditorImages} onSelectFont={chooseSelectedTextFont} onAddNote={addNote} onAddNoteBox={addNoteBox} onChooseImage={() => void chooseImage('inline')} onToggleImages={() => setShowEditorImages(value => !value)}/>
          <div className={`editor-stage ${showEditorImages ? "" : "images-hidden"}`} aria-busy={chapterLoading}>
          <div className="editor-scroll" ref={editorScrollRef}><div className={`paper edit-paper${book.noteMarkerImage ? ' image-note-markers' : ''}${book.chapterNumberBackgroundImage ? ' has-number-background' : ''}${book.chapterNameBackgroundImage ? ' has-name-background' : ''}`} style={{ ...selectedStyle, ...chapterBackgroundStyle(book), ...chapterNumberBackgroundStyle(book), ...chapterNameBackgroundStyle(book), '--note-marker-image': book.noteMarkerImage ? `url("${book.noteMarkerImage}")` : 'none' } as CSSProperties}>{showEditorImages && chapterImagesAt(book, selectedChapter, 'above').map(image => <img className="boundary-image" src={image.image} alt="章节标题上方图片" key={image.id}/>)}<HeadingTitle title={selectedChapter.title || '未命名章节'} kind="chapter" layout={selectedChapter.titleLayout}/>{showEditorImages && chapterImagesAt(book, selectedChapter, 'below').map(image => <img className="boundary-image" src={image.image} alt="章节标题下方图片" key={image.id}/>)}<EditorContent editor={editor} className="chapter-editor" />{orderedNotes(selectedChapter).length > 0 && <section className="chapter-notes" aria-label="本章备注"><h2>备注</h2>{orderedNotes(selectedChapter).map((note, index) => <div className="note-edit-row" key={note.id}>{book.noteDetailImage ? <img className="note-detail-image" src={book.noteDetailImage} alt={`备注 ${index + 1}`}/> : <span>[{index + 1}]</span>}<textarea aria-label={`备注 ${index + 1}`} placeholder="输入备注内容" value={note.text} onChange={event => updateNote(note.id, event.target.value)}/><button title="删除备注" aria-label={`删除备注 ${index + 1}`} onClick={() => deleteNote(note.id)}><Trash2 size={16}/></button></div>)}</section>}</div></div>
          {chapterLoading && <div className="chapter-loading" role="status"><span className="loading-spinner" aria-hidden="true"/>正在加载章节正文…</div>}
          </div>
        </> : <div className="preview-scroll" ref={previewScrollRef} onClick={handlePreviewClick}>
          <BookPreview book={book} groups={groups} chapterIndex={chapterIndex} scrollRef={previewScrollRef} forcedChapterId={forcedPreviewTarget?.chapterId}/>
        </div>}
      </main>
      <div className="panel-resizer" role="separator" aria-label="调整设置栏宽度" aria-orientation="vertical" aria-valuemin={RIGHT_PANEL_MIN_WIDTH} aria-valuemax={480} aria-valuenow={settingsWidth} tabIndex={0} onPointerDown={event => beginPanelResize('right', event)} onPointerMove={movePanelResize} onPointerUp={() => { dragRef.current = null }} onPointerCancel={() => { dragRef.current = null }} onKeyDown={event => keyboardPanelResize('right', event)}/>

      <aside className="settings-panel" aria-label="图书设置与资源库"><div className="settings-inner"><div className="settings-tabs" role="tablist" aria-label="侧边栏"><button role="tab" aria-selected={settingsTab === 'settings'} className={settingsTab === 'settings' ? 'active' : ''} onClick={() => setSettingsTab('settings')}>图书设置</button><button role="tab" aria-selected={settingsTab === 'library'} className={settingsTab === 'library' ? 'active' : ''} onClick={() => setSettingsTab('library')}><LibraryBig size={15}/>资源库</button></div>{settingsTab === 'settings' ? <><div className="panel-heading"><div><span className="eyebrow">统一管理</span><h2>图书设置</h2></div></div>
        <section className="setting-section"><h3>基本信息</h3><label>书名<input value={book.title} onChange={event => updateBook(previous => ({ ...previous, title: event.target.value }))}/></label><label>作者<input value={book.author} onChange={event => updateBook(previous => ({ ...previous, author: event.target.value }))}/></label><label>语言<input value={book.language} onChange={event => updateBook(previous => ({ ...previous, language: event.target.value }))}/></label></section>
        <section className="setting-section"><h3>图书封面</h3><p className="setting-help">创建工程时可留空，保存后会显示在工程书架，并写入 EPUB。</p>{book.coverImage ? <div className="cover-slot"><img src={book.coverImage} alt="图书封面预览"/><div><button className="button outline" onClick={() => chooseImage('coverImage')}>更换封面</button><button className="button subtle" onClick={() => updateBook(previous => ({ ...previous, coverImage: null }))}>移除</button></div></div> : <button className="image-add" onClick={() => chooseImage('coverImage')}><ImagePlus size={17}/>上传封面</button>}</section>
        <section className="setting-section"><h3>正文</h3><label>字体<select value={book.style.bodyFontFamily} onChange={event => chooseBookFont('bodyFontFamily', event.target.value)}>{availableFonts.map(font => <option key={font.value} value={font.value}>{font.label}</option>)}</select></label><div className="field-row"><label>字号<input type="number" min="10" max="48" value={book.style.bodyFontSize} onChange={event => setStyle('bodyFontSize', Number(event.target.value))}/></label><label>行距<input type="number" min="1.2" max="3" step="0.1" value={book.style.bodyLineHeight} onChange={event => setStyle('bodyLineHeight', Number(event.target.value))}/></label></div><div className="field-row"><label>段落间距（em）<input type="number" min="0" max="3" step="0.1" value={book.style.bodyParagraphSpacing ?? 0.9} onChange={event => setStyle('bodyParagraphSpacing', Number(event.target.value))}/></label><label>章节名距正文（px）<input type="number" min="0" max="160" step="2" value={book.style.chapterBodySpacing ?? 46} onChange={event => setStyle('chapterBodySpacing', Number(event.target.value))}/></label></div><label>对齐<select value={book.style.bodyAlign} onChange={event => setStyle('bodyAlign', event.target.value)}><option value="left">左对齐</option><option value="center">居中</option><option value="right">右对齐</option><option value="justify">两端对齐</option></select></label><label className="setting-checkbox"><input type="checkbox" checked={!!book.style.bodyFirstLineIndent} onChange={event => setStyle('bodyFirstLineIndent', event.target.checked)}/>首行缩进两字（2em）</label></section>
        <section className="setting-section"><h3>详细设置</h3><div className="settings-shortcuts">
          <button type="button" onClick={() => setSettingsDialog('titles')}>标题与卷名<small>4 组样式</small></button>
          <button type="button" onClick={() => setSettingsDialog('notes')}>备注与小贴士<small>标记、图片、边框</small></button>
          <button type="button" onClick={() => setSettingsDialog('images')}>章节插图<small>{book.chapterImages.length} 张</small></button>
          <button type="button" onClick={() => setSettingsDialog('background')}>章节背景<small>{book.chapterBackgroundImage ? '已设置' : '未设置'}</small></button>
        </div></section>
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
    <footer className="statusbar"><span className={error ? 'status-error' : ''}>{error || notice}</span><span>{chapterLoading ? '正在加载章节…' : busy ? '处理中…' : `${book.chapters.length} 章 · ${view === 'edit' ? '编辑模式' : '预览模式'}`}</span></footer>
    {appSettingsOpen && <SettingsDialog onClose={() => setAppSettingsOpen(false)}/>}
    {settingsDialog && <AdvancedSettingsDialog title={{ titles: '标题与卷名', notes: '备注与小贴士', images: '章节插图', background: '章节背景' }[settingsDialog]} onClose={() => setSettingsDialog(null)}>
      {settingsDialog === 'titles' ? <>
        <HeadingStyleControls label="章节序号" styleKey="chapterNumberStyle" style={book.style} fonts={availableFonts} onChange={setHeadingStyle}/>
        <section className="setting-section"><h3>章节序号背景图</h3><p className="setting-help">图片铺在“第 X 章”文字后面，适合竹简、卷轴等装饰。</p>
          {book.chapterNumberBackgroundImage && <img className="chapter-background-preview" src={book.chapterNumberBackgroundImage} alt="章节序号背景预览"/>}
          <div className="note-image-setting"><div><button className="button" type="button" onClick={() => void chooseChapterNumberBackground()}>{book.chapterNumberBackgroundImage ? '更换背景图' : '选择背景图'}</button>{book.chapterNumberBackgroundImage && <button className="button" type="button" onClick={() => updateBook(previous => ({ ...previous, chapterNumberBackgroundImage: null }))}>移除背景</button>}</div></div>
          {book.chapterNumberBackgroundImage && <label>图片尺寸<select value={book.style.chapterNumberBackgroundSize ?? '50% 70%'} onChange={event => setStyle('chapterNumberBackgroundSize', event.target.value)}><option value="50% 70%">样书比例</option><option value="contain">完整显示</option><option value="cover">铺满</option><option value="100% 100%">拉伸铺满</option></select></label>}
        </section>
        <HeadingStyleControls label="章节名称" styleKey="chapterNameStyle" style={book.style} fonts={availableFonts} onChange={setHeadingStyle}/>
        <section className="setting-section"><h3>章节名称背景图</h3><p className="setting-help">图片铺在章节名称文字后面，与序号背景分别设置。</p>
          {book.chapterNameBackgroundImage && <img className="chapter-background-preview" src={book.chapterNameBackgroundImage} alt="章节名称背景预览"/>}
          <div className="note-image-setting"><div><button className="button" type="button" onClick={() => void chooseChapterNameBackground()}>{book.chapterNameBackgroundImage ? '更换背景图' : '选择背景图'}</button>{book.chapterNameBackgroundImage && <button className="button" type="button" onClick={() => updateBook(previous => ({ ...previous, chapterNameBackgroundImage: null }))}>移除背景</button>}</div></div>
          {book.chapterNameBackgroundImage && <label>图片尺寸<select value={book.style.chapterNameBackgroundSize ?? 'contain'} onChange={event => setStyle('chapterNameBackgroundSize', event.target.value)}><option value="contain">完整显示</option><option value="cover">铺满</option><option value="50% 70%">半幅装饰</option><option value="100% 100%">拉伸铺满</option></select></label>}
        </section>
        <HeadingStyleControls label="卷序号" styleKey="volumeNumberStyle" style={book.style} fonts={availableFonts} onChange={setHeadingStyle}/>
        <HeadingStyleControls label="卷名称" styleKey="volumeNameStyle" style={book.style} fonts={availableFonts} onChange={setHeadingStyle}/>
      </> : settingsDialog === 'notes' ? <>
        <section className="setting-section"><h3>备注样式</h3><label>备注字体<select value={book.style.noteFontFamily ?? 'serif'} onChange={event => chooseBookFont('noteFontFamily', event.target.value)}>{availableFonts.map(font => <option key={font.value} value={font.value}>{font.label}</option>)}</select></label><div className="field-row"><label>备注字号<input type="number" min="10" max="32" value={book.style.noteFontSize ?? 14} onChange={event => setStyle('noteFontSize', Number(event.target.value))}/></label><label>备注颜色<HexColorInput label="备注颜色" value={book.style.noteColor ?? '#526963'} onChange={color => setStyle('noteColor', color)}/></label></div><div className="field-row"><label>正文标记大小（px）<input type="number" min="8" max="32" value={book.style.noteMarkerSize ?? 12} onChange={event => setStyle('noteMarkerSize', Number(event.target.value))}/></label>{!book.noteMarkerImage && <label>标记颜色<HexColorInput label="标记颜色" value={book.style.noteMarkerColor ?? '#0b8578'} onChange={color => setStyle('noteMarkerColor', color)}/></label>}</div><div className="field-row"><label>明细图标大小（px）<input type="number" min="8" max="32" value={book.style.noteDetailImageSize ?? 12} onChange={event => setStyle('noteDetailImageSize', Number(event.target.value))}/></label></div>
          <div className="note-image-setting"><span>正文备注标记图片</span><div>{book.noteMarkerImage && <img src={book.noteMarkerImage} alt="正文备注标记图片预览"/>}<button className="button" type="button" onClick={() => void chooseNoteImage('noteMarkerImage')}>{book.noteMarkerImage ? '更换图片' : '选择图片'}</button>{book.noteMarkerImage && <button className="button" type="button" onClick={() => updateBook(previous => ({ ...previous, noteMarkerImage: null }))}>恢复数字</button>}</div></div>
          <div className="note-image-setting"><span>备注明细标记图片</span><div>{book.noteDetailImage && <img src={book.noteDetailImage} alt="备注明细标记图片预览"/>}<button className="button" type="button" onClick={() => void chooseNoteImage('noteDetailImage')}>{book.noteDetailImage ? '更换图片' : '选择图片'}</button>{book.noteDetailImage && <button className="button" type="button" onClick={() => updateBook(previous => ({ ...previous, noteDetailImage: null }))}>恢复数字</button>}</div></div>
          <div className="note-box-setting"><span>小贴士框（带边框的备注区）</span>
            <div className="field-row"><label>边框粗细（px，0 为无边框）<input type="number" min="0" max="8" step="0.5" value={noteBox.borderWidth} onChange={event => setNoteBox('borderWidth', Number(event.target.value))}/></label><label>边框线型<select value={noteBox.borderStyle} onChange={event => setNoteBox('borderStyle', event.target.value)}><option value="solid">实线</option><option value="dashed">虚线</option><option value="dotted">点线</option><option value="double">双线</option><option value="none">无边框</option></select></label></div>
            <div className="field-row"><label>边框颜色<HexColorInput label="小贴士边框颜色" value={noteBox.borderColor} onChange={color => setNoteBox('borderColor', color)}/></label><label>圆角（px）<input type="number" min="0" max="40" value={noteBox.cornerRadius} onChange={event => setNoteBox('cornerRadius', Number(event.target.value))}/></label></div>
            <div className="field-row"><label>标题底色<HexColorInput label="小贴士标题底色" value={noteBox.titleBackground} onChange={color => setNoteBox('titleBackground', color)}/></label><label>标题文字色<HexColorInput label="小贴士标题文字色" value={noteBox.titleColor} onChange={color => setNoteBox('titleColor', color)}/></label></div>
            <div className="field-row"><label>正文颜色<HexColorInput label="小贴士正文颜色" value={noteBox.textColor} onChange={color => setNoteBox('textColor', color)}/></label><label className="setting-checkbox"><input type="checkbox" checked={!!noteBox.backgroundColor} onChange={event => setNoteBox('backgroundColor', event.target.checked ? '#fff8f0' : '')}/>使用背景色</label>{noteBox.backgroundColor && <HexColorInput label="小贴士背景色" value={noteBox.backgroundColor || '#fff8f0'} onChange={color => setNoteBox('backgroundColor', color)}/>}</div>
            <div className="note-image-setting"><span>背景图（可选，与背景色叠加）</span><div>{noteBox.backgroundImage && <img src={noteBox.backgroundImage} alt="小贴士背景图预览"/>}<button className="button" type="button" onClick={() => void chooseNoteBoxBackground()}>{noteBox.backgroundImage ? '更换图片' : '选择图片'}</button>{noteBox.backgroundImage && <button className="button" type="button" onClick={() => setNoteBox('backgroundImage', null)}>移除图片</button>}</div></div>
            {noteBox.backgroundImage && <label>背景图填充方式<select value={noteBox.backgroundSize} onChange={event => setNoteBox('backgroundSize', event.target.value)}><option value="cover">铺满并裁剪</option><option value="contain">完整显示</option><option value="100% 100%">拉伸铺满</option><option value="auto">原始大小</option></select></label>}
          </div>
        </section>
      </> : settingsDialog === 'images' ? <>
        <ChapterImagesSettings
          entries={book.chapterImages}
          chapters={book.chapters}
          volumes={book.volumes}
          selectedChapterId={selectedId}
          busy={busy}
          onPickImage={pickImage}
          onChange={entries => updateBook(previous => ({ ...previous, chapterImages: entries }))}
        />
      </> : <>
        <section className="setting-section"><h3>章节背景</h3><p className="setting-help">背景用于所有章节正文页，编辑、预览与 EPUB 导出保持一致；卷标题页使用卷设置中的图片。</p>
          {book.chapterBackgroundImage && <img className="chapter-background-preview" src={book.chapterBackgroundImage} alt="章节背景预览"/>}
          <div className="note-image-setting"><div><button className="button" type="button" onClick={() => void chooseChapterBackground()}>{book.chapterBackgroundImage ? '更换背景图' : '选择背景图'}</button>{book.chapterBackgroundImage && <button className="button" type="button" onClick={() => updateBook(previous => ({ ...previous, chapterBackgroundImage: null }))}>移除背景</button>}</div></div>
          {book.chapterBackgroundImage && <label>图片铺放方式<select value={book.style.chapterBackgroundSize ?? 'cover'} onChange={event => setStyle('chapterBackgroundSize', event.target.value)}><option value="cover">铺满并裁剪</option><option value="contain">完整显示</option><option value="100% 100%">按页面拉伸</option><option value="100% auto">按页面宽度</option></select></label>}
        </section>
      </>}
    </AdvancedSettingsDialog>}
    {editingVolume && <VolumeSettings
      volume={editingVolume}
      baseStyle={book.style}
      availableFonts={availableFonts}
      chapterCount={book.chapters.filter(chapter => chapter.volumeId === editingVolume.id).length}
      busy={busy}
      error={error}
      onPickImage={pickImage}
      onCancel={() => setVolumeSettingsId(null)}
      onSave={saveVolume}
      onDelete={deleteVolume}
    />}
    {volumeBatchOpen && <VolumeBatchDialog
      volumes={book.volumes}
      chapterCount={id => book.chapters.filter(chapter => chapter.volumeId === id).length}
      busy={busy}
      onCancel={() => setVolumeBatchOpen(false)}
      onSave={saveVolumeBatch}
    />}
    {reviewDialog}
    {findReplaceOpen && <FindReplace chapters={book.chapters} volumes={book.volumes} onClose={() => setFindReplaceOpen(false)} onApply={applyFindReplace}/>}
  </div>
}
