import type { EditableChapter, Volume } from '../book/model'

const CHINESE_NUMERALS = '零〇一二三四五六七八九十百千万两'
/** 大写汉字数字，用于「第壹卷」这类编号。 */
const UPPER_CHINESE_NUMERALS = '壹贰叁肆伍陆柒捌玖拾佰仟萬'
const CHAPTER_UNITS = '章节回卷部篇集'
const STANDALONE_HEADINGS = ['序章', '楔子', '引子', '尾声', '后记', '番外', '终章']

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])
const TAG_PATTERN = /<(\/?)([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^'">])*?)(\/?)>/g

/**
 * Chapter heading detection. Keep in sync with `is_chapter_heading` in
 * src/lib.rs so the review dialog can flag the same lines the importer keeps.
 */
export function looksLikeChapterHeading(text: string): boolean {
  const line = text.trim()
  if (!line) return false
  if (line.length <= 80 && /^\d{1,4}、\s*\S/.test(line) && !/[。；;，,]$/.test(line)) return true
  if (line.length > 40) return false
  if (/[。；;，,、]$/.test(line)) return false
  if (line.startsWith('第')) {
    let index = 1
    let number = ''
    while (index < line.length) {
      const char = line[index]
      if ((char >= '0' && char <= '9') || CHINESE_NUMERALS.includes(char) || UPPER_CHINESE_NUMERALS.includes(char)) {
        number += char
        index += 1
      } else break
    }
    if (!number) return false
    const unit = line[index]
    if (!unit || !CHAPTER_UNITS.includes(unit)) return false
    const tail = line.slice(index + 1)
    if (/^[“「『"]/.test(tail.trimStart())) return false
    if (!tail) return true
    if (/^(\s|[、，,：:·•.\-—–~～「『【(《<])/.test(tail)) return true
    return tail.length <= 12 && !/[，。！？；：、,.!?;:]/.test(tail)
  }
  const lower = line.toLowerCase()
  if (lower.startsWith('chapter ')) {
    const number = lower.slice('chapter '.length).trim().split(/\s+/)[0]?.replace(/[:.]$/, '') ?? ''
    return number !== '' && /^[0-9ivxlcdm]+$/.test(number)
  }
  return STANDALONE_HEADINGS.includes(line)
}

/** Splits chapter HTML into its top-level blocks without disturbing nesting. */
export function splitHtmlBlocks(html: string): string[] {
  const blocks: string[] = []
  let depth = 0
  let openStart = -1
  let cursor = 0
  const flushText = (end: number) => {
    const text = html.slice(cursor, end)
    if (text.trim()) blocks.push(text)
    cursor = end
  }
  for (const tag of html.matchAll(TAG_PATTERN)) {
    const index = tag.index ?? 0
    const name = tag[2].toLowerCase()
    const closing = tag[1] === '/'
    const selfClosing = tag[4] === '/' || VOID_TAGS.has(name)
    if (closing) {
      depth = Math.max(0, depth - 1)
      if (depth === 0 && openStart >= 0) {
        blocks.push(html.slice(openStart, index + tag[0].length))
        openStart = -1
        cursor = index + tag[0].length
      }
      continue
    }
    if (depth === 0) flushText(index)
    if (selfClosing) {
      if (depth === 0) {
        blocks.push(html.slice(index, index + tag[0].length))
        cursor = index + tag[0].length
      }
      continue
    }
    if (depth === 0) openStart = index
    depth += 1
  }
  flushText(html.length)
  return blocks
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
  '&#160;': ' ',
}

/** Plain text of a chapter or block, for previews and heading checks. */
export function plainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp|#160);/g, entity => ENTITIES[entity] ?? entity)
    .replace(/&#(\d+);/g, (_, code: string) => {
      const point = Number(code)
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : ''
    })
    .replace(/\s+/g, ' ')
    .trim()
}

export function previewText(html: string, maxLength = 72): string {
  const text = plainText(html)
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text
}

export function blockCount(chapter: EditableChapter): number {
  return splitHtmlBlocks(chapter.html).length
}

export function mergeWithPrevious(chapters: EditableChapter[], index: number): EditableChapter[] {
  if (index <= 0 || index >= chapters.length) return chapters
  const previous = chapters[index - 1]
  const merged: EditableChapter = {
    ...previous,
    html: `${previous.html}${chapters[index].html}`,
  }
  const next = [...chapters]
  next.splice(index - 1, 2, merged)
  return next
}

function headingTitle(block: string): string | null {
  const match = /^<(p|h[1-6])(?:\s[^>]*)?>([\s\S]*)<\/\1\s*>$/i.exec(block.trim())
  if (!match) return null
  const text = plainText(match[2])
  return looksLikeChapterHeading(text) ? text : null
}

function continuationTitle(chapters: EditableChapter[], title: string): string {
  const base = title.trim() || '新章节'
  let candidate = `${base}（续）`
  let counter = 2
  while (chapters.some(chapter => chapter.title === candidate)) {
    candidate = `${base}（续 ${counter}）`
    counter += 1
  }
  return candidate
}

/**
 * Cuts a chapter in two before `blockIndex`. When the block at the cut is a
 * heading-looking paragraph it becomes the new chapter title, so a missed
 * "第二十八章 …" line turns back into a real chapter in one click.
 */
export function splitChapter(chapters: EditableChapter[], index: number, blockIndex: number): EditableChapter[] {
  const chapter = chapters[index]
  if (!chapter) return chapters
  const blocks = splitHtmlBlocks(chapter.html)
  if (blockIndex <= 0 || blockIndex >= blocks.length) return chapters
  const right = blocks.slice(blockIndex)
  const extracted = headingTitle(right[0])
  if (extracted) right.shift()
  const next = [...chapters]
  next[index] = { ...chapter, html: blocks.slice(0, blockIndex).join('') }
  next.splice(index + 1, 0, {
    id: crypto.randomUUID(),
    title: extracted ?? continuationTitle(chapters, chapter.title),
    html: right.join(''),
  })
  return next
}

export function removeChapter(chapters: EditableChapter[], index: number): EditableChapter[] {
  if (chapters.length <= 1 || index < 0 || index >= chapters.length) return chapters
  return chapters.filter((_, position) => position !== index)
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function replaceInValue(value: string, find: string, replacement: string): { value: string; count: number } {
  if (!find) return { value, count: 0 }
  const parts = value.split(find)
  return { value: parts.join(replacement), count: parts.length - 1 }
}

function replaceOutsideTags(html: string, find: string, replacement: string): { value: string; count: number } {
  if (!find) return { value: html, count: 0 }
  const escaped = escapeText(find)
  // A bare "&" would corrupt "&amp;" and friends, so only its escaped form is replaced.
  const allowRaw = find !== '&'
  let count = 0
  const value = html
    .split(/(<[^>]+>)/)
    .map(part => {
      if (part.startsWith('<')) return part
      let text = part
      if (escaped !== find) {
        const encoded = replaceInValue(text, escaped, replacement)
        text = encoded.value
        count += encoded.count
      }
      if (allowRaw) {
        const direct = replaceInValue(text, find, replacement)
        text = direct.value
        count += direct.count
      }
      return text
    })
    .join('')
  return { value, count }
}

export interface ReplaceScope {
  titles: boolean
  body: boolean
}

export interface ReplaceResult {
  chapters: EditableChapter[]
  matches: number
  chaptersChanged: number
}

/** Replaces text across chapter titles and/or body text, never inside tags. */
export function replaceInChapters(
  chapters: EditableChapter[],
  find: string,
  replacement: string,
  scope: ReplaceScope,
): ReplaceResult {
  if (!find) return { chapters, matches: 0, chaptersChanged: 0 }
  let matches = 0
  let chaptersChanged = 0
  const next = chapters.map(chapter => {
    let changed = false
    const title = scope.titles ? replaceInValue(chapter.title, find, replacement) : { value: chapter.title, count: 0 }
    const body = scope.body ? replaceOutsideTags(chapter.html, find, replacement) : { value: chapter.html, count: 0 }
    matches += title.count + body.count
    changed = title.count + body.count > 0
    if (changed) chaptersChanged += 1
    return { ...chapter, title: title.value, html: body.value }
  })
  return { chapters: next, matches, chaptersChanged }
}

/** Replaces text in volume titles (used by the same batch-replace bar). */
export function replaceInVolumeTitles(volumes: Volume[], find: string, replacement: string): { volumes: Volume[]; matches: number } {
  if (!find) return { volumes, matches: 0 }
  let matches = 0
  const next = volumes.map(volume => {
    const result = replaceInValue(volume.title, find, replacement)
    matches += result.count
    return result.count > 0 ? { ...volume, title: result.value } : volume
  })
  return { volumes: next, matches }
}

/** Guarantees every chapter has a label and a stable id before saving. */
export function normalizeChapters(chapters: EditableChapter[]): EditableChapter[] {
  return chapters.map((chapter, index) => ({
    ...chapter,
    id: chapter.id || crypto.randomUUID(),
    title: chapter.title.trim() || `章节 ${index + 1}`,
  }))
}

const CHINESE_DIGITS: Record<string, number> = {
  零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
  壹: 1, 贰: 2, 叁: 3, 肆: 4, 伍: 5, 陆: 6, 柒: 7, 捌: 8, 玖: 9,
}
const CHINESE_UNITS: Record<string, number> = { 十: 10, 拾: 10, 百: 100, 佰: 100, 千: 1000, 仟: 1000, 万: 10000, 萬: 10000 }
const NUMBER_WORDS = '0-9零〇一二三四五六七八九十百千万两壹贰叁肆伍陆柒捌玖拾佰仟萬'
const CHAPTER_UNIT_WORDS = '章节回集卷部篇'

/** 十二 → 12, 二百二十二 → 222, 壹拾贰 → 12; returns null for non-numeric text. */
export function chineseNumberToArabic(text: string): number | null {
  let total = 0
  let section = 0
  let digit = 0
  let matched = false
  for (const char of text) {
    if (char in CHINESE_DIGITS) {
      digit = CHINESE_DIGITS[char]
      matched = true
      continue
    }
    const unit = CHINESE_UNITS[char]
    if (unit === undefined) return null
    matched = true
    if (unit === 10000) {
      section = (section + digit) * unit
      total += section
      section = 0
    } else {
      section += (digit || 1) * unit
    }
    digit = 0
  }
  return matched ? total + section + digit : null
}

function sectionToChinese(value: number, upper = false): string {
  const digits = upper ? '零壹贰叁肆伍陆柒捌玖' : '零一二三四五六七八九'
  const units = upper ? ['', '拾', '佰', '仟'] : ['', '十', '百', '千']
  const chars = String(value).split('').map(Number)
  let result = ''
  let pendingZero = false
  chars.forEach((digit, index) => {
    const unitIndex = chars.length - index - 1
    if (digit === 0) {
      pendingZero = true
      return
    }
    if (pendingZero && result) result += '零'
    pendingZero = false
    result += digits[digit] + units[unitIndex]
  })
  return result
}

/** 1 → 一, 11 → 十一, 222 → 二百二十二, 10005 → 一万零五; upper 输出大写汉字。 */
export function arabicToChinese(value: number, upper = false): string {
  const number = Math.floor(value)
  if (!Number.isFinite(number) || number <= 0) return String(value)
  const high = Math.floor(number / 10000)
  const low = number % 10000
  let text = ''
  if (high > 0) text += `${sectionToChinese(high, upper)}${upper ? '萬' : '万'}`
  if (low > 0) {
    if (high > 0 && low < 1000) text += '零'
    text += sectionToChinese(low, upper)
  }
  return upper ? text.replace(/^壹拾/, '拾') : text.replace(/^一十/, '十')
}

export type ChapterNumberStyle = 'chinese' | 'upper' | 'arabic' | 'bare' | 'dot' | 'dun' | 'name'
export type ChapterCounting = 'book' | 'volume' | 'keep'

export interface ParsedChapterTitle {
  number: number | null
  unit: string | null
  /** The actual chapter name, without the numbering prefix. */
  text: string
}

const NUMBERED_PREFIX = new RegExp(`^第\\s*([${NUMBER_WORDS}]+)\\s*([${CHAPTER_UNIT_WORDS}])\\s*[:：,，、.．·\\-—]?\\s*`)
const VOLUME_ONLY_PREFIX = new RegExp(`^卷\\s*[丨|:：,，、.．·\\-—]?\\s*([${NUMBER_WORDS}]+)\\s*[丨|:：,，、.．·\\-—]?\\s*`)
const ENGLISH_PREFIX = /^chapter\s*([0-9]+)\s*[:：.,，、]?\s*/i
const DOT_PREFIX = /^([0-9]{1,4})\s*[.．、:：]\s*/
const SPACE_PREFIX = /^([0-9]{1,4})\s+/

/** Splits "第222章 如果不接受日本投降" into number 222 and name. */
export function parseChapterTitle(title: string): ParsedChapterTitle {
  const value = title.trim()
  const chinese = NUMBERED_PREFIX.exec(value)
  if (chinese) {
    const raw = chinese[1]
    const number = /^\d+$/.test(raw) ? Number(raw) : chineseNumberToArabic(raw)
    return { number, unit: chinese[2], text: value.slice(chinese[0].length).trim() }
  }
  const volume = VOLUME_ONLY_PREFIX.exec(value)
  if (volume) {
    const raw = volume[1]
    const number = /^\d+$/.test(raw) ? Number(raw) : chineseNumberToArabic(raw)
    return { number, unit: '卷', text: value.slice(volume[0].length).trim() }
  }
  const english = ENGLISH_PREFIX.exec(value)
  if (english) return { number: Number(english[1]), unit: null, text: value.slice(english[0].length).trim() }
  const dot = DOT_PREFIX.exec(value)
  if (dot) return { number: Number(dot[1]), unit: null, text: value.slice(dot[0].length).trim() }
  const space = SPACE_PREFIX.exec(value)
  if (space) return { number: Number(space[1]), unit: null, text: value.slice(space[0].length).trim() }
  return { number: null, unit: null, text: value }
}

export function formatChapterTitle(number: number, text: string, style: ChapterNumberStyle): string {
  const name = text.trim()
  switch (style) {
    case 'chinese': return `第${arabicToChinese(number)}章${name ? ' ' + name : ''}`
    case 'upper': return `第${arabicToChinese(number, true)}章${name ? ' ' + name : ''}`
    case 'arabic': return `第${number}章${name ? ' ' + name : ''}`
    case 'bare': return `${number}${name ? ' ' + name : ''}`
    case 'dot': return `${number}.${name ? ' ' + name : ''}`
    case 'dun': return `${number}、${name}`
    case 'name': return name
  }
}

export function formatVolumeTitle(number: number, text: string, style: ChapterNumberStyle, unit = '卷'): string {
  const name = text.trim()
  switch (style) {
    case 'name': return name
    case 'bare': return `${number}${name ? ' ' + name : ''}`
    case 'dot': return `${number}.${name ? ' ' + name : ''}`
    case 'dun': return `${number}、${name}`
    case 'upper': return `第${arabicToChinese(number, true)}${unit}${name ? ' ' + name : ''}`
    default: {
      const numeral = style === 'chinese' ? arabicToChinese(number) : String(number)
      return `第${numeral}${unit}${name ? ' ' + name : ''}`
    }
  }
}

export interface VolumeNumberOptions {
  style: ChapterNumberStyle
  start: number
  /** 卷／部／篇，缺省时沿用各卷标题里已有的单位。 */
  unit?: string
}

export interface VolumeNumberResult {
  volumes: Volume[]
  renamed: number
}

/**
 * Rewrites every volume title in one numbering style, keeping the volume name.
 * Used by the 卷批量编辑 dialog: volumes are numbered book-wide from `start`.
 */
export function renumberVolumeTitles(volumes: Volume[], options: VolumeNumberOptions): VolumeNumberResult {
  const start = Math.max(1, Math.floor(options.start) || 1)
  let renamed = 0
  const next = volumes.map((volume, index) => {
    const parsed = parseChapterTitle(volume.title)
    const number = parsed.number ?? start + index
    const unit = options.unit || parsed.unit || '卷'
    const title = formatVolumeTitle(number, parsed.text, options.style, unit)
    if (title === volume.title) return volume
    renamed += 1
    return { ...volume, title }
  })
  return { volumes: next, renamed }
}

export interface RenumberOptions {
  style: ChapterNumberStyle
  counting: ChapterCounting
  start: number
  renumberVolumes: boolean
}

export interface RenumberResult {
  chapters: EditableChapter[]
  volumes: Volume[]
  renamed: number
  renamedVolumes: number
}

const UNNUMBERED_TITLES = ['前言', '序', '序言', '序章', '楔子', '引子', '尾声', '后记', '番外', '终章', '附录']

/**
 * Rewrites chapter titles in one numbering style while keeping the real name.
 * counting: 'book' = 1…N across the book, 'volume' = restart at each volume,
 * 'keep' = keep the number found in the title and only normalize its spelling.
 */
export function renumberChapters(chapters: EditableChapter[], volumes: Volume[], options: RenumberOptions): RenumberResult {
  const start = Math.max(1, Math.floor(options.start) || 1)
  const counters = new Map<string | null, number>()
  const carried = new Map<string | null, number>()
  let bookNumber = start
  let renamed = 0
  const nextChapters = chapters.map(chapter => {
    const parsed = parseChapterTitle(chapter.title)
    if (parsed.number === null && UNNUMBERED_TITLES.includes(parsed.text)) return chapter
    if (options.style === 'name' && !parsed.text) return chapter
    let number: number
    if (options.counting === 'keep') {
      const key = chapter.volumeId ?? null
      if (parsed.number !== null) {
        number = parsed.number
        carried.set(key, Math.max(carried.get(key) ?? start, parsed.number + 1))
      } else {
        // Titles without a number continue the numbering of their volume.
        number = carried.get(key) ?? start
        carried.set(key, number + 1)
      }
    } else if (options.counting === 'volume') {
      const key = chapter.volumeId ?? null
      const current = counters.get(key) ?? start
      counters.set(key, current + 1)
      number = current
    } else {
      number = bookNumber
      bookNumber += 1
    }
    const title = formatChapterTitle(number, parsed.text, options.style)
    if (title === chapter.title) return chapter
    renamed += 1
    return { ...chapter, title }
  })
  const volumesResult = options.renumberVolumes
    ? renumberVolumeTitles(volumes, { style: options.style, start })
    : { volumes, renamed: 0 }
  const renamedVolumes = volumesResult.renamed
  const nextVolumes = volumesResult.volumes
  return { chapters: nextChapters, volumes: nextVolumes, renamed, renamedVolumes }
}
