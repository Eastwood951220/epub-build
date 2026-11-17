const escapedImage = /&lt;img\b[\s\S]*?&gt;/gi
const sourceAttribute = /\bsrc\s*=\s*(?:&quot;|&#34;|&apos;|&#39;)(https?:\/\/[^\s&]+(?:&amp;[^\s&]+)*)(?:&quot;|&#34;|&apos;|&#39;)/i

function decodeUrl(url: string): string { return url.replaceAll('&amp;', '&') }

export function imageLinkUrls(html: string): string[] {
  if (!html.includes('&lt;img')) return []
  return Array.from(html.matchAll(escapedImage), match => sourceAttribute.exec(match[0])?.[1])
    .filter((url): url is string => !!url).map(decodeUrl)
}

export function replaceImageLinks(html: string, downloaded: Map<string, string>): string {
  return html.replace(escapedImage, original => {
    const escapedUrl = sourceAttribute.exec(original)?.[1]
    const data = escapedUrl ? downloaded.get(decodeUrl(escapedUrl)) : undefined
    return data ? `<img src="${data}" alt="正文图片" />` : original
  })
}
