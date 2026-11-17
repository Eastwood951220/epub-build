export interface BookStyle {
  titleFontFamily: string
  titleFontSize: number
  titleAlign: string
  bodyFontFamily: string
  bodyFontSize: number
  bodyLineHeight: number
  bodyAlign: string
  bodyFirstLineIndent: boolean
  noteFontFamily?: string
  noteFontSize?: number
  noteColor?: string
  noteMarkerSize?: number
  noteMarkerColor?: string
  chapterNumberStyle?: HeadingLineStyle
  chapterNameStyle?: HeadingLineStyle
  volumeNumberStyle?: HeadingLineStyle
  volumeNameStyle?: HeadingLineStyle
}

export interface HeadingLineStyle {
  fontFamily?: string
  fontSize?: number
  color?: string
  align?: string
  weight?: number
}

export interface ChapterNote { id: string; text: string }
export type TitleLayout = 'inline' | 'stacked'
/** Where a chapter image sits relative to the chapter title. */
export type ChapterImagePlacement = 'above' | 'below'

export type ChapterImageScope =
  | { type: 'all' }
  | { type: 'chapters'; ids: string[] }
  | { type: 'volumes'; ids: string[] }

export interface ChapterImage {
  id: string
  /** Embedded data URI, so a project file stays portable. */
  image: string
  placement: ChapterImagePlacement
  scope: ChapterImageScope
}

export interface VolumeStyle {
  titleFontFamily?: string
  titleFontSize?: number
  titleAlign?: string
  bodyFontFamily?: string
  bodyFontSize?: number
  bodyLineHeight?: number
  bodyAlign?: string
}

export interface Volume {
  id: string
  title: string
  titleLayout?: TitleLayout
  /** Per-volume overrides; an empty object inherits the book style. */
  style: VolumeStyle
  openingImage: string | null
  closingImage: string | null
}

export interface EditableChapter {
  id: string
  title: string
  titleLayout?: TitleLayout
  titleId?: string | null
  volumeId?: string | null
  html: string
  notes?: ChapterNote[]
}

export interface Project {
  version: number
  title: string
  author: string
  language: string
  style: BookStyle
  coverImage: string | null
  /** Images shown at chapter titles; each entry picks its own chapters or volumes. */
  chapterImages: ChapterImage[]
  fontAssets: EmbeddedFont[]
  volumes: Volume[]
  chapters: EditableChapter[]
}

export interface EmbeddedFont {
  family: string
  name: string
  mime: string
  dataUri: string
}

export const fontChoices = [
  { value: 'serif', label: '衬线字体' },
  { value: 'sans-serif', label: '无衬线字体' },
  { value: 'monospace', label: '等宽字体' },
  { value: 'Songti SC', label: '宋体' },
  { value: 'PingFang SC', label: '苹方' },
  { value: 'Noto Serif CJK SC', label: '思源宋体' },
  { value: 'Noto Sans CJK SC', label: '思源黑体' },
  { value: 'Georgia', label: 'Georgia' },
]

export function createEmptyProject(): Project {
  return {
    version: 1,
    title: '未命名图书',
    author: '未知作者',
    language: 'zh-CN',
    style: {
      titleFontFamily: 'serif', titleFontSize: 30, titleAlign: 'center',
      bodyFontFamily: 'serif', bodyFontSize: 18, bodyLineHeight: 1.8, bodyAlign: 'justify', bodyFirstLineIndent: false,
      noteFontFamily: 'serif', noteFontSize: 14, noteColor: '#526963', noteMarkerSize: 12, noteMarkerColor: '#0b8578',
    },
    coverImage: null,
    chapterImages: [],
    fontAssets: [],
    volumes: [],
    chapters: [{ id: crypto.randomUUID(), title: '第一章', html: '<p></p>' }],
  }
}

/** A newly picked image applies to every chapter until the user narrows it. */
export function createChapterImage(image: string): ChapterImage {
  return { id: crypto.randomUUID(), image, placement: 'below', scope: { type: 'all' } }
}

/** Whether one chapter image entry belongs on the given chapter. */
export function chapterImageApplies(chapter: Pick<EditableChapter, 'id' | 'volumeId'>, entry: ChapterImage): boolean {
  switch (entry.scope.type) {
    case 'all':
      return true
    case 'chapters':
      return entry.scope.ids.includes(chapter.id)
    case 'volumes':
      return chapter.volumeId != null && entry.scope.ids.includes(chapter.volumeId)
  }
}

/** Chapter images in list order, restricted to those scoped to this chapter. */
export function chapterImagesFor(book: Pick<Project, 'chapterImages'>, chapter: Pick<EditableChapter, 'id' | 'volumeId'>): ChapterImage[] {
  return book.chapterImages.filter(entry => chapterImageApplies(chapter, entry))
}

export function chapterImagesAt(book: Pick<Project, 'chapterImages'>, chapter: Pick<EditableChapter, 'id' | 'volumeId'>, placement: ChapterImagePlacement): ChapterImage[] {
  return chapterImagesFor(book, chapter).filter(entry => entry.placement === placement)
}

export function createVolume(index: number): Volume {
  return { id: crypto.randomUUID(), title: `第${index}卷`, style: {}, openingImage: null, closingImage: null }
}

export function volumeOverrideCount(style: VolumeStyle): number {
  return Object.values(style).filter(value => value !== undefined && value !== null && value !== '').length
}

/** Resolves a volume's typography on top of the book-wide style. */
export function resolveStyle(base: BookStyle, overrides: VolumeStyle = {}): BookStyle {
  const resolveLine = (line?: HeadingLineStyle): HeadingLineStyle => ({
    ...line,
    ...(overrides.titleFontFamily !== undefined ? { fontFamily: overrides.titleFontFamily } : {}),
    ...(overrides.titleFontSize !== undefined ? { fontSize: overrides.titleFontSize } : {}),
    ...(overrides.titleAlign !== undefined ? { align: overrides.titleAlign } : {}),
  })
  return {
    titleFontFamily: overrides.titleFontFamily ?? base.titleFontFamily,
    titleFontSize: overrides.titleFontSize ?? base.titleFontSize,
    titleAlign: overrides.titleAlign ?? base.titleAlign,
    bodyFontFamily: overrides.bodyFontFamily ?? base.bodyFontFamily,
    bodyFontSize: overrides.bodyFontSize ?? base.bodyFontSize,
    bodyLineHeight: overrides.bodyLineHeight ?? base.bodyLineHeight,
    bodyAlign: overrides.bodyAlign ?? base.bodyAlign,
    bodyFirstLineIndent: base.bodyFirstLineIndent ?? false,
    chapterNumberStyle: resolveLine(base.chapterNumberStyle),
    chapterNameStyle: resolveLine(base.chapterNameStyle),
    volumeNumberStyle: resolveLine(base.volumeNumberStyle),
    volumeNameStyle: resolveLine(base.volumeNameStyle),
    noteFontFamily: base.noteFontFamily,
    noteFontSize: base.noteFontSize,
    noteColor: base.noteColor,
    noteMarkerSize: base.noteMarkerSize,
    noteMarkerColor: base.noteMarkerColor,
  }
}

export function chapterVolume(book: Pick<Project, 'volumes'>, chapter: Pick<EditableChapter, 'volumeId'>): Volume | undefined {
  return chapter.volumeId ? book.volumes.find(volume => volume.id === chapter.volumeId) : undefined
}

export function chapterStyle(book: Project, chapter: EditableChapter): BookStyle {
  const volume = chapterVolume(book, chapter)
  return volume ? resolveStyle(book.style, volume.style) : book.style
}

export interface ChapterGroup {
  volume?: Volume
  chapters: EditableChapter[]
}

/**
 * Groups consecutive chapters by volume so the sidebar and preview can render
 * volume headings. Volumes without chapters are appended as empty groups.
 */
export function chapterGroups(chapters: EditableChapter[], volumes: Volume[]): ChapterGroup[] {
  const groups: ChapterGroup[] = []
  for (const chapter of chapters) {
    const volume = chapterVolume({ volumes }, chapter)
    const last = groups[groups.length - 1]
    if (last && last.volume?.id === volume?.id) last.chapters.push(chapter)
    else groups.push({ volume, chapters: [chapter] })
  }
  for (const volume of volumes) {
    if (!groups.some(group => group.volume?.id === volume.id)) groups.push({ volume, chapters: [] })
  }
  return groups
}

export function previewStyles(style: BookStyle): Record<string, string> {
  const fontStack = (name: string) => {
    if (name === 'Songti SC' || name === 'Noto Serif CJK SC') return `'${name}', serif`
    if (name === 'PingFang SC' || name === 'Noto Sans CJK SC') return `'${name}', sans-serif`
    if (name === 'Georgia') return 'Georgia, serif'
    if (/^EPUBStudioFont\d+$/.test(name)) return `'${name}', serif`
    return name
  }
  const lineStyle = (prefix: string, line: HeadingLineStyle | undefined, number: boolean) => ({
    [`--${prefix}-font`]: fontStack(line?.fontFamily ?? style.titleFontFamily),
    [`--${prefix}-size`]: `${line?.fontSize ?? (number ? Math.round(style.titleFontSize * 0.65) : style.titleFontSize)}px`,
    [`--${prefix}-color`]: line?.color ?? (number ? '#587670' : '#183e37'),
    [`--${prefix}-align`]: line?.align ?? style.titleAlign,
    [`--${prefix}-weight`]: String(line?.weight ?? (number ? 650 : 700)),
  })
  return {
    '--title-font': fontStack(style.titleFontFamily),
    '--title-size': `${style.titleFontSize}px`,
    '--title-align': style.titleAlign,
    '--body-font': fontStack(style.bodyFontFamily),
    '--body-size': `${style.bodyFontSize}px`,
    '--body-line-height': String(style.bodyLineHeight),
    '--body-align': style.bodyAlign,
    '--body-indent': style.bodyFirstLineIndent ? '2em' : '0',
    '--note-font': fontStack(style.noteFontFamily ?? style.bodyFontFamily),
    '--note-size': `${style.noteFontSize ?? 14}px`,
    '--note-color': style.noteColor ?? '#526963',
    '--note-marker-size': `${style.noteMarkerSize ?? 12}px`,
    '--note-marker-color': style.noteMarkerColor ?? '#0b8578',
    ...lineStyle('chapter-number', style.chapterNumberStyle, true),
    ...lineStyle('chapter-name', style.chapterNameStyle, false),
    ...lineStyle('volume-number', style.volumeNumberStyle, true),
    ...lineStyle('volume-name', style.volumeNameStyle, false),
  }
}

export function reindexChapterLinks(before: EditableChapter[], after: EditableChapter[]): EditableChapter[] {
  return after.map(chapter => ({
    ...chapter,
    html: chapter.html.replace(/href="chapter-(\d+)\.xhtml(#[^"]*)?"/g, (original, number: string, fragment: string | undefined) => {
      const target = before[Number(number) - 1]
      if (!target) return original
      const nextIndex = after.findIndex(item => item.id === target.id)
      return nextIndex < 0 ? 'href="#"' : `href="chapter-${nextIndex + 1}.xhtml${fragment ?? ''}"`
    }),
  }))
}
