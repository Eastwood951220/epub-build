export type HeadingKind = 'chapter' | 'volume'

const NUMERALS = '0-9０-９零〇一二三四五六七八九十百千万两壹贰叁肆伍陆柒捌玖拾佰仟萬'

export function splitHeading(title: string, kind: HeadingKind): { number: string; name: string } {
  const text = title.trim()
  const units = kind === 'chapter' ? '章节回话' : '卷部篇'
  const pattern = new RegExp(`^(第[\\s　]*[${NUMERALS}]+[\\s　]*[${units}]${kind === 'volume' ? `|卷[丨|:：,，、.．·—-]*[${NUMERALS}]+[丨|]?` : ''})(.*)$`)
  const match = text.match(pattern)
  return match
    ? { number: match[1], name: match[2].replace(/^[\s　:：、.．·—-丨|]+/, '').trim() }
    : { number: '', name: text }
}
