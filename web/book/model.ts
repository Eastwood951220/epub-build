export interface BookStyle {
  titleFontFamily: string
  titleFontSize: number
  titleAlign: string
  bodyFontFamily: string
  bodyFontSize: number
  bodyLineHeight: number
  bodyParagraphSpacing: number
  chapterBodySpacing: number
  chapterBackgroundSize?: string
  chapterNumberBackgroundSize?: string
  chapterNameBackgroundSize?: string
  bodyAlign: string
  bodyFirstLineIndent: boolean
  noteFontFamily?: string
  noteFontSize?: number
  noteColor?: string
  noteMarkerSize?: number
  noteMarkerColor?: string
  noteDetailImageSize?: number
  noteBox?: NoteBoxStyle
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

/** Presentation of the bordered tip box; a zero border width hides the frame. */
export interface NoteBoxStyle {
  borderColor?: string
  borderWidth?: number
  borderStyle?: string
  cornerRadius?: number
  backgroundColor?: string
  backgroundImage?: string | null
  backgroundSize?: string
  titleBackground?: string
  titleColor?: string
  showTitle?: boolean
  defaultTitle?: string
  textColor?: string
}

export const NOTE_BOX_DEFAULTS: Required<NoteBoxStyle> = {
  borderColor: '#b38971',
  borderWidth: 1.5,
  borderStyle: 'solid',
  cornerRadius: 22,
  backgroundColor: '',
  backgroundImage: null,
  backgroundSize: 'cover',
  titleBackground: '#ffffff',
  titleColor: '#b38971',
  showTitle: true,
  defaultTitle: '小贴士',
  textColor: '#a8795f',
}

/** Merges a stored (possibly partial) tip box style with the defaults. */
export function noteBoxStyle(style: BookStyle | NoteBoxStyle | undefined): Required<NoteBoxStyle> {
  const source = (style && 'noteBox' in style ? style.noteBox : style) as NoteBoxStyle | undefined
  return { ...NOTE_BOX_DEFAULTS, ...(source ?? {}) }
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
  titleFontFamily?: string | null
  titleFontSize?: number | null
  titleAlign?: string | null
  bodyFontFamily?: string | null
  bodyFontSize?: number | null
  bodyLineHeight?: number | null
  bodyAlign?: string | null
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
  /** Shared decorative background for chapter pages. */
  chapterBackgroundImage?: string | null
  chapterNumberBackgroundImage?: string | null
  chapterNameBackgroundImage?: string | null
  /** Shared inline note and note-detail icons, embedded for portable projects. */
  noteMarkerImage?: string | null
  noteDetailImage?: string | null
  fontAssets: EmbeddedFont[]
  /** Original EPUB stylesheets and their referenced files, kept for editing and export. */
  sourceStylesheets?: SourceStylesheet[]
  sourceStyleAssets?: SourceStyleAsset[]
  volumes: Volume[]
  chapters: EditableChapter[]
}

export interface EmbeddedFont {
  family: string
  name: string
  mime: string
  dataUri: string
}

export interface SourceStylesheet { path: string; css: string }
export interface SourceStyleAsset { path: string; mime: string; dataUri: string }

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
      bodyFontFamily: 'serif', bodyFontSize: 18, bodyLineHeight: 1.8, bodyParagraphSpacing: 0.9, chapterBodySpacing: 46, bodyAlign: 'justify', bodyFirstLineIndent: false,
      chapterBackgroundSize: 'cover',
      chapterNumberBackgroundSize: '50% 70%',
      chapterNameBackgroundSize: 'contain',
      noteFontFamily: 'serif', noteFontSize: 14, noteColor: '#526963', noteMarkerSize: 12, noteMarkerColor: '#0b8578', noteDetailImageSize: 12,
    },
    coverImage: null,
    chapterImages: [],
    chapterBackgroundImage: null,
    chapterNumberBackgroundImage: null,
    chapterNameBackgroundImage: null,
    noteMarkerImage: null,
    noteDetailImage: null,
    fontAssets: [],
    sourceStylesheets: [],
    sourceStyleAssets: [],
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

export function chapterBackgroundStyle(book: Pick<Project, 'chapterBackgroundImage' | 'style'>): Record<string, string> {
  if (!book.chapterBackgroundImage) return {}
  const size = book.style.chapterBackgroundSize
  return {
    backgroundImage: `url("${book.chapterBackgroundImage}")`,
    backgroundSize: size === 'contain' || size === '100% 100%' || size === '100% auto' ? size : 'cover',
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'center top',
  }
}

export function chapterNumberBackgroundStyle(book: Pick<Project, 'chapterNumberBackgroundImage' | 'style'>): Record<string, string> {
  if (!book.chapterNumberBackgroundImage) return {}
  const size = book.style.chapterNumberBackgroundSize
  return {
    '--chapter-number-bg-image': `url("${book.chapterNumberBackgroundImage}")`,
    '--chapter-number-bg-size': ['50% 70%', 'contain', 'cover', '100% 100%'].includes(size ?? '') ? size! : '50% 70%',
  }
}

export function chapterNameBackgroundStyle(book: Pick<Project, 'chapterNameBackgroundImage' | 'style'>): Record<string, string> {
  if (!book.chapterNameBackgroundImage) return {}
  const size = book.style.chapterNameBackgroundSize
  return {
    '--chapter-name-bg-image': `url("${book.chapterNameBackgroundImage}")`,
    '--chapter-name-bg-size': ['contain', 'cover', '50% 70%', '100% 100%'].includes(size ?? '') ? size! : 'contain',
  }
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
    ...(overrides.titleFontFamily != null ? { fontFamily: overrides.titleFontFamily } : {}),
    ...(overrides.titleFontSize != null ? { fontSize: overrides.titleFontSize } : {}),
    ...(overrides.titleAlign != null ? { align: overrides.titleAlign } : {}),
  })
  return {
    titleFontFamily: overrides.titleFontFamily ?? base.titleFontFamily,
    titleFontSize: overrides.titleFontSize ?? base.titleFontSize,
    titleAlign: overrides.titleAlign ?? base.titleAlign,
    bodyFontFamily: overrides.bodyFontFamily ?? base.bodyFontFamily,
    bodyFontSize: overrides.bodyFontSize ?? base.bodyFontSize,
    bodyLineHeight: overrides.bodyLineHeight ?? base.bodyLineHeight,
    bodyParagraphSpacing: base.bodyParagraphSpacing ?? 0.9,
    chapterBodySpacing: base.chapterBodySpacing ?? 46,
    chapterBackgroundSize: base.chapterBackgroundSize ?? 'cover',
    chapterNumberBackgroundSize: base.chapterNumberBackgroundSize ?? '50% 70%',
    chapterNameBackgroundSize: base.chapterNameBackgroundSize ?? 'contain',
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
    noteDetailImageSize: base.noteDetailImageSize,
    noteBox: base.noteBox,
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
    if (/^EPUBStudio(?:Library)?Font\d+$/.test(name)) return `'${name}', serif`
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
    '--body-paragraph-spacing': `${Math.min(3, Math.max(0, style.bodyParagraphSpacing ?? 0.9))}em`,
    '--chapter-body-spacing': `${Math.min(160, Math.max(0, style.chapterBodySpacing ?? 46))}px`,
    '--body-align': style.bodyAlign,
    '--body-indent': style.bodyFirstLineIndent ? '2em' : '0',
    '--note-font': fontStack(style.noteFontFamily ?? style.bodyFontFamily),
    '--note-size': `${style.noteFontSize ?? 14}px`,
    '--note-color': style.noteColor ?? '#526963',
    '--note-marker-size': `${style.noteMarkerSize ?? 12}px`,
    '--note-marker-color': style.noteMarkerColor ?? '#0b8578',
    '--note-detail-image-size': `${Math.min(32, Math.max(8, style.noteDetailImageSize ?? 12))}px`,
    ...noteBoxVars(style),
    ...lineStyle('chapter-number', style.chapterNumberStyle, true),
    ...lineStyle('chapter-name', style.chapterNameStyle, false),
    ...lineStyle('volume-number', style.volumeNumberStyle, true),
    ...lineStyle('volume-name', style.volumeNameStyle, false),
  }
}

/** CSS variables driving the tip box frame, fill and text. */
export function noteBoxVars(style: BookStyle | NoteBoxStyle | undefined): Record<string, string> {
  const box = noteBoxStyle(style)
  const width = Math.min(8, Math.max(0, box.borderWidth))
  const line = ['dashed', 'dotted', 'double', 'none'].includes(box.borderStyle) ? box.borderStyle : 'solid'
  return {
    '--note-box-border': width <= 0 || line === 'none' ? 'none' : `${width}px ${line} ${box.borderColor}`,
    '--note-box-radius': `0 ${Math.min(60, Math.max(0, box.cornerRadius))}px 0 ${Math.min(60, Math.max(0, box.cornerRadius))}px`,
    '--note-box-bg-color': box.backgroundColor || 'transparent',
    '--note-box-bg-image': box.backgroundImage ? `url("${box.backgroundImage}")` : 'none',
    '--note-box-bg-size': ['contain', 'auto', '100% 100%'].includes(box.backgroundSize) ? box.backgroundSize : 'cover',
    '--note-box-title-bg': box.titleBackground === box.borderColor ? '#ffffff' : box.titleBackground,
    '--note-box-title-color': box.borderColor,
    '--note-box-title-display': box.showTitle ? 'table' : 'none',
    '--note-box-title-columns': box.showTitle ? 'max-content minmax(0,1fr)' : '0 minmax(0,1fr)',
    '--note-box-title-gap': box.showTitle ? '.65em' : '0',
    '--note-box-text-color': box.textColor,
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
