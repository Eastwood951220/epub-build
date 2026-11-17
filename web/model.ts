export interface BookStyle {
  titleFontFamily: string
  titleFontSize: number
  titleAlign: string
  bodyFontFamily: string
  bodyFontSize: number
  bodyLineHeight: number
  bodyAlign: string
  bodyFirstLineIndent: boolean
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
  /** Per-volume overrides; an empty object inherits the book style. */
  style: VolumeStyle
  openingImage: string | null
  closingImage: string | null
}

export interface EditableChapter {
  id: string
  title: string
  titleId?: string | null
  volumeId?: string | null
  html: string
}

export interface Project {
  version: number
  title: string
  author: string
  language: string
  style: BookStyle
  coverImage: string | null
  openingImage: string | null
  closingImage: string | null
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
    },
    coverImage: null,
    openingImage: null,
    closingImage: null,
    fontAssets: [],
    volumes: [],
    chapters: [{ id: crypto.randomUUID(), title: '第一章', html: '<p></p>' }],
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
  return {
    titleFontFamily: overrides.titleFontFamily ?? base.titleFontFamily,
    titleFontSize: overrides.titleFontSize ?? base.titleFontSize,
    titleAlign: overrides.titleAlign ?? base.titleAlign,
    bodyFontFamily: overrides.bodyFontFamily ?? base.bodyFontFamily,
    bodyFontSize: overrides.bodyFontSize ?? base.bodyFontSize,
    bodyLineHeight: overrides.bodyLineHeight ?? base.bodyLineHeight,
    bodyAlign: overrides.bodyAlign ?? base.bodyAlign,
    bodyFirstLineIndent: base.bodyFirstLineIndent ?? false,
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
  return {
    '--title-font': fontStack(style.titleFontFamily),
    '--title-size': `${style.titleFontSize}px`,
    '--title-align': style.titleAlign,
    '--body-font': fontStack(style.bodyFontFamily),
    '--body-size': `${style.bodyFontSize}px`,
    '--body-line-height': String(style.bodyLineHeight),
    '--body-align': style.bodyAlign,
    '--body-indent': style.bodyFirstLineIndent ? '2em' : '0',
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
