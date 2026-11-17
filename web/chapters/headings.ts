export type HeadingKind = 'chapter' | 'volume'

export function splitHeading(title: string, kind: HeadingKind): { number: string; name: string } {
  const text = title.trim()
  const units = kind === 'chapter' ? '章节回话' : '卷部篇'
  const pattern = new RegExp(`^(第[0-9０-９零〇一二三四五六七八九十百千万两]+[${units}]${kind === 'volume' ? '|卷[0-9０-９零〇一二三四五六七八九十百千万两]+' : ''})(.*)$`)
  const match = text.match(pattern)
  return match
    ? { number: match[1], name: match[2].replace(/^[\s　:：、.．·—-]+/, '').trim() }
    : { number: '', name: text }
}
