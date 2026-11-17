import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { ChevronDown, ChevronRight, ChevronUp, Layers, Pencil, Settings2, Trash2 } from 'lucide-react'
import type { ChapterGroup, EditableChapter, Volume } from './model'
import { visibleRows } from './editorLayout'

const ROW_HEIGHT = 46
type Row = { kind: 'volume'; volume: Volume; count: number; collapsed: boolean; key: string }
  | { kind: 'chapter'; chapter: EditableChapter; index: number; inVolume: boolean; key: string }

interface Props {
  groups: ChapterGroup[]
  collapsedVolumeIds: string[]
  selectedId: string
  chapterCount: number
  onSelectChapter: (id: string) => void
  onToggleVolume: (id: string) => void
  onVolumeSettings: (id: string) => void
  onEditTitle: (id: string) => void
  onMoveChapter: (direction: -1 | 1, id: string) => void
  onDeleteChapter: (id: string) => void
}

export default function ChapterSidebarList(props: Props) {
  const { groups, collapsedVolumeIds, selectedId, chapterCount } = props
  const scrollRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(600)
  const [menu, setMenu] = useState<{ row: Row; x: number; y: number } | null>(null)

  const rows = useMemo(() => {
    const result: Row[] = []
    let index = 0
    for (const group of groups) {
      const collapsed = !!group.volume && collapsedVolumeIds.includes(group.volume.id)
      if (group.volume) result.push({ kind: 'volume', volume: group.volume, count: group.chapters.length, collapsed, key: `volume-${group.volume.id}-${index}` })
      for (const chapter of group.chapters) {
        if (!collapsed) result.push({ kind: 'chapter', chapter, index, inVolume: !!group.volume, key: chapter.id })
        index += 1
      }
    }
    return result
  }, [groups, collapsedVolumeIds])

  useLayoutEffect(() => {
    const node = scrollRef.current
    if (!node) return
    const observer = new ResizeObserver(() => setViewportHeight(node.clientHeight))
    observer.observe(node)
    setViewportHeight(node.clientHeight)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!menu) return
    const close = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenu(null) }
    const escape = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') setMenu(null) }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', escape)
    menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape) }
  }, [menu])

  const { start, end } = visibleRows(scrollTop, viewportHeight, rows.length, ROW_HEIGHT)
  const openMenu = (row: Row, x: number, y: number) => setMenu({ row, x: Math.min(x, window.innerWidth - 194), y: Math.min(y, window.innerHeight - 210) })
  const onContext = (event: MouseEvent<HTMLElement>, row: Row) => { event.preventDefault(); openMenu(row, event.clientX, event.clientY) }
  const onMenuKey = (event: KeyboardEvent<HTMLElement>, row: Row) => {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
    event.preventDefault()
    const rect = event.currentTarget.getBoundingClientRect()
    openMenu(row, rect.left + 20, rect.top + 20)
  }
  const action = (run: () => void) => { setMenu(null); run() }
  const navigateMenu = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
    const current = items.indexOf(document.activeElement as HTMLButtonElement)
    const next = (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    items[next]?.focus()
  }

  return <>
    <div className="chapter-list" ref={scrollRef} onScroll={event => { setScrollTop(event.currentTarget.scrollTop); setMenu(null) }} aria-label="章节目录">
      <div className="chapter-list-canvas" style={{ height: rows.length * ROW_HEIGHT }}>
        {rows.slice(start, end).map((row, offset) => <div className="chapter-list-row" key={row.key} style={{ top: (start + offset) * ROW_HEIGHT }}>
          {row.kind === 'volume' ? <div className="volume-row" onContextMenu={event => onContext(event, row)} onKeyDown={event => onMenuKey(event, row)}>
            <button className="volume-toggle" aria-expanded={!row.collapsed} aria-label={`${row.collapsed ? '展开' : '折叠'}${row.volume.title}`} title={row.collapsed ? '展开本卷' : '折叠本卷'} onClick={() => props.onToggleVolume(row.volume.id)}><ChevronRight size={14}/></button>
            <button className="volume-item" onClick={() => props.onVolumeSettings(row.volume.id)} title={`${row.volume.title} · 卷设置`}><Layers size={14}/><span className="volume-name">{row.volume.title}</span><span className="volume-count">{row.count}</span></button>
          </div> : <button className={`chapter-item ${row.inVolume ? 'in-volume' : ''} ${selectedId === row.chapter.id ? 'active' : ''}`} aria-current={selectedId === row.chapter.id ? 'true' : undefined} onClick={() => props.onSelectChapter(row.chapter.id)} onContextMenu={event => onContext(event, row)} onKeyDown={event => onMenuKey(event, row)}>
            <span className="chapter-number">{String(row.index + 1).padStart(2, '0')}</span><span className="chapter-label">{row.chapter.title || `章节 ${row.index + 1}`}</span>
          </button>}
        </div>)}
      </div>
    </div>
    {menu && <div className="chapter-context-menu" ref={menuRef} role="menu" aria-label={menu.row.kind === 'volume' ? menu.row.volume.title : menu.row.chapter.title} onKeyDown={navigateMenu} style={{ left: menu.x, top: menu.y }}>
      {menu.row.kind === 'volume' ? <>
        <button role="menuitem" onClick={() => action(() => props.onVolumeSettings(menu.row.kind === 'volume' ? menu.row.volume.id : ''))}><Settings2 size={15}/>卷设置</button>
        <button role="menuitem" onClick={() => action(() => props.onToggleVolume(menu.row.kind === 'volume' ? menu.row.volume.id : ''))}>{menu.row.collapsed ? <ChevronRight size={15}/> : <ChevronDown size={15}/>} {menu.row.collapsed ? '展开本卷' : '折叠本卷'}</button>
      </> : <>
        <button role="menuitem" onClick={() => action(() => props.onEditTitle(menu.row.kind === 'chapter' ? menu.row.chapter.id : ''))}><Pencil size={15}/>编辑标题</button>
        <button role="menuitem" disabled={menu.row.index === 0} onClick={() => action(() => props.onMoveChapter(-1, menu.row.kind === 'chapter' ? menu.row.chapter.id : ''))}><ChevronUp size={15}/>上移</button>
        <button role="menuitem" disabled={menu.row.index === chapterCount - 1} onClick={() => action(() => props.onMoveChapter(1, menu.row.kind === 'chapter' ? menu.row.chapter.id : ''))}><ChevronDown size={15}/>下移</button>
        <button role="menuitem" className="danger" disabled={chapterCount <= 1} onClick={() => action(() => props.onDeleteChapter(menu.row.kind === 'chapter' ? menu.row.chapter.id : ''))}><Trash2 size={15}/>删除章节</button>
      </>}
    </div>}
  </>
}
