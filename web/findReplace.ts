import type { EditableChapter, Volume } from './model'

export interface FindReplaceOptions {
  find: string
  replacement: string
  regex: boolean
  matchCase: boolean
  scope: { titles: boolean; body: boolean; volumes: boolean }
}

export interface FindReplaceResult {
  chapters: EditableChapter[]
  volumes: Volume[]
  matches: number
  chaptersChanged: number
  volumesChanged: number
  error?: string
}

const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' }

function decodeEntities(value: string): string {
  return value.replace(/&(#(?:x[0-9a-f]+|[0-9]+)|[a-z]+);/gi, (raw, entity: string) => {
    if (entity[0] !== '#') return entities[entity.toLowerCase()] ?? raw
    const hex = entity[1]?.toLowerCase() === 'x'
    const number = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10)
    return Number.isFinite(number) && number > 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff)
      ? String.fromCodePoint(number) : raw
  })
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function replaceText(value: string, pattern: RegExp, replacement: string, regex: boolean, apply: boolean) {
  let count = 0
  for (const _match of value.matchAll(pattern)) count += 1
  if (!apply || count === 0) return { value, count }
  return { value: regex ? value.replace(pattern, replacement) : value.replace(pattern, () => replacement), count }
}

function replaceBody(html: string, pattern: RegExp, replacement: string, regex: boolean, apply: boolean) {
  let count = 0
  const next = html.split(/(<[^>]*>)/).map(part => {
    if (part.startsWith('<')) return part
    const plain = decodeEntities(part)
    const result = replaceText(plain, pattern, replacement, regex, apply)
    count += result.count
    return apply && result.count > 0 ? escapeHtml(result.value) : part
  }).join('')
  return { value: next, count }
}

export function findReplace(chapters: EditableChapter[], volumes: Volume[], options: FindReplaceOptions, apply: boolean): FindReplaceResult {
  const empty = { chapters, volumes, matches: 0, chaptersChanged: 0, volumesChanged: 0 }
  if (!options.find || !Object.values(options.scope).some(Boolean)) return empty
  let pattern: RegExp
  try {
    pattern = new RegExp(options.regex ? options.find : options.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), `g${options.matchCase ? '' : 'i'}`)
  } catch (cause) {
    return { ...empty, error: cause instanceof Error ? cause.message : String(cause) }
  }

  let matches = 0
  let chaptersChanged = 0
  let volumesChanged = 0
  const nextChapters = chapters.map(chapter => {
    const title = options.scope.titles ? replaceText(chapter.title, pattern, options.replacement, options.regex, apply) : { value: chapter.title, count: 0 }
    const body = options.scope.body ? replaceBody(chapter.html, pattern, options.replacement, options.regex, apply) : { value: chapter.html, count: 0 }
    matches += title.count + body.count
    if (title.count + body.count === 0) return chapter
    chaptersChanged += 1
    return apply ? { ...chapter, title: title.value, html: body.value } : chapter
  })
  const nextVolumes = volumes.map(volume => {
    if (!options.scope.volumes) return volume
    const title = replaceText(volume.title, pattern, options.replacement, options.regex, apply)
    matches += title.count
    if (title.count === 0) return volume
    volumesChanged += 1
    return apply ? { ...volume, title: title.value } : volume
  })
  return { chapters: apply && chaptersChanged ? nextChapters : chapters, volumes: apply && volumesChanged ? nextVolumes : volumes, matches, chaptersChanged, volumesChanged }
}
