export interface BookStyle {
  titleFontFamily: string
  titleFontSize: number
  titleAlign: string
  bodyFontFamily: string
  bodyFontSize: number
  bodyLineHeight: number
  bodyAlign: string
}

export interface EditableChapter {
  id: string
  title: string
  titleId?: string | null
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
      bodyFontFamily: 'serif', bodyFontSize: 18, bodyLineHeight: 1.8, bodyAlign: 'justify',
    },
    coverImage: null,
    openingImage: null,
    closingImage: null,
    fontAssets: [],
    chapters: [{ id: crypto.randomUUID(), title: '第一章', html: '<p></p>' }],
  }
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
