import { describe, expect, it } from 'vitest'
import { imageLinkUrls, replaceImageLinks } from './imageLinks'

describe('TXT image links', () => {
  it('finds escaped image tags without treating unrelated URLs as images', () => {
    const html = '<p>文字</p><p>　　&lt;img src=&quot;https://example.com/a.webp&quot;&gt;</p><p>https://example.com/page</p>'
    expect(imageLinkUrls(html)).toEqual(['https://example.com/a.webp'])
    expect(replaceImageLinks(html, new Map([['https://example.com/a.webp', 'data:image/webp;base64,AA==']]))).toBe('<p>文字</p><p>　　<img src="data:image/webp;base64,AA==" alt="正文图片" /></p><p>https://example.com/page</p>')
  })

  it('preserves unresolved links for retry', () => {
    const html = '<p>&lt;img src=&quot;https://example.com/a.png&quot;&gt;</p>'
    expect(replaceImageLinks(html, new Map())).toBe(html)
  })

  it('accepts attributes before src and escaped query strings', () => {
    expect(imageLinkUrls('<p>&lt;img alt=&quot;图&quot; src=&quot;https://example.com/a.webp?x=1&amp;y=2&quot;&gt;</p>'))
      .toEqual(['https://example.com/a.webp?x=1&y=2'])
  })
})
