import { imageLinkUrls } from './imageLinks'

export interface ChapterHtml { id: string; html: string }
export interface ImageCountEntry { html: string; count: number }

export function scanImageBatch(
  chapters: ChapterHtml[],
  cache: Map<string, ImageCountEntry>,
  start: number,
  batchSize: number,
  countLinks: (html: string) => number = html => imageLinkUrls(html).length,
) {
  let count = 0
  const next = Math.min(chapters.length, start + batchSize)
  for (let index = start; index < next; index += 1) {
    const chapter = chapters[index]
    const cached = cache.get(chapter.id)
    if (cached?.html === chapter.html) { count += cached.count; continue }
    const found = countLinks(chapter.html)
    cache.set(chapter.id, { html: chapter.html, count: found })
    count += found
  }
  return { next, count }
}
